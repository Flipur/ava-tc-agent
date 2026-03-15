import { google } from "googleapis";

export async function sendEmail({ to, subject, body, from = "ava@flipur.io" }) {
  try {
    const auth = new google.auth.GoogleAuth({
      credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON),
      scopes: ["https://www.googleapis.com/auth/gmail.send"],
      subject: from,
    });

    const gmail = google.gmail({ version: "v1", auth });
    const raw = makeRaw({ to, subject, body, from });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    console.log(`Ava sent email to ${to}`);

  } catch (err) {
    console.error("Gmail sendEmail error:", err);
    throw err;
  }
}

function makeRaw({ to, subject, body, from }) {
  const message = [
    `From: Ava Stone - Flipur TC <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ].join("\n");

  return Buffer.from(message).toString("base64url");
}
