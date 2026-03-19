import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals, handleApproval } from "./approvalHandler.js";
import { slackApp } from "../server.js";

const dmDealCache = new Map();

function extractAddressFromChannelName(channelName) {
  if (!channelName) return null;
  const match = channelName.match(/^(\d+)-(.+)/);
  if (!match) return null;
  const full = channelName.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/-usa$/, "").replace(/-/g, " ").trim();
  return full.split(" ").slice(0, 3).join(" ");
}

async function getChannelName(channelId) {
  try {
    const result = await slackApp.client.conversations.info({ channel: channelId });
    return result.channel?.name || null;
  } catch (e) {
    return null;
  }
}

async function findPropertyChannel(address) {
  try {
    const result = await slackApp.client.conversations.list({ limit: 200, types: "public_channel,private_channel" });
    const searchTerm = address.split(",")[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").substring(0, 8);
    const match = (result.channels || []).find(c => c.name.toLowerCase().includes(searchTerm));
    return match ? "#" + match.name : null;
  } catch (e) {
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
        const history = await slackApp.client.conversations.replies({ channel, ts: threadTs, limit: 20 });
        for (const msg of history.messages || []) {
          const msgText = (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
          if (!msgText) continue;
          messages.push({ role: (msg.app_id || msg.bot_id) ? "assistant" : "user", content: msgText });
        }
      } catch (e) {
        messages = [{ role: "user", content: cleanText }];
      }
    } else {
      messages = [{ role: "user", content: cleanText }];
    }

    const channelName = await getChannelName(channel);
    const channelAddress = extractAddressFromChannelName(channelName);
    let dealResult = null;
    let lockedToChannel = false;

    if (channelAddress) {
      console.log("Property channel detected:", channelName, "-> searching for:", channelAddress);
      dealResult = await getDealContext(channelAddress);
      if (dealResult && !dealResult.notFound && !dealResult.deals) {
        lockedToChannel = true;
      }
    }

    if (!lockedToChannel) {
      const fullText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
      dealResult = await getDealContext(fullText);
    }

    if (isDM) {
      if (dealResult && !dealResult.notFound && !dealResult.deals) {
        dmDealCache.set(userId, dealResult);
      } else if (!dealResult || dealResult.notFound) {
        if (dmDealCache.has(userId)) dealResult = dmDealCache.get(userId);
      }
    }

    const context =
      dealResult && dealResult.deals ? { deals: dealResult.deals } :
      dealResult && dealResult.notFound ? { notFound: true } :
      dealResult ? { deal: dealResult } : {};

    let finalContext = context;
    if (channelAddress && context.deal) {
      finalContext = {
        ...context,
        channelNote: "You are in the property channel for " + context.deal.address + ". ALL requests are ONLY for this property. Address is locked: " + context.deal.address,
      };
    } else if (context.deal && !channelAddress) {
      const suggestedChannel = await findPropertyChannel(context.deal.address);
      const slug = context.deal.address.split(",")[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      finalContext = {
        ...context,
        channelNote: suggestedChannel
          ? "A property channel exists: " + suggestedChannel + ". Mention the team can add you there."
          : "No dedicated channel found. Team can create #" + slug + " and add you there.",
      };
    }

    const { text: avaResponse, action } = await askAva(messages, { ...finalContext, slackUser: userId, channel });
    const safeText = (avaResponse || "").trim() || "On it.";

    if (action && action.requiresApproval) {
      await say({ text: safeText, thread_ts: replyTs });
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
      await say({ text: safeText, thread_ts: replyTs });
      await executeAction(action);
    } else {
      await say({ text: safeText, thread_ts: replyTs });
    }
  } catch (err) {
    console.error("Ava slackHandler error:", err);
    await say({ text: "Hit an error on my end. Let me know if you need me to retry.", thread_ts: replyTs });
  }
}
