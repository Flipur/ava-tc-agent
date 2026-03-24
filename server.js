import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import express from "express";
import dotenv from "dotenv";
import { handleSlackMessage } from "./ava/slackHandler.js";
import { handleApproval, pendingApprovals } from "./ava/approvalHandler.js";
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

receiver.router.get("/monday/board/:boardId/group/:groupId", async (req, res) => {
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
  return ["reject", "dont send", "hold", "stop", "revise", "change"].some(k =>
    t.includes(k)
  );
}

export function isApproval(text) {
  const t = (text || "").toLowerCase();
  return [
    "looks good", "approved", "send it", "lgtm", "go ahead",
    "yes send", "approve", "yes", "do it", "confirmed", "confirm",
    "ok send", "send",
  ].some(k => t.includes(k));
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
  const isMention = message.text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`);
  const isDM = message.channel_type === "im" || message.channel_type === "mpim";

  if (threadTs) {
    const hasPending = pendingApprovals.has(threadTs);
    console.log(
      "Thread reply detected. thread_ts: " + threadTs +
      ", hasPending: " + hasPending +
      ", text: " + message.text
    );
    if (hasPending) {
      if (isApproval(message.text) || isRejection(message.text)) {
        await handleApproval({ message, say });
      }
      return;
    }
  }

  const isTaggedThreadReply = !!threadTs && isMention;
  if (isMention || isDM || isTaggedThreadReply) {
    await handleSlackMessage({ event: message, say, type: isDM ? "dm" : "mention" });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;

(async () => {
  await slackApp.start(PORT);
  console.log("Ava Stone is live on port " + PORT);
  startEmailPoller();
})();
