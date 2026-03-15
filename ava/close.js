export async function updateCloseDeal({ leadId, note }) {
  try {
    const res = await fetch("https://api.close.com/api/v1/activity/note/", {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(process.env.CLOSE_API_KEY + ":").toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        lead_id: leadId,
        note,
      }),
    });

    const data = await res.json();
    console.log(`Close CRM updated for lead ${leadId}`);
    return data;

  } catch (err) {
    console.error("Close CRM error:", err);
    throw err;
  }
}
