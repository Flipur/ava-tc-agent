import express from "express";
import { App, ExpressReceiver } from "@slack/bolt";
import dotenv from "dotenv";
import { handleSlackMessage } from "./ava/slackHandler.js";
import { handleApproval, pendingApprovals } from "./ava/approvalHandler.js";

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

export function isRejection(text = "") {
  const t = text.toLowerCase();
  return ["reject", "don't send", "hold", "stop", "no don't", "revise", "change"].some(k => t.includes(k));
}

function isApproval(text = "") {
  const t = text.toLowerCase();
  return ["looks good", "approved", "send it", "lgtm", "go ahead", "yes send", "approve", "yes", "do it", "confirmed", "confirm", "ok send", "send"].some(k => t.includes(k));
}

// Ava responds when mentioned in any channel
slackApp.event("app_mention", async ({ event, say }) => {
  await handleSlackMessage({ event, say, type: "mention" });
});

// Ava responds in DMs and watches for approvals in threads
slackApp.message(async ({ message, say }) => {
  if (!message.text || message.subtype) return;

  // Check if this is a reply in a thread with a pending approval
  if (message.thread_ts) {
    const hasPending = pendingApprovals.has(message.thread_ts);
    console.log(`Thread reply detected. thread_ts: ${message.thread_ts}, hasPending: ${hasPending}, text: ${message.text}`);
    
    if (hasPending && isApproval(message.text)) {
      await handleApproval({ message, say });
      return;
    }
    if (hasPending && isRejection(message.text)) {
      await handleApproval({ message, say });
      return;
    }
  }

  if (message.channel_type === "im") {
    await handleSlackMessage({ event: message, say, type: "dm" });
    return;
  }
});

// Health check
receiver.router.get("/health", (req, res) => res.send("Ava is online."));

const PORT = process.env.PORT || 3000;
(async () => {
  await slackApp.start(PORT);
  console.log(`Ava Stone is live on port ${PORT}`);
})();
