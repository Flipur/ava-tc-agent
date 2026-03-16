import express from "express";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
import { handleSlackMessage } from "./ava/slackHandler.js";
import { handleApproval, pendingApprovals } from "./ava/approvalHandler.js";
import { startEmailPoller } from "./ava/emailPoller.js";
dotenv.config();

const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  endpoints: "/slack/events",
});

receiver.router.use(express.json());
receiver.router.post("/slack/events", (req, res, next) => {
  if (req.body?.type === "url_verification") {
    return res.json({ challenge: req.body.challenge });
  }
  next();
});

export const slackApp = new App({
  token: process.env.SLACK_BOT_TOKEN,
  receiver,
});

export function isRejection(text) {
  const t = (text || "").toLowerCase();
  return ["reject", "dont send", "hold", "stop", "revise", "change"].some(k => t.includes(k));
}

export function isApproval(text) {
  const t = (text || "").toLowerCase();
  return ["looks good", "approved", "send it", "lgtm", "go ahead", "yes send", "approve", "yes", "do it", "confirmed", "confirm", "ok send", "send"].some(k => t.includes(k));
}

// Deduplication — track recently processed event IDs
const processedEvents = new Set();
function isDuplicate(eventId) {
  if (!eventId) return false;
  if (processedEvents.has(eventId)) return true;
  processedEvents.add(eventId);
  // Clean up after 5 minutes to prevent memory leak
  setTimeout(() => processedEvents.delete(eventId), 5 * 60 * 1000);
  return false;
}

// Single unified message handler — handles ALL messages including mentions
slackApp.message(async ({ message, say }) => {
  if (!message.text || message.subtype) return;
  if (isDuplicate(message.event_ts || message.ts)) return;

  const threadTs = message.thread_ts;

  // Thread reply — check for pending approval first
  if (threadTs) {
    const hasPending = pendingApprovals.has(threadTs);
    console.log("Thread reply detected. thread_ts: " + threadTs + ", hasPending: " + hasPending + ", text: " + message.text);
    if (hasPending && (isApproval(message.text) || isRejection(message.text))) {
      await handleApproval({ message, say });
      return;
    }
  }

  // Only respond to @mentions in channels, or any message in DMs
  const isMention = message.text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`);
  const isDM = message.channel_type === "im";

  if (isMention || isDM) {
    await handleSlackMessage({ event: message, say, type: isDM ? "dm" : "mention" });
  }
});

receiver.router.get("/health", (req, res) => res.send("Ava is online."));

const PORT = process.env.PORT || 3000;
(async () => {
  await slackApp.start(PORT);
  console.log("Ava Stone is live on port " + PORT);
  startEmailPoller();
})();
