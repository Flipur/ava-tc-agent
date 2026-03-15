import { fetchUnreadEmails } from "./gmail.js";
import { askAva } from "./brain.js";
import { slackApp } from "../server.js";
import { pendingApprovals } from "./approvalHandler.js";

const SLACK_CHANNEL = process.env.SLACK_ALERT_CHANNEL || "general";
const POLL_INTERVAL = 2 * 60 * 1000;

export function startEmailPoller() {
  console.log("Ava email poller started — checking every 2 minutes");
  setInterval(pollEmails, POLL_INTERVAL);
  pollEmails();
}

async function pollEmails() {
  try {
    const emails = await fetchUnreadEmails();
    if (!emails.length) return;
    console.log("Ava found " + emails.length + " new email(s)");
    for (const email of emails) {
      await processEmail(email);
    }
  } catch (err) {
    console.error("Email poller error:", err.message);
  }
}

async function processEmail(email) {
  const prompt = [
    "You received an email. Read it and decide what to do.",
    "From: " + email.from,
    "Subject: " + email.subject,
    "Body: " + email.body,
    "",
    "Post a brief 1-2 sentence summary to Slack, then draft a reply if one is needed.",
    "If no reply is needed (spam, automated, no-reply), just summarize and use slack_message action.",
    "Keep your Slack summary short — one line max.",
  ].join("\n");

  const { text: avaResponse, action } = await askAva(
    [{ role: "user", content: prompt }],
    {}
  );

  // Post clean notification as new message (each email gets its own thread)
  const fromName = email.from.split("<")[0].trim() || email.from;
  const header = "*New email* from *" + fromName + "*\n*Subject:* " + email.subject;

  const slackMsg = await slackApp.client.chat.postMessage({
    channel: SLACK_CHANNEL,
    text: header + "\n\n" + avaResponse,
  });

  // Store approval keyed to this message's ts
  if (action && action.requiresApproval) {
    pendingApprovals.set(slackMsg.ts, {
      action,
      channel: SLACK_CHANNEL,
      requestedBy: "email_poller",
      createdAt: Date.now(),
    });
  }
}
