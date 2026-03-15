import { google } from "googleapis";

export async function sendEmail({ to, subject, body, from = "ava@flipur.io" }) {
  try {
    const privateKey = (process.env.GOOGLE_PRIVATE_KEY || "").replace(/\\n/g, "\n");
    const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;

    if (!privateKey) throw new Error("GOOGLE_PRIVATE_KEY env var is missing");
    if (!clientEmail) throw new Error("GOOGLE_CLIENT_EMAIL env var is missing");

    const auth = new google.auth.JWT(
      clientEmail,
      null,
      privateKey,
      ["https://www.googleapis.com/auth/gmail.send"],
      from
    );

    const gmail = google.gmail({ version: "v1", auth });
    const raw = makeRaw({ to, subject, body, from });

    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw },
    });

    console.log("Ava sent email to " + to);

  } catch (err) {
    console.error("Gmail sendEmail error:", err.message);
    throw err;
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
