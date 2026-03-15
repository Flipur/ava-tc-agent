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

// Handle Slack's URL verification challenge
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
  return ["looks good", "approved", "send it", "lgtm", "go ahead", "yes send", "approve"].some(k => t.includes(k));
}

// Ava responds when mentioned in any channel
slackApp.event("app_mention", async ({ event, say }) => {
  await handleSlackMessage({ event, say, type: "mention" });
});

// Ava responds in DMs and watches for approvals in threads
slackApp.message(async ({ message, say }) => {
  if (message.channel_type === "im") {
    await handleSlackMessage({ event: message, say, type: "dm" });
    return;
  }
  if (message.thread_ts && isApproval(message.text)) {
    await handleApproval({ message, say });
  }
});

// Health check so Render knows the service is alive
receiver.router.get("/health", (req, res) => res.send("Ava is online."));

const PORT = process.env.PORT || 3000;
(async () => {
  await slackApp.start(PORT);
  console.log(`Ava Stone is live on port ${PORT}`);
})();
