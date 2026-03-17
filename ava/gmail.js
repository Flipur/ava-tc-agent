import { google } from "googleapis";

function getAuth() {
  const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  return new google.auth.JWT(
    clientEmail,
    null,
    privateKey,
    [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/gmail.modify",
    ],
    "ava@flipur.io"
  );
}

function buildMimeMessage({ to, cc, subject, body, from = "ava@flipur.io", inReplyTo, references, attachments }) {
  const boundary = "flipur_boundary_" + Date.now();
  const hasAttachments = attachments && attachments.length > 0;

  const headers = [
    "From: Ava Stone - Flipur TC <" + from + ">",
    "To: " + (Array.isArray(to) ? to.join(", ") : to),
  ];
  if (cc && cc.length) headers.push("Cc: " + (Array.isArray(cc) ? cc.join(", ") : cc));
  if (inReplyTo) headers.push("In-Reply-To: " + inReplyTo);
  if (references) headers.push("References: " + references);
  headers.push("Subject: " + subject);
  headers.push("MIME-Version: 1.0");

  if (!hasAttachments) {
    headers.push("Content-Type: text/plain; charset=utf-8", "", body);
    return Buffer.from(headers.join("\n")).toString("base64url");
  }

  headers.push("Content-Type: multipart/mixed; boundary=\"" + boundary + "\"");
  headers.push("");

  const parts = [];

  parts.push([
    "--" + boundary,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n"));

  for (const att of attachments) {
    parts.push([
      "--" + boundary,
      "Content-Type: " + (att.contentType || "application/octet-stream"),
      "Content-Transfer-Encoding: base64",
      "Content-Disposition: attachment; filename=\"" + att.filename + "\"",
      "",
      att.content,
    ].join("\n"));
  }

  parts.push("--" + boundary + "--");

  const fullMessage = headers.join("\n") + "\n" + parts.join("\n");
  return Buffer.from(fullMessage).toString("base64url");
}

export async function sendEmail({ to, cc, subject, body, from = "ava@flipur.io", threadId, inReplyTo, references, attachments }) {
  try {
    const gmail = google.gmail({ version: "v1", auth: getAuth() });
    const raw = buildMimeMessage({ to, cc, subject, body, from, inReplyTo, references, attachments });
    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    });
    console.log("Ava sent email to " + to + (cc ? " CC: " + cc : "") + (attachments?.length ? " with " + attachments.length + " attachment(s)" : ""));
  } catch (err) {
    console.error("Gmail sendEmail error:", err.message);
    throw err;
  }
}

export async function fetchUnreadEmails() {
  try {
    const gmail = google.gmail({ version: "v1", auth: getAuth() });
    const list = await gmail.users.messages.list({
      userId: "me",
      q: "is:unread -from:ava@flipur.io",
      maxResults: 10,
    });
    const messages = list.data.messages || [];
    const emails = [];
    for (const msg of messages) {
      const full = await gmail.users.messages.get({
        userId: "me",
        id: msg.id,
        format: "full",
      });
      const headers = full.data.payload.headers;
      const subject    = headers.find(h => h.name === "Subject")?.value || "(no subject)";
      const from       = headers.find(h => h.name === "From")?.value || "";
      const to         = headers.find(h => h.name === "To")?.value || "";
      const cc         = headers.find(h => h.name === "Cc")?.value || "";
      const replyTo    = headers.find(h => h.name === "Reply-To")?.value || "";
      const messageId  = headers.find(h => h.name === "Message-ID")?.value || "";
      const references = headers.find(h => h.name === "References")?.value || "";
      const date       = headers.find(h => h.name === "Date")?.value || "";
      const threadId   = full.data.threadId;

      const replyToAddress = replyTo || from;
      const allRecipients = [to, cc]
        .join(",")
        .split(",")
        .map(r => r.trim())
        .filter(r => r && !r.toLowerCase().includes("ava@flipur.io"));

      let body = "";
      const parts = full.data.payload.parts || [full.data.payload];
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        }
      }

      emails.push({
        id: msg.id,
        threadId,
        subject,
        from,
        to,
        cc,
        replyTo: replyToAddress,
        allRecipients,
        messageId,
        references,
        date,
        body: body.slice(0, 1000),
      });

      await gmail.users.messages.modify({
        userId: "me",
        id: msg.id,
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
    }
    return emails;
  } catch (err) {
    console.error("Gmail fetchUnreadEmails error:", err.message);
    return [];
  }
}
