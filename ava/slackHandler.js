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

// Try to find a property channel for a given address
async function findPropertyChannel(address) {
  try {
    const result = await slackApp.client.conversations.list({ limit: 200, types: "public_channel,private_channel" });
    const channels = result.channels || [];
    const searchTerm = address.split(",")[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const match = channels.find(c => c.name.toLowerCase().includes(searchTerm.substring(0, 8)));
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

    // Check property channel first — HIGHEST PRIORITY, never override
    const channelName = await getChannelName(channel);
    const channelAddress = extractAddressFromChannelName(channelName);
    let dealResult = null;
    let lockedToChannel = false;

    if (channelAddress) {
      console.log("Property channel detected:", channelName, "-> searching for:", channelAddress);
      dealResult = await getDealContext(channelAddress);
      if (dealResult && !dealResult.notFound && !dealResult.deals) {
        lockedToChannel = true; // Lock to this property — never search thread text
      }
    }

    // Only search thread text if NOT in a property channel
    if (!lockedToChannel) {
      if (!dealResult || dealResult.notFound) {
        const fullThreadText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
        dealResult = await getDealContext(fullThreadText);
      }
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

    // Build channel context — locked address overrides everything
    let finalContext = context;
    if (channelAddress && context.deal) {
      finalContext = {
        ...context,
        propertyChannel: channelName,
        autoLoadedAddress: channelAddress,
        channelNote: "You are in the property channel for " + context.deal.address + ". ALL requests in this channel are ONLY for this property. Never use any other address even if mentioned in the thread. The property is locked to: " + context.deal.address,
      };
    } else if (context.deal && !channelAddress) {
      // Not in a property channel — suggest one if deal was found
      const suggestedChannel = await findPropertyChannel(context.deal.address);
      if (suggestedChannel) {
        finalContext = {
          ...context,
          channelNote: "A property channel exists for this deal: " + suggestedChannel + ". You can mention to the team that they can add you to " + suggestedChannel + " for dedicated deal coordination.",
        };
      } else {
        // No channel exists — suggest creating one
        const channelSlug = context.deal.address.split(",")[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        finalContext = {
          ...context,
          channelNote: "No dedicated channel found for " + context.deal.address + ". If you want dedicated coordination, the team can create #" + channelSlug + " and add you there.",
        };
      }
    }

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
