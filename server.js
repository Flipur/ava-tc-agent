import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import express from "express";
import dotenv from "dotenv";
import { handleSlackMessage } from "./ava/slackHandler.js";
import { handleApproval, pendingApprovals, savePending } from "./ava/approvalHandler.js";
import { startEmailPoller } from "./ava/emailPoller.js";
import {
  getDealContext,
  getAllActiveDeals,
  searchDealsByTerm,
  getGroupItems,
  getBoardGroups,
  getAnyBoardItems,
  getAnyBoardColumns,
  mondayQuery,
} from "./ava/monday.js";

dotenv.config();

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: "/slack/events",
});
receiver.router.use(express.json());

// ── Close API helper ─────────────────────────────────────────────────────────
async function closeRequest(path, params = {}) {
  const url = new URL(`https://api.close.com/api/v1${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: {
      Authorization:
        "Basic " +
        Buffer.from(process.env.CLOSE_API_KEY + ":").toString("base64"),
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Close API ${res.status}: ${txt}`);
  }
  return res.json();
}

// ── Health ────────────────────────────────────────────────────────────────────
receiver.router.get("/health", (req, res) => res.send("Ava is online."));

// ── Monday — Escrow board (MONDAY_BOARD_ID) ───────────────────────────────────
receiver.router.get("/monday/active-deals", async (req, res) => {
  try {
    const deals = await getAllActiveDeals();
    res.json({ deals });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get("/monday/search", async (req, res) => {
  try {
    const { term } = req.query;
    if (!term) return res.status(400).json({ error: "term required" });
    const result = await searchDealsByTerm(term);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get("/monday/groups", async (req, res) => {
  try {
    const groups = await getBoardGroups();
    res.json({ groups });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get("/monday/group/:groupId", async (req, res) => {
  try {
    const { groupId } = req.params;
    const result = await getGroupItems(groupId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Monday — Any board by ID ──────────────────────────────────────────────────
receiver.router.get("/monday/board/:boardId/schema", async (req, res) => {
  try {
    const data = await getAnyBoardColumns(req.params.boardId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get("/monday/board/:boardId/items", async (req, res) => {
  try {
    const data = await getAnyBoardItems(req.params.boardId);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

receiver.router.get(
  "/monday/board/:boardId/group/:groupId",
  async (req, res) => {
    try {
      const { boardId, groupId } = req.params;
      let allItems = [];
      let cursor = null;
      do {
        const cursorParam = cursor ? `, cursor: "${cursor}"` : "";
        const result = await mondayQuery(`query {
          boards(ids: ${boardId}) {
            groups(ids: "${groupId}") {
              title
              items_page(limit: 200${cursorParam}) {
                cursor
                items { id name column_values { id text value } }
              }
            }
          }
        }`);
        const group = result?.data?.boards?.[0]?.groups?.[0];
        if (!group) break;
        const page = group.items_page;
        allItems.push(...page.items);
        cursor = page.cursor || null;
      } while (cursor);
      res.json({ total: allItems.length, items: allItems });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
);

// ── Close CRM — Calls by user (for weekly report) ────────────────────────────
// GET /close/calls/by-user?start=ISO&end=ISO
// Returns: { users: [{name, calls, avgDuration, totalDuration}] }
// Paginates through all calls in the date range, groups by user, computes
// total call count and average talk time (duration in seconds).
receiver.router.get("/close/calls/by-user", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query params required (ISO 8601)" });
    }

    const userMap = {}; // userId -> { name, calls, totalDuration }
    let hasMore = true;
    let skip = 0;
    const limit = 100;

    while (hasMore) {
      const data = await closeRequest("/activity/call/", {
        date_created__gte: start,
        date_created__lte: end,
        _limit: limit,
        _skip: skip,
        _fields: "user_id,user_name,duration,call_status",
      });

      const items = data.data || [];

      for (const call of items) {
        // Only count completed answered calls with real duration
        if (!call.user_id) continue;
        if (!userMap[call.user_id]) {
          userMap[call.user_id] = {
            name: call.user_name || call.user_id,
            calls: 0,
            totalDuration: 0,
            answeredCalls: 0,
          };
        }
        userMap[call.user_id].calls += 1;
        if (call.duration && call.duration > 0) {
          userMap[call.user_id].totalDuration += call.duration;
          userMap[call.user_id].answeredCalls += 1;
        }
      }

      hasMore = data.has_more === true;
      skip += limit;

      // Safety cap at 5000 calls per request
      if (skip >= 5000) break;
    }

    const users = Object.values(userMap)
      .map((u) => ({
        name: u.name,
        calls: u.calls,
        avgDuration:
          u.answeredCalls > 0
            ? Math.round(u.totalDuration / u.answeredCalls)
            : 0,
        totalDuration: u.totalDuration,
        answeredCalls: u.answeredCalls,
      }))
      .sort((a, b) => b.calls - a.calls);

    res.json({ start, end, total: users.length, users });
  } catch (err) {
    console.error("GET /close/calls/by-user error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Close CRM — SMS by user (for weekly report) ──────────────────────────────
// GET /close/sms/by-user?start=ISO&end=ISO
// Returns: { users: [{name, smsIn, smsOut, responseRate}] }
// Paginates all SMS in the date range, groups by user, splits inbound/outbound.
// responseRate = inbound / (inbound + outbound) * 100
receiver.router.get("/close/sms/by-user", async (req, res) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start and end query params required (ISO 8601)" });
    }

    const userMap = {}; // userId -> { name, smsIn, smsOut }
    let hasMore = true;
    let skip = 0;
    const limit = 100;

    while (hasMore) {
      const data = await closeRequest("/activity/sms/", {
        date_created__gte: start,
        date_created__lte: end,
        _limit: limit,
        _skip: skip,
        _fields: "user_id,user_name,direction",
      });

      const items = data.data || [];

      for (const sms of items) {
        if (!sms.user_id) continue;
        if (!userMap[sms.user_id]) {
          userMap[sms.user_id] = {
            name: sms.user_name || sms.user_id,
            smsIn: 0,
            smsOut: 0,
          };
        }
        if (sms.direction === "inbound") {
          userMap[sms.user_id].smsIn += 1;
        } else {
          userMap[sms.user_id].smsOut += 1;
        }
      }

      hasMore = data.has_more === true;
      skip += limit;

      if (skip >= 5000) break;
    }

    const users = Object.values(userMap)
      .map((u) => ({
        name: u.name,
        smsIn: u.smsIn,
        smsOut: u.smsOut,
        responseRate:
          u.smsIn + u.smsOut > 0
            ? Math.round((u.smsIn / (u.smsIn + u.smsOut)) * 100)
            : 0,
      }))
      .sort((a, b) => b.smsOut - a.smsOut);

    res.json({ start, end, total: users.length, users });
  } catch (err) {
    console.error("GET /close/sms/by-user error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Slack URL verification ────────────────────────────────────────────────────
receiver.router.post("/slack/events", (req, res, next) => {
  if (req.body?.type === "url_verification") {
    return res.json({ challenge: req.body.challenge });
  }
  next();
});

// ── Slack App ─────────────────────────────────────────────────────────────────
export const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

export function isRejection(text) {
  const t = (text || "").toLowerCase();
  return ["reject", "dont send", "hold", "stop", "revise", "change"].some((k) =>
    t.includes(k)
  );
}

export function isApproval(text) {
  const t = (text || "").toLowerCase();
  return [
    "looks good",
    "approved",
    "send it",
    "lgtm",
    "go ahead",
    "yes send",
    "approve",
    "yes",
    "do it",
    "confirmed",
    "confirm",
    "ok send",
    "send",
  ].some((k) => t.includes(k));
}

const processedEvents = new Set();
function isDuplicate(eventId) {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);
  return false;
}

slackApp.message(async ({ message, say }) => {
  if (!message.text || message.subtype) return;
  if (isDuplicate(message.event_ts || message.ts)) return;

  const threadTs = message.thread_ts;
  const isMention = message.text.includes(
    `<@${process.env.SLACK_BOT_USER_ID}>`
  );
  const isDM =
    message.channel_type === "im" || message.channel_type === "mpim";

  if (threadTs) {
    const hasPending = pendingApprovals.has(threadTs);
    console.log(
      "Thread reply detected. thread_ts: " +
        threadTs +
        ", hasPending: " +
        hasPending +
        ", text: " +
        message.text
    );
    if (hasPending) {
      const pending = pendingApprovals.get(threadTs);
      const isStale = pending && Date.now() - (pending.createdAt || 0) > 15 * 60 * 1000;
      const newTaskPattern = /invoice|contract|deal text|inspection|bid|email|docusign|assign|report|estimate|intro/i;
      const isNewTask = newTaskPattern.test(message.text);
      if (isStale) {
        pendingApprovals.delete(threadTs);
        savePending(pendingApprovals);
      } else if (!isNewTask) {
        if (isApproval(message.text) || isRejection(message.text)) {
          await handleApproval({ message, say });
        }
        return;
      }
      // stale or new task — fall through to handleSlackMessage
    }
  }

  const isTaggedThreadReply = !!threadTs && isMention;
  if (isMention || isDM || isTaggedThreadReply) {
    await handleSlackMessage({
      event: message,
      say,
      type: isDM ? "dm" : "mention",
    });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
(async () => {
  await slackApp.start(PORT);
  console.log("Ava Stone is live on port " + PORT);
  startEmailPoller();
})();
