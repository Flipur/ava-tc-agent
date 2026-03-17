import pkg from "@slack/bolt";
const { App, ExpressReceiver } = pkg;
import express from "express";
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

  if (threadTs) {
    const hasPending = pendingApprovals.has(threadTs);
    console.log("Thread reply detected. thread_ts: " + threadTs + ", hasPending: " + hasPending + ", text: " + message.text);
    if (hasPending && (isApproval(message.text) || isRejection(message.text))) {
      await handleApproval({ message, say });
      return;
    }
  }

  const isMention = message.text.includes(`<@${process.env.SLACK_BOT_USER_ID}>`);
  const isDM = message.channel_type === "im" || message.channel_type === "mpim";
  const isThreadReply = !!threadTs;

  if (isMention || isDM || isThreadReply) {
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
