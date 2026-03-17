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
    `From: Ava Stone - Flipur TC <${from}>`,
    `To: ${Array.isArray(to) ? to.join(", ") : to}`,
  ];
  if (cc && cc.length) headers.push(`Cc: ${Array.isArray(cc) ? cc.join(", ") : cc}`);
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`);
  if (references) headers.push(`References: ${references}`);
  headers.push(`Subject: ${subject}`);
  headers.push("MIME-Version: 1.0");

  if (!hasAttachments) {
    headers.push("Content-Type: text/plain; charset=utf-8", "", body);
    return Buffer.from(headers.join("\n")).toString("base64url");
  }

  // Multipart with attachments
  headers.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  headers.push("");

  const parts = [];

  // Text body part
  parts.push([
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n"));

  // Attachment parts
  for (const att of attachments) {
    parts.push([
      `--${boundary}`,
      `Content-Type: ${att.contentType || "application/octet-stream"}`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${att.filename}"`,
      "",
      att.content,
    ].join("\n"));
  }

  parts.push(`--${boundary}--`);

  const fullMessage = headers.join("\n") + "\n" + parts.join("\n")
