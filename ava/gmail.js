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

export async function sendEmail({ to, subject, body, from = "ava@flipur.io" }) {
  try {
    const gmail = google.gmail({ version: "v1", auth: getAuth() });
    const raw = makeRaw({ to, subject, body, from });
    await gmail.users.messages.send({ userId: "me", requestBody: { raw } });
    console.log("Ava sent email to " + to);
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
      const subject = headers.find(h => h.name === "Subject")?.value || "(no subject)";
      const from    = headers.find(h => h.name === "From")?.value || "";
      const to      = headers.find(h => h.name === "To")?.value || "";
      const date    = headers.find(h => h.name === "Date")?.value || "";

      let body = "";
      const parts = full.data.payload.parts || [full.data.payload];
      for (const part of parts) {
        if (part.mimeType === "text/plain" && part.body?.data) {
          body = Buffer.from(part.body.data, "base64").toString("utf-8");
          break;
        }
      }

      emails.push({ id: msg.id, subject, from, to, date, body: body.slice(0, 1000) });

      // Mark as read so we don't process it again
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

function makeRaw({ to, subject, body, from }) {
  const message = [
    "From: Ava Stone - Flipur TC <" + from + ">",
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\n");
  return Buffer.from(message).toString("base64url");
}
