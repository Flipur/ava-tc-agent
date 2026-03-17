import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals, handleApproval } from "./approvalHandler.js";
import { slackApp } from "../server.js";

export async function handleSlackMessage({ event, say, type }) {
  const text = event.text || "";
  const userId = event.user;
  const channel = event.channel;
  const ts = event.ts;
  const threadTs = event.thread_ts;
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  // If this is a thread reply and there's a pending approval, route to approval handler
  if (threadTs && pendingApprovals.has(threadTs)) {
    await handleApproval({ message: { ...event, text: cleanText }, say });
    return;
  }

  try {
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
          messages.push({ role: isAva ? "assistant" : "user", content: msgText });
        }
      } catch (e) {
        console.error("Failed to fetch thread history:", e.message);
        messages = [{ role: "user", content: cleanText }];
      }
    } else {
      messages = [{ role: "user", content: cleanText }];
    }

    // Only search user messages for deal context — not Ava's responses
    const fullThreadText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
    const dealResult = await getDealContext(fullThreadText);
    const context =
      dealResult && dealResult.deals
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
      await say({
        text: avaResponse,
        thread_ts: threadTs || ts,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: avaResponse } },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Reply *looks good* to send, or tell me what to change._" }],
          },
        ],
      });

      const approvalKey = threadTs || ts;
      console.log("Storing pending approval with key: " + approvalKey);
      pendingApprovals.set(approvalKey, {
        action,
        channel,
        requestedBy: userId,
        dealContext: context.deal || null,
        createdAt: Date.now(),
      });
    } else if (action && !action.requiresApproval) {
      await say({ text: avaResponse, thread_ts: threadTs || ts });
      await executeAction(action);
    } else {
      await say({ text: avaResponse, thread_ts: threadTs || ts });
    }
  } catch (err) {
    console.error("Ava slackHandler error:", err);
    await say({
      text: "Hit an error on my end. Let me know if you need me to retry.",
      thread_ts: threadTs || ts,
    });
  }
}
