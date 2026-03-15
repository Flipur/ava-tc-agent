import { fetchUnreadEmails, sendEmail } from "./gmail.js";
import { askAva } from "./brain.js";
import { slackApp } from "../server.js";
import { pendingApprovals } from "./approvalHandler.js";

const SLACK_CHANNEL = process.env.SLACK_ALERT_CHANNEL || "general";
const POLL_INTERVAL = 2 * 60 * 1000; // every 2 minutes

export function startEmailPoller() {
  console.log("Ava email poller started — checking every 2 minutes");
  setInterval(pollEmails, POLL_INTERVAL);
  pollEmails(); // run immediately on start
}

async function pollEmails() {
  try {
    const emails = await fetchUnreadEmails();
    if (!emails.length) return;

    console.log(`Ava found ${emails.length} new email(s)`);

    for (const email of emails) {
      await processEmail(email);
    }
  } catch (err) {
    console.error("Email poller error:", err.message);
  }
}

async function processEmail(email) {
  const prompt = [
    "You just received an email. Decide what to do:",
    "",
    "From: " + email.from,
    "Subject: " + email.subject,
    "Body: " + email.body,
    "",
    "Options:",
    "1. Draft a reply and request team approval before sending",
    "2. Alert the team in Slack with a summary if urgent",
    "3. Both — alert Slack AND draft a reply",
    "",
    "Always notify the team in Slack with a brief summary of this email.",
    "If a reply is needed, draft it and request approval.",
  ].join("\n");

  const { text: avaResponse, action } = await askAva(
    [{ role: "user", content: prompt }],
    { emailContext: email }
  );

  // Always post a Slack notification about the incoming email
  const slackMsg = await slackApp.client.chat.postMessage({
    channel: SLACK_CHANNEL,
    text: [
      "*New email received by Ava*",
      "*From:* " + email.from,
      "*Subject:* " + email.subject,
      "",
      avaResponse,
    ].join("\n"),
  });

  // If Ava wants to send a reply — store as pending approval
  if (action && action.requiresApproval && action.type === "send_email") {
    pendingApprovals.set(slackMsg.ts, {
      action,
      channel: SLACK_CHANNEL,
      requestedBy: "email_poller",
      createdAt: Date.now(),
    });
  }
}
