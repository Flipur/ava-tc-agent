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
    const dealResult = await getDealContext(cleanText);
    const context = dealResult && dealResult.deals
      ? { deals: dealResult.deals }
      : dealResult && dealResult.notFound
      ? { notFound: true }
      : dealResult
      ? { deal: dealResult }
      : {};

    const messages = [{ role: "user", content: cleanText }];
    const { text: avaResponse, action } = await askAva(messages, {
      ...context,
      slackUser: userId,
      channel,
    });

    if (action && action.requiresApproval) {
      const posted = await say({
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

      console.log("Storing pending approval with key: " + ts);
      pendingApprovals.set(ts, {
        action,
        channel,
        requestedBy: userId,
        dealContext: context.deal || null,
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
