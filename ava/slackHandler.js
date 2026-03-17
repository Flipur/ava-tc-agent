import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals, handleApproval } from "./approvalHandler.js";
import { slackApp } from "../server.js";

function extractAddressFromChannelName(channelName) {
  if (!channelName) return null;
  const match = channelName.match(/^(\d+)-(.+)/);
  if (!match) return null;
  const full = channelName.replace(/-usa$/, "").replace(/-/g, " ").trim();
  const parts = full.split(" ");
  return parts.slice(0, 3).join(" ");
}

async function getChannelName(channelId) {
  try {
    const result = await slackApp.client.conversations.info({ channel: channelId });
    return result.channel?.name || null;
  } catch (e) {
    console.error("Failed to get channel name:", e.message);
    return null;
  }
}

export async function handleSlackMessage({ event, say, type }) {
  const text = event.text || "";
  const userId = event.user;
  const channel = event.channel;
  const ts = event.ts;
  const threadTs = event.thread_ts;
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

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

    let dealResult = null;
    const channelName = await getChannelName(channel);
    const channelAddress = extractAddressFromChannelName(channelName);

    if (channelAddress) {
      console.log("Property channel detected:", channelName, "-> searching for:", channelAddress);
      dealResult = await getDealContext(channelAddress);
    }

    if (!dealResult || dealResult.notFound) {
      const fullThreadText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
      dealResult = await getDealContext(fullThreadText);
    }

    const context =
      dealResult && dealResult.deals
        ? { deals: dealResult.deals }
        : dealResult && dealResult.notFound
        ? { notFound: true }
        : dealResult
        ? { deal: dealResult }
        : {};

    const channelContext = channelAddress && context.deal
      ? { ...context, propertyChannel: channelName, autoLoadedAddress: channelAddress }
      : context;

    const { text: avaResponse, action } = await askAva(messages, {
      ...channelContext,
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
