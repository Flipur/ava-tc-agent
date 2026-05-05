import { fetchUnreadEmails } from "./gmail.js";
import { askAva } from "./brain.js";
import { slackApp } from "../server.js";
import { pendingApprovals, savePending } from "./approvalHandler.js";

const TC_CHANNEL = process.env.SLACK_TC_CHANNEL;
const POLL_INTERVAL = 2 * 60 * 1000;

export function startEmailPoller() {
  if (!TC_CHANNEL) {
    console.error("SLACK_TC_CHANNEL not set — email poller disabled");
    return;
  }
  console.log("Ava email poller started — checking every 2 minutes, approvals → #tc");
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
  const allTo = email.replyTo;
  const allCc = email.allRecipients.filter(r => r !== email.replyTo).join(", ");

  const prompt = [
    "You received an email. Read it and draft a reply if one is needed.",
    "From: " + email.from,
    "Subject: " + email.subject,
    "All recipients (Reply All): To=" + allTo + (allCc ? " CC=" + allCc : ""),
    "Body: " + email.body,
    "",
    "REPLY ALL RULE: Always reply to ALL recipients unless spam, automated, or no-reply.",
    "Use to: " + allTo + " and cc: " + allCc + " in your send_email payload.",
    "APPROVAL REQUIRED: Every send_email action MUST have requiresApproval: true. Never auto-send.",
    "If no reply needed (spam, automated, no-reply), use slack_message action.",
    "Keep your Slack summary brief — what the email is about and what you drafted.",
    "End with: _Reply *looks good* to send, or tell me what to change._",
  ].join("\n");

  const { text: avaResponse, action } = await askAva(
    [{ role: "user", content: prompt }],
    {}
  );

  // Force requiresApproval for any email action regardless of what AVA returned
  if (action && action.type === "send_email") {
    action.requiresApproval = true;
  }

  const fromName = email.from.split("<")[0].trim() || email.from;
  const header = "*New email* from *" + fromName + "*\n*Subject:* " + email.subject;

  const slackMsg = await slackApp.client.chat.postMessage({
    channel: TC_CHANNEL,
    text: header + "\n\n" + avaResponse,
  });

  if (action && action.requiresApproval) {
    pendingApprovals.set(slackMsg.ts, {
      action,
      channel: TC_CHANNEL,
      requestedBy: "email_poller",
      createdAt: Date.now(),
    });
    savePending(pendingApprovals);
  }
}
