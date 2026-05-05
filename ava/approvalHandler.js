import { executeAction } from "./actionExecutor.js";
import { askAva } from "./brain.js";
import { isRejection } from "../server.js";
import { slackApp } from "../server.js";
import fs from "fs";

const PENDING_FILE = "/tmp/pendingApprovals.json";

function loadPending() {
  try {
    if (fs.existsSync(PENDING_FILE)) {
      const data = JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
      return new Map(Object.entries(data));
    }
  } catch(e) {}
  return new Map();
}

export function savePending(map) {
  try {
    const obj = {};
    for (const [k, v] of map.entries()) obj[k] = v;
    fs.writeFileSync(PENDING_FILE, JSON.stringify(obj));
  } catch(e) {}
}

export const pendingApprovals = loadPending();

export async function handleApproval({ message, say }) {
  const threadTs = message.thread_ts;
  const pending = pendingApprovals.get(threadTs);
  if (!pending) return;
  const text = message.text || "";

  if (isRejection(text)) {
    const { text: revised, action: newAction } = await askAva(
      [{ role: "user", content: "You previously drafted: " + JSON.stringify(pending.action) + ". Change requested: " + text + ". Revise and show for approval." }],
      { deal: pending.dealContext || null }
    );
    if (newAction && newAction.requiresApproval) {
      pendingApprovals.set(threadTs, {
        action: newAction,
        channel: message.channel,
        requestedBy: message.user,
        dealContext: pending.dealContext || null,
        createdAt: Date.now(),
      });
      savePending(pendingApprovals);
      await say({ text: (revised || "").trim() || "Updated — reply *looks good* to send.", channel: message.channel, thread_ts: threadTs });
    } else {
      pendingApprovals.delete(threadTs);
      savePending(pendingApprovals);
      await say({ text: (revised || "").trim() || "Got it.", channel: message.channel, thread_ts: threadTs });
    }
    return;
  }

  // Approved — execute
  pendingApprovals.delete(threadTs);
  savePending(pendingApprovals);

  const channel = message.channel;
  let thinkingMsgTs = null;
  const addReaction = async () => {
    try {
      await slackApp.client.reactions.add({ channel, name: "hourglass_flowing_sand", timestamp: message.ts });
    } catch {
      try {
        const r = await slackApp.client.chat.postMessage({ channel, text: "⏳", thread_ts: threadTs });
        thinkingMsgTs = r.ts;
      } catch {}
    }
  };
  const removeReaction = async () => {
    try { await slackApp.client.reactions.remove({ channel, name: "hourglass_flowing_sand", timestamp: message.ts }); } catch {}
    if (thinkingMsgTs) {
      try { await slackApp.client.chat.delete({ channel, ts: thinkingMsgTs }); } catch {}
      thinkingMsgTs = null;
    }
  };

  await addReaction();

  // For slow actions, post an immediate acknowledgment so the user knows work is happening
  const slowActions = ["generate_inspection", "generate_bid"];
  if (slowActions.includes(pending.action.type)) {
    const msgs = {
      generate_inspection: "On it — pulling photos and building the report now. This one takes a couple minutes.",
      generate_bid: "Building the estimate now — give me a sec.",
    };
    await say({ text: msgs[pending.action.type], channel, thread_ts: threadTs });
  }

  try {
    const result = await executeAction(pending.action);
    await removeReaction();
    if (result.pdfBuffer && result.fileName) {
      try {
        await slackApp.client.files.uploadV2({
          channel_id: channel,
          thread_ts: threadTs,
          filename: result.fileName,
          file: result.pdfBuffer,
          initial_comment: result.summary || "Here is your document.",
        });
      } catch (uploadErr) {
        console.error("Failed to upload PDF:", uploadErr.message);
        await say({ text: "Document generated but upload failed: " + uploadErr.message, channel, thread_ts: threadTs });
      }
    } else {
      await say({ text: result.summary || "Done.", channel, thread_ts: threadTs });
    }
  } catch (err) {
    console.error("Action execution failed:", err);
    await removeReaction();
    await say({ text: "Ran into an issue: " + err.message + ". Want me to retry?", channel, thread_ts: threadTs });
  }
}
