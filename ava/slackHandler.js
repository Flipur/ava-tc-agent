import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals, handleApproval } from "./approvalHandler.js";
import { slackApp } from "../server.js";

// Per-user deal context cache for DMs
const dmDealCache = new Map();

function extractAddressFromChannelName(channelName) {
  if (!channelName) return null;
  const match = channelName.match(/^(\d+)-(.+)/);
  if (!match) return null;
  const full = channelName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-usa$/, "").replace(/-/g, " ").trim();
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
  const isDM = event.channel_type === "im" || event.channel_type === "mpim";
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  const replyTs = isDM ? undefined : (threadTs || ts);

  if (threadTs && pendingApprovals.has(threadTs)) {
    await handleApproval({ message: { ...event, text: cleanText }, say });
    return;
  }

  try {
    let messages = [];
    if (threadTs && !isDM) {
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

    // Check property channel first — highest priority
    const channelName = await getChannelName(channel);
    const channelAddress = extractAddressFromChannelName(channelName);
    let dealResult = null;

    if (channelAddress) {
      console.log("Property channel detected:", channelName, "-> searching for:", channelAddress);
      dealResult = await getDealContext(channelAddress);
    }

    // Fall back to searching thread text
    if (!dealResult || dealResult.notFound) {
      const fullThreadText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
      dealResult = await getDealContext(fullThreadText);
    }

    // In DMs cache the deal and fall back to cached deal if nothing found
    if (isDM) {
      if (dealResult && !dealResult.notFound && !dealResult.deals) {
        dmDealCache.set(userId, dealResult);
      } else if (!dealResult || dealResult.notFound) {
        if (dmDealCache.has(userId)) {
          dealResult = dmDealCache.get(userId);
        }
      }
    }

    const context =
      dealResult && dealResult.deals
        ? { deals: dealResult.deals }
        : dealResult && dealResult.notFound
        ? { notFound: true }
        : dealResult
        ? { deal: dealResult }
        : {};

    // If in a property channel, inject it strongly into context so Ava uses it as default
    const finalContext = channelAddress && context.deal
      ? {
          ...context,
          propertyChannel: channelName,
          autoLoadedAddress: channelAddress,
          channelNote: "You are in the property channel for " + context.deal.address + ". All requests in this channel are for this property unless explicitly stated otherwise.",
        }
      : context;

    const { text: avaResponse, action } = await askAva(messages, {
      ...finalContext,
      slackUser: userId,
      channel,
    });

    if (action && action.requiresApproval) {
      await say({
        text: avaResponse,
        thread_ts: replyTs,
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
      await say({ text: avaResponse, thread_ts: replyTs });
      await executeAction(action);
    } else {
      await say({ text: avaResponse, thread_ts: replyTs });
    }
  } catch (err) {
    console.error("Ava slackHandler error:", err);
    await say({
      text: "Hit an error on my end. Let me know if you need me to retry.",
      thread_ts: replyTs,
    });
  }
}
