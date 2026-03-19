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

function getWeekNumber(date) {
  const start = new Date(date.getFullYear(), 0, 1);
  return Math.floor((date - start) / (7 * 24 * 60 * 60 * 1000)) + 1;
}

async function readChannelHistory(channelName, weeks = 12) {
  try {
    // Paginate through all channels to find by name or ID
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
      console.log("Channel not found:", channelName, "searched:", allChannels.length, "channels");
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

    return {
      channelName,
      channelId: channel.id,
      messageCount: messages.length,
      messages: messages.map(m => ({
        ts: m.ts,
        text: (m.text || "").substring(0, 200),
        date: new Date(parseFloat(m.ts) * 1000).toLocaleDateString("en-US"),
        week: getWeekNumber(new Date(parseFloat(m.ts) * 1000)),
      })),
    };
  } catch (e) {
    console.error("readChannelHistor
