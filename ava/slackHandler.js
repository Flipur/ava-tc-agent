import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals } from "./approvalHandler.js";
import { slackApp } from "../server.js";

export async function handleSlackMessage({ event, say, type }) {
  const text = event.text || "";
  const userId = event.user;
  const channel = event.channel;
  const ts = event.ts;
  const threadTs = event.thread_ts;

  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  try {
    // Build conversation history from thread if this is a reply
    let messages = [];
    if (threadTs) {
      try {
        const history = await slackApp.client.conversations.replies({
          channel,
          ts: threadTs,
          limit: 20,
        });
        for (const msg of history.messages || []) {
          const msgText = (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
          if (!msgText) continue;
          const isAva = msg.app_id || msg.bot_id;
          messages.push({
            role: isAva ? "assistant" : "user",
            content: msgText,
          });
        }
      } catch (e) {
        console.error("Failed to fetch thread history:", e.message);
        messages = [{ role: "user", content: cleanText }];
      }
    } else {
      messages = [{ role: "user", content: cleanText }];
    }

    // Search for deal context across all messages in thread
    const fullThreadText = messages.map(m => m.content).join(" ");
    const dealResult = await getDealContext(fullThreadText);
    const context = dealResult && dealResult.deals
      ? { deals: dealResult.deals }
      : dealResult && dealResult.notFound
      ? { notFound: true }
      : dealResult
      ? { deal: dealResult }
      : {};

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
