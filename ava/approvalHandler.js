import { executeAction } from "./actionExecutor.js";
import { askAva } from "./brain.js";
import { isRejection } from "../server.js";

// In-memory store of pending approvals: threadTs -> { action, channel, requestedBy, createdAt }
export const pendingApprovals = new Map();

export async function handleApproval({ message, say }) {
  const threadTs = message.thread_ts;
  const pending = pendingApprovals.get(threadTs);
  if (!pending) return;

  const text = message.text || "";

  if (isRejection(text)) {
    // Ask Ava to revise based on feedback
    const { text: revised, action: newAction } = await askAva([
      {
        role: "user",
        content: `The team wants changes: "${text}". Please revise and show the updated version for approval.`
      }
    ]);

    pendingApprovals.delete(threadTs);

    if (newAction && newAction.requiresApproval) {
      const newMsg = await say({
        text: revised,
        channel: message.channel,
        thread_ts: threadTs,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: revised },
          },
          {
            type: "context",
            elements: [{
              type: "mrkdwn",
              text: "_Reply *'looks good'* to send, or tell me what to change._",
            }],
          },
        ],
      });

      pendingApprovals.set(newMsg.ts, {
        action: newAction,
        channel: message.channel,
        requestedBy: message.user,
        createdAt: Date.now(),
      });

    } else {
      await say({
        text: revised,
        channel: message.channel,
        thread_ts: threadTs,
      });
    }

    return;
  }

  // Approved — execute the action
  pendingApprovals.delete(threadTs);

  try {
    const result = await executeAction(pending.action);
    await say({
      text: `Done. ${result.summary}`,
      channel: message.channel,
      thread_ts: threadTs,
    });
  } catch (err) {
    console.error("Action execution failed:", err);
    await say({
      text: `Ran into an issue: ${err.message}. Want me to retry?`,
      channel: message.channel,
      thread_ts: threadTs,
    });
  }
}
