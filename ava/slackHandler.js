import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals } from "./approvalHandler.js";

export async function handleSlackMessage({ event, say, type }) {
  const text = event.text || "";
  const userId = event.user;
  const channel = event.channel;
  const ts = event.ts;

  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  try {
    const dealContext = await getDealContext(cleanText);
    const messages = [{ role: "user", content: cleanText }];
    const { text: avaResponse, action } = await askAva(messages, {
      deal: dealContext,
      slackUser: userId,
      channel,
    });

    if (action && action.requiresApproval) {
      // Post the approval request
      await say({
        text: avaResponse,
        thread_ts: ts,
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: avaResponse },
          },
          {
            type: "context",
            elements: [{
              type: "mrkdwn",
              text: "_Reply *looks good* to send, or tell me what to change._",
            }],
          },
        ],
      });

      // Key the pending approval to the ORIGINAL message ts (the thread root)
      // This is what thread replies will have as their thread_ts
      console.log(`Storing pending approval with key: ${ts}`);
      pendingApprovals.set(ts, {
        action,
        channel,
        requestedBy: userId,
        createdAt: Date.now(),
      });

    } else if (action && !action.requiresApproval) {
      await say({ text: avaResponse, thread_ts: ts });
      await executeAction(action);

    } else {
      await say({ text: avaResponse, thread_ts: ts });
    }

  } catch (err) {
    console.error("Ava slackHandler error:", err);
    await say({
      text: "Hit an error on my end. Let me know if you need me to retry.",
      thread_ts: ts,
    });
  }
}
