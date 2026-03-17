import { executeAction } from "./actionExecutor.js";
import { askAva } from "./brain.js";
import { isRejection } from "../server.js";
import { slackApp } from "../server.js";

export const pendingApprovals = new Map();

export async function handleApproval({ message, say }) {
  const threadTs = message.thread_ts;
  const pending = pendingApprovals.get(threadTs);
  if (!pending) return;

  const text = message.text || "";

  if (isRejection(text)) {
    const { text: revised, action: newAction } = await askAva(
      [
        {
          role: "user",
          content: "You previously drafted this action: " + JSON.stringify(pending.action) + ". The team wants this change: \"" + text + "\". Revise and show the updated version for approval.",
        },
      ],
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
      await say({
        text: revised,
        channel: message.channel,
        thread_ts: threadTs,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: revised } },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Reply *looks good* to send, or tell me what to change._" }],
          },
        ],
      });
    } else {
      pendingApprovals.delete(threadTs);
      await say({ text: revised, channel: message.channel, thread_ts: threadTs });
    }
    return;
  }

  // Approved — execute
  pendingApprovals.delete(threadTs);
  try {
    const result = await executeAction(pending.action);

    // If the action returned a PDF buffer, upload it to Slack
    if (result.pdfBuffer && result.fileName) {
      try {
        await slackApp.client.files.uploadV2({
          channel_id: message.channel,
          thread_ts: threadTs,
          filename: result.fileName,
          file: result.pdfBuffer,
          initial_comment: result.summary || "Here is your document.",
        });
      } catch (uploadErr) {
        console.error("Failed to upload PDF to Slack:", uploadErr.message);
        await say({
          text: "Document generated but could not upload to Slack: " + uploadErr.message,
          channel: message.channel,
          thread_ts: threadTs,
        });
      }
    } else {
      await say({
        text: "Done. " + result.summary,
        channel: message.channel,
        thread_ts: threadTs,
      });
    }
  } catch (err) {
    console.error("Action execution failed:", err);
    await say({
      text: "Ran into an issue: " + err.message + ". Want me to retry?",
      channel: message.channel,
      thread_ts: threadTs,
    });
  }
}
