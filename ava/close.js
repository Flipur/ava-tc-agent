const BASE = "https://api.close.com/api/v1";

function auth() {
  return "Basic " + Buffer.from(process.env.CLOSE_API_KEY + ":").toString("base64");
}

async function closeGet(path) {
  const res = await fetch(BASE + path, { headers: { Authorization: auth() } });
  if (!res.ok) throw new Error("Close API " + res.status + " " + path);
  return res.json();
}

async function closePost(path, body) {
  const res = await fetch(BASE + path, {
    method: "POST",
    headers: { Authorization: auth(), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Close API " + res.status + " " + path);
  return res.json();
}

// ── Read ──────────────────────────────────────────────────────────────────────

export async function searchCloseLeads(query) {
  try {
    // Phone numbers need the phone_number: prefix in Close's query syntax
    const isPhone = /^\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}$/.test(query.trim());
    const q = isPhone ? `phone_number:"${query.trim()}"` : query;
    const data = await closeGet(`/lead/?query=${encodeURIComponent(q)}&_limit=10&_fields=id,display_name,status_label,contacts,opportunities,addresses`);
    return data.data || [];
  } catch (e) {
    console.error("searchCloseLeads error:", e.message);
    return [];
  }
}

export async function getCloseLeadById(leadId) {
  try {
    return await closeGet(`/lead/${leadId}/`);
  } catch (e) {
    console.error("getCloseLeadById error:", e.message);
    return null;
  }
}

export async function getCloseContact(contactId) {
  try {
    return await closeGet(`/contact/${contactId}/`);
  } catch (e) {
    console.error("getCloseContact error:", e.message);
    return null;
  }
}

export async function getCloseActivities(leadId, limit = 20) {
  try {
    const data = await closeGet(`/activity/?lead_id=${leadId}&_limit=${limit}&_order_by=-date_created`);
    return data.data || [];
  } catch (e) {
    console.error("getCloseActivities error:", e.message);
    return [];
  }
}

export async function getCloseCallLog(leadId, limit = 10) {
  try {
    const data = await closeGet(`/activity/call/?lead_id=${leadId}&_limit=${limit}&_order_by=-date_created`);
    return data.data || [];
  } catch (e) {
    console.error("getCloseCallLog error:", e.message);
    return [];
  }
}

export async function getCloseEmailLog(leadId, limit = 10) {
  try {
    const data = await closeGet(`/activity/email/?lead_id=${leadId}&_limit=${limit}&_order_by=-date_created`);
    return data.data || [];
  } catch (e) {
    console.error("getCloseEmailLog error:", e.message);
    return [];
  }
}

export async function getCloseSMSLog(leadId, limit = 10) {
  try {
    const data = await closeGet(`/activity/sms/?lead_id=${leadId}&_limit=${limit}&_order_by=-date_created`);
    return data.data || [];
  } catch (e) {
    console.error("getCloseSMSLog error:", e.message);
    return [];
  }
}

// Returns a clean summary object for injection into brain.js context
export async function getCloseContext(query) {
  if (!query || !process.env.CLOSE_API_KEY) return null;
  try {
    const leads = await searchCloseLeads(query);
    if (!leads.length) return null;

    const lead = leads[0];
    const contacts = (lead.contacts || []).map(c => ({
      name: c.name,
      emails: (c.emails || []).map(e => e.email),
      phones: (c.phones || []).map(p => p.phone),
    }));

    const [calls, sms, emails] = await Promise.all([
      getCloseCallLog(lead.id, 5),
      getCloseSMSLog(lead.id, 5),
      getCloseEmailLog(lead.id, 5),
    ]);

    const fmtDate = ts => ts ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

    return {
      leadId: lead.id,
      leadName: lead.display_name,
      status: lead.status_label,
      contacts,
      recentCalls: calls.map(c => ({
        date: fmtDate(c.date_created),
        direction: c.direction,
        duration: c.duration,
        outcome: c.disposition,
        note: c.note,
      })),
      recentSMS: sms.map(s => ({
        date: fmtDate(s.date_created),
        direction: s.direction,
        text: s.text,
      })),
      recentEmails: emails.map(e => ({
        date: fmtDate(e.date_created),
        subject: e.subject,
        direction: e.direction,
      })),
    };
  } catch (e) {
    console.error("getCloseContext error:", e.message);
    return null;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function updateCloseDeal({ leadId, note }) {
  try {
    const data = await closePost("/activity/note/", { lead_id: leadId, note });
    console.log("Close CRM updated for lead", leadId);
    return data;
  } catch (err) {
    console.error("Close CRM error:", err);
    throw err;
  }
}
