import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { askAva } from "./brain.js";
import { slackApp } from "../server.js";
import { getAllActiveDeals } from "./monday.js";
import { getMemoryContext } from "./memory.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROSTER_FILE = path.join(__dirname, "../data/team-roster.json");
const LAST_RUN_FILE = path.join(__dirname, "../data/weekly-coach-last-run.json");

// ── Close stats ───────────────────────────────────────────────────────────────

function closeAuth() {
  return "Basic " + Buffer.from(process.env.CLOSE_API_KEY + ":").toString("base64");
}

async function closeGet(path, params = {}) {
  const url = new URL("https://api.close.com/api/v1" + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  const res = await fetch(url.toString(), { headers: { Authorization: closeAuth() } });
  if (!res.ok) throw new Error("Close " + res.status + " " + path);
  return res.json();
}

async function getCallStatsByUser(startISO, endISO) {
  const userMap = {};
  let skip = 0;
  let hasMore = true;
  while (hasMore && skip < 5000) {
    const data = await closeGet("/activity/call/", {
      date_created__gte: startISO,
      date_created__lte: endISO,
      _limit: 100,
      _skip: skip,
      _fields: "user_id,user_name,duration",
    });
    for (const c of data.data || []) {
      if (!c.user_id) continue;
      if (!userMap[c.user_id]) userMap[c.user_id] = { name: c.user_name || c.user_id, calls: 0, talkTime: 0, answeredCalls: 0 };
      userMap[c.user_id].calls++;
      if (c.duration > 0) { userMap[c.user_id].talkTime += c.duration; userMap[c.user_id].answeredCalls++; }
    }
    hasMore = data.has_more === true;
    skip += 100;
  }
  return userMap;
}

async function getSMSStatsByUser(startISO, endISO) {
  const userMap = {};
  let skip = 0;
  let hasMore = true;
  while (hasMore && skip < 5000) {
    const data = await closeGet("/activity/sms/", {
      date_created__gte: startISO,
      date_created__lte: endISO,
      _limit: 100,
      _skip: skip,
      _fields: "user_id,user_name,direction",
    });
    for (const s of data.data || []) {
      if (!s.user_id) continue;
      if (!userMap[s.user_id]) userMap[s.user_id] = { name: s.user_name || s.user_id, smsOut: 0, smsIn: 0 };
      if (s.direction === "outbound") userMap[s.user_id].smsOut++;
      else userMap[s.user_id].smsIn++;
    }
    hasMore = data.has_more === true;
    skip += 100;
  }
  return userMap;
}

// ── Roster ────────────────────────────────────────────────────────────────────

function loadRoster() {
  try {
    if (fs.existsSync(ROSTER_FILE)) return JSON.parse(fs.readFileSync(ROSTER_FILE, "utf8"));
  } catch (e) { console.error("Roster load error:", e.message); }
  return [];
}

// ── Last-run guard ────────────────────────────────────────────────────────────

function getLastRun() {
  try {
    if (fs.existsSync(LAST_RUN_FILE)) return JSON.parse(fs.readFileSync(LAST_RUN_FILE, "utf8")).ts || 0;
  } catch (e) {}
  return 0;
}

function setLastRun() {
  try {
    const dir = path.dirname(LAST_RUN_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_RUN_FILE, JSON.stringify({ ts: Date.now() }));
  } catch (e) {}
}

// ── Main coach run ────────────────────────────────────────────────────────────

export async function runWeeklyCoach() {
  const roster = loadRoster();
  if (!roster.length) {
    console.log("Weekly coach: no team roster configured — skipping");
    return;
  }

  const now = new Date();
  const weekEnd = now.toISOString();
  const weekStart = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();

  console.log("Weekly coach running for week", weekStart, "→", weekEnd);

  const [callStats, smsStats, activeDeals] = await Promise.all([
    getCallStatsByUser(weekStart, weekEnd).catch(e => { console.error("Call stats error:", e.message); return {}; }),
    getSMSStatsByUser(weekStart, weekEnd).catch(e => { console.error("SMS stats error:", e.message); return {}; }),
    getAllActiveDeals().catch(e => { console.error("Monday error:", e.message); return []; }),
  ]);

  const memoryContext = getMemoryContext();

  for (const member of roster) {
    try {
      await coachMember({ member, callStats, smsStats, activeDeals, weekStart, weekEnd, memoryContext });
    } catch (e) {
      console.error("Weekly coach error for", member.name, e.message);
    }
  }

  setLastRun();
  console.log("Weekly coach complete");
}

async function coachMember({ member, callStats, smsStats, activeDeals, weekStart, weekEnd, memoryContext }) {
  // Match Close stats by name (case-insensitive substring match)
  const callEntry = Object.values(callStats).find(u =>
    u.name.toLowerCase().includes(member.closeName?.toLowerCase() || member.name.toLowerCase())
  );
  const smsEntry = Object.values(smsStats).find(u =>
    u.name.toLowerCase().includes(member.closeName?.toLowerCase() || member.name.toLowerCase())
  );

  // Deals this person is managing as dispo manager
  const memberDeals = activeDeals.filter(d =>
    d.dispoManager && d.dispoManager.toLowerCase().includes(member.name.toLowerCase())
  );

  const weekLabel = new Date(weekStart).toLocaleDateString("en-US", { month: "short", day: "numeric" }) +
    " – " + new Date(weekEnd).toLocaleDateString("en-US", { month: "short", day: "numeric" });

  const statsBlock = [
    "WEEKLY KPIs for " + member.name + " (" + weekLabel + "):",
    "Role: " + (member.role || "unknown"),
    callEntry
      ? "Calls: " + callEntry.calls + " total | " + callEntry.answeredCalls + " answered | avg talk time: " + Math.round(callEntry.talkTime / (callEntry.answeredCalls || 1)) + "s"
      : "Calls: no data in Close",
    smsEntry
      ? "SMS: " + smsEntry.smsOut + " outbound | " + smsEntry.smsIn + " inbound"
      : "SMS: no data in Close",
    memberDeals.length
      ? "Active deals: " + memberDeals.length + " — " + memberDeals.map(d => d.address + (d.coe ? " (COE " + d.coe + ")" : "")).join(", ")
      : "Active deals: none assigned",
    member.targets
      ? "Targets: " + Object.entries(member.targets).map(([k, v]) => k + ": " + v).join(" | ")
      : "",
  ].filter(Boolean).join("\n");

  const prompt = [
    "You are sending a weekly coaching DM to " + member.name + " on your team.",
    "Write it like a direct, personal message from you — not a report, not a bullet list of stats.",
    "Lead with your honest read of their week. Celebrate what went well. Call out gaps directly but constructively.",
    "Give 1-2 specific, actionable suggestions based on their numbers and role.",
    "Keep it under 150 words. Conversational. No headers. No bullet points.",
    "Do NOT start with 'Hey' or 'Hi [name]' — jump straight into the substance.",
    "",
    statsBlock,
  ].join("\n");

  const { text: dmText } = await askAva(
    [{ role: "user", content: prompt }],
    { memoryContext }
  );

  const finalMsg = (dmText || "").trim();
  if (!finalMsg) return;

  await slackApp.client.chat.postMessage({
    channel: member.slackId,
    text: finalMsg,
  });

  console.log("Weekly coach DM sent to", member.name, "(" + member.slackId + ")");
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
// Checks every hour. Fires on Monday between 8-9am PT if not already run this week.

export function startWeeklyCoachScheduler() {
  const roster = loadRoster();
  if (!roster.length) {
    console.log("Weekly coach: data/team-roster.json not found or empty — scheduler inactive");
    return;
  }

  console.log("Weekly coach scheduler started (" + roster.length + " team members)");

  const check = () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
    const isMonday = now.getDay() === 1;
    const isCoachHour = now.getHours() === 8;
    const lastRun = getLastRun();
    const ranThisWeek = (Date.now() - lastRun) < 6 * 24 * 60 * 60 * 1000;

    if (isMonday && isCoachHour && !ranThisWeek) {
      runWeeklyCoach().catch(e => console.error("Weekly coach run error:", e.message));
    }
  };

  check(); // run immediately on startup in case it was missed
  setInterval(check, 60 * 60 * 1000); // check every hour
}
