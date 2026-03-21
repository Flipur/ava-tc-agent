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

async function readChannelHistory(channelName, weeks = 12) {
  try {
    let allChannels = [];
    let nextCursor;
    do {
      const lr = await slackApp.client.conversations.list({
        limit: 200,
        types: "public_channel,private_channel",
        cursor: nextCursor,
      });
      allChannels = allChannels.concat(lr.channels || []);
      nextCursor = lr.response_metadata?.next_cursor;
    } while (nextCursor);

    const cleanName = channelName.replace("#", "");
    const channel = allChannels.find(c => c.name === cleanName || c.id === cleanName);
    if (!channel) {
      console.log("Channel not found:", channelName, "searched:", allChannels.length);
      return null;
    }

    const oldest = (Date.now() - weeks * 7 * 24 * 60 * 60 * 1000) / 1000;
    let messages = [];
    let cursor;
    do {
      const res = await slackApp.client.conversations.history({
        channel: channel.id,
        oldest: oldest.toString(),
        limit: 200,
        cursor,
      });
      messages = messages.concat(res.messages || []);
      cursor = res.response_metadata?.next_cursor;
    } while (cursor);

    console.log("Channel history fetched:", channelName, messages.length, "messages");

    // Pre-compute weekly buckets in code — exact counts, no AI guessing
    const byWeek = {};
    for (const m of messages) {
      const d = new Date(parseFloat(m.ts) * 1000);
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const key = monday.toISOString().substring(0, 10);
      if (!byWeek[key]) byWeek[key] = { count: 0, samples: [] };
      byWeek[key].count++;
      if (byWeek[key].samples.length < 2) {
        byWeek[key].samples.push((m.text || "").substring(0, 80));
      }
    }

    const weeklySummary = Object.entries(byWeek)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([monday, data]) => {
        const d = new Date(monday);
        const end = new Date(d);
        end.setDate(d.getDate() + 6);
        return {
          week: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " - " + end.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          count: data.count,
          samples: data.samples,
        };
      });

    const sorted = messages.slice().sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));

    return {
      channelName,
      channelId: channel.id,
      messageCount: messages.length,
      weeklySummary,
      oldestDate: new Date(parseFloat(sorted[0]?.ts) * 1000).toLocaleDateString(),
      newestDate: new Date(parseFloat(sorted[sorted.length - 1]?.ts) * 1000).toLocaleDateString(),
    };
  } catch (e) {
    console.error("readChannelHistory error:", e.message);
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

    // Detect channel analysis requests early to skip Monday search
    const channelMention = cleanText.match(/<#([A-Z0-9]+)\|([\w-]+)>/) || cleanText.match(/#([\w-]+)/);
    const rawChannelId = cleanText.match(/<#([A-Z0-9]+)\|/)?.[1];
    const isChannelAnalysis = !!(channelMention && (
      cleanText.includes("how many") ||
      cleanText.includes("check") ||
      cleanText.includes("analyze") ||
      cleanText.includes("history") ||
      cleanText.includes("pattern") ||
      cleanText.includes("week") ||
      cleanText.includes("count") ||
      cleanText.includes("track") ||
      cleanText.includes("requests") ||
      cleanText.includes("messages")
    ));

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

    if (!lockedToChannel && !isChannelAnalysis) {
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

    let channelHistory = null;
    if (isChannelAnalysis) {
      const lookupName = rawChannelId || (channelMention && channelMention[1]);
      console.log("Channel history request detected for:", lookupName);
      channelHistory = await readChannelHistory(lookupName, 12);
    }

    const { text: avaResponse, action } = await askAva(messages, {
      ...finalContext,
      slackUser: userId,
      channel,
      channelHistory: channelHistory || undefined,
    });

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
