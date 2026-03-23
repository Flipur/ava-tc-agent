import Anthropic from "@anthropic-ai/sdk";
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getCompanyCamContext } from "./companycam.js";
import { slackApp } from "../server.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Resolve gallery URLs to project URLs by searching CompanyCam by address
export async function resolveCompanyCamUrl(url, propertyAddress) {
  if (!url) return null;
  if (url.includes("/galleries/")) {
    try {
      const query = (propertyAddress || "").split(",")[0].trim();
      console.log("Resolving gallery URL via address search:", query);
      const res = await fetch("https://api.companycam.com/v2/projects?query=" + encodeURIComponent(query), {
        headers: { Authorization: "Bearer " + process.env.COMPANYCAM_API_KEY }
      });
      const projects = await res.json();
      if (Array.isArray(projects) && projects.length > 0) {
        console.log("Resolved gallery to project:", projects[0].id);
        return "https://app.companycam.com/projects/" + projects[0].id;
      }
      console.log("No projects found for address:", query);
    } catch(e) {
      console.error("Gallery resolve error:", e.message);
    }
  }
  return url;
}

// Scan a Slack channel for a CompanyCam link
export async function findCompanyCamLinkInChannel(channelId) {
  try {
    const res = await slackApp.client.conversations.history({
      channel: channelId,
      limit: 200,
    });
    for (const msg of res.messages || []) {
      const text = msg.text || "";
      const match = text.match(/https?:\/\/app\.companycam\.com\/[^\s>|]+/);
      if (match) return match[0];
    }
    return null;
  } catch (e) {
    console.error("findCompanyCamLinkInChannel error:", e.message);
    return null;
  }
}

// Analyze photos with Claude Vision
async function analyzePhotosWithVision(photos, acqNotes) {
  const imageContents = [];

  for (const photo of photos.slice(0, 12)) {
    if (!photo.url) continue;
    try {
      const response = await fetch(photo.url);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      imageContents.push({
        type: "image",
        source: { type: "base64", media_type: "image/jpeg", data: base64 },
      });
      if (photo.caption) {
        imageContents.push({ type: "text", text: "Photo caption: " + photo.caption });
      }
    } catch (e) {
      console.error("Failed to fetch photo:", e.message);
    }
  }

  if (imageContents.length === 0 && !acqNotes) return null;

  const prompt = `You are a professional property inspector analyzing a property for Flipur Companies, a real estate investment firm.

ACQ Team Notes: ${acqNotes || "No additional notes provided."}

${imageContents.length > 0 ? "Analyze these property photos carefully and identify ALL visible deficiencies, issues, and conditions." : "Based on the ACQ notes provided, generate a professional inspection assessment."}

For each issue found identify:
1. The specific area/location (roof, bathroom, kitchen, foundation, electrical, plumbing, hvac, interior, exterior, garage)
2. The exact location within that area
3. A detailed professional description of the deficiency
4. Severity: CRITICAL (immediate safety hazard), MAJOR (significant deficiency affecting habitability), MODERATE (needs repair within scope), MINOR (cosmetic)
5. Whether it needs to be flagged/highlighted in red

Respond ONLY with valid JSON — no markdown, no backticks:
{
  "overallCondition": "CRITICAL / NOT HABITABLE or POOR or FAIR or GOOD",
  "overallSummary": "2-3 sentence summary of overall property condition",
  "criticalIssues": ["concise issue description", "..."],
  "majorIssues": ["concise issue description", "..."],
  "findings": [
    {
      "area": "interior",
      "location": "Living Room Ceiling",
      "description": "Large section of drywall ceiling has collapsed near living room entry. Exposed wood framing visible. Evidence of moisture saturation. Life-safety hazard.",
      "severity": "CRITICAL",
      "flagged": true
    }
  ],
  "followUpQuestions": [
    "Any smell of mold or moisture inside the property?",
    "What is the overall roof condition — any visible damage or missing shingles?",
    "Is the electrical panel original or has it been updated?",
    "Any visible plumbing leaks or water stains under sinks?",
    "Any foundation cracks or signs of settling?"
  ]
}`;

  const res = await claude.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 4000,
    messages: [{
      role: "user",
      content: imageContents.length > 0
        ? [...imageContents, { type: "text", text: prompt }]
        : [{ type: "text", text: prompt }],
    }],
  });

  const text = res.content[0].text;
  try {
    const clean = text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("Failed to parse vision response:", e.message);
    console.error("Raw response:", text.substring(0, 500));
    return null;
  }
}

// Build the full inspection data structure
function buildInspectionData(propertyAddress, visionData, acqNotes, followUpAnswers, reportNumber) {
  const findings = visionData?.findings || [];

  const byArea = {};
  for (const f of findings) {
    const area = (f.area || "other").toLowerCase();
    if (!byArea[area]) byArea[area] = [];
    byArea[area].push(f);
  }

  const AREA_SECTIONS = [
    { key: "interior",   title: "INTERIOR" },
    { key: "bathroom",   title: "BATHROOMS" },
    { key: "kitchen",    title: "KITCHEN" },
    { key: "foundation", title: "FOUNDATION" },
    { key: "roof",       title: "ROOF & EXTERIOR ENVELOPE" },
    { key: "electrical", title: "ELECTRICAL" },
    { key: "plumbing",   title: "PLUMBING" },
    { key: "hvac",       title: "HVAC / MECHANICAL" },
    { key: "garage",     title: "GARAGE / CARPORT" },
    { key: "exterior",   title: "GROUNDS & EXTERIOR" },
    { key: "other",      title: "ADDITIONAL FINDINGS" },
  ];

  const COST_RANGES = {
    roof:        [18000, 28000],
    foundation:  [8000,  20000],
    electrical:  [6000,  15000],
    plumbing:    [8000,  18000],
    hvac:        [8000,  15000],
    interior:    [15000, 35000],
    kitchen:     [18000, 40000],
    bathroom:    [8000,  18000],
    exterior:    [5000,  12000],
    garage:      [3000,  8000],
    other:       [2000,  6000],
  };

  const sections = [];
  const costSummary = [];

  for (const { key, title } of AREA_SECTIONS) {
    const areaFindings = byArea[key] || [];
    if (areaFindings.length === 0) continue;

    const byLocation = {};
    for (const f of areaFindings) {
      const loc = f.location || "General";
      if (!byLocation[loc]) byLocation[loc] = [];
      byLocation[loc].push(f);
    }

    const items = Object.entries(byLocation).map(([loc, locFindings], idx) => ({
      number: idx + 1,
      title: loc,
      observations: locFindings.map(f => ({
        text: f.description,
        flagged: f.flagged || ["CRITICAL", "MAJOR"].includes(f.severity),
      })),
      photos: [],
    }));

    const hasCritical = areaFindings.some(f => f.severity === "CRITICAL");
    const hasMajor    = areaFindings.some(f => f.severity === "MAJOR");
    const range = COST_RANGES[key] || [2000, 6000];

    sections.push({
      title,
      items,
      estimatedCost: "$" + range[0].toLocaleString() + " - $" + range[1].toLocaleString(),
    });

    costSummary.push({
      category: title.split("&")[0].split("/")[0].trim(),
      description: areaFindings.slice(0, 2).map(f => f.location).filter(Boolean).join(", ") || title,
      amount: Math.round((range[0] + range[1]) / 2),
      priority: hasCritical ? "CRITICAL" : hasMajor ? "MAJOR" : "MODERATE",
    });
  }

  // Scale costs to match ACQ-stated total if provided
  const totalMatch = (followUpAnswers || acqNotes || "").match(/\$[\d,]+(?:\.\d+)?/g);
  const statedTotal = totalMatch ? totalMatch[totalMatch.length - 1] : null;
  if (statedTotal && costSummary.length > 0) {
    const totalNum = parseFloat(statedTotal.replace(/[$,]/g, ""));
    const currentTotal = costSummary.reduce((s, i) => s + i.amount, 0);
    if (currentTotal > 0 && totalNum > 0) {
      const scale = totalNum / currentTotal;
      costSummary.forEach(i => { i.amount = Math.round(i.amount * scale); });
    }
  }

  const execSummary =
    "Tri County Inspection and Project Management conducted a thorough visual inspection of " +
    propertyAddress + " on behalf of Flipur Companies. " +
    (acqNotes ? "Field notes from ACQ team: " + acqNotes + ". " : "") +
    (followUpAnswers ? "Additional details provided: " + followUpAnswers + ". " : "") +
    "The following report details all observed deficiencies with severity classifications and estimated remediation costs to support buyer due diligence and price negotiation.";

  return {
    propertyAddress,
    preparedFor: "Flipur Companies",
    reportNumber: reportNumber || ("TRI-" + new Date().toISOString().substring(0,10).replace(/-/g,"") + "-001"),
    propertyType: "Single-Family Residential",
    propertyStatus: "Per ACQ Field Inspection",
    utilities: "Per field inspection",
    overallCondition: visionData?.overallCondition || "FAIR",
    overallSummary: visionData?.overallSummary || "",
    executiveSummary: execSummary,
    criticalIssues: visionData?.criticalIssues || [],
    majorIssues:    visionData?.majorIssues || [],
    overviewItems: [],
    sections,
    costSummary,
  };
}

// Generate PDF
export async function generateInspectionPDF(payload) {
  const outputPath = "/tmp/inspection-" + Date.now() + ".pdf";
  const scriptPath = path.join(__dirname, "inspection.py");

  const { stdout } = await execFileAsync("python3", [
    scriptPath,
    JSON.stringify(payload),
    outputPath,
  ]);

  const result = JSON.parse(stdout.trim());
  if (!result.success) throw new Error("Inspection PDF generation failed");

  const pdfBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(outputPath);

  return {
    pdfBuffer,
    fileName: "InspectionReport-" + (payload.propertyAddress || "Property")
      .split(",")[0].replace(/\s+/g, "-") + ".pdf",
  };
}

// Main orchestration
export async function createInspectionReport({ propertyAddress, channelId, companyCamUrl, acqNotes, followUpAnswers }) {
  // 1. Find CompanyCam link if not provided
  let ccUrl = companyCamUrl;
  if (!ccUrl && channelId) {
    console.log("Scanning channel for CompanyCam link:", channelId);
    ccUrl = await findCompanyCamLinkInChannel(channelId);
    if (ccUrl) console.log("Found CompanyCam link:", ccUrl);
    else console.log("No CompanyCam link found in channel");
  }

  // 1b. Resolve gallery URLs to project URLs
  if (ccUrl) ccUrl = await resolveCompanyCamUrl(ccUrl, propertyAddress);

  // 2. Fetch photos
  let photos = [];
  if (ccUrl) {
    const ccContext = await getCompanyCamContext(ccUrl);
    if (ccContext) {
      photos = ccContext.photos || [];
      console.log("CompanyCam photos fetched:", photos.length);
    }
  }

  // 3. Analyze with Claude Vision
  console.log("Analyzing with Claude Vision — photos:", photos.length, "notes:", acqNotes?.length || 0);
  const visionData = await analyzePhotosWithVision(photos, acqNotes);

  // 4. Build data structure
  const reportNumber = "TRI-" + new Date().toISOString().substring(0,10).replace(/-/g,"") + "-001";
  const inspectionData = buildInspectionData(propertyAddress, visionData, acqNotes, followUpAnswers, reportNumber);

  // 5. Assign photos to sections
  if (photos.length > 0 && inspectionData.sections.length > 0) {
    const perSection = Math.ceil(photos.length / inspectionData.sections.length);
    inspectionData.sections.forEach((sec, i) => {
      if (sec.items && sec.items.length > 0) {
        const start = i * perSection;
        sec.items[0].photos = photos.slice(start, start + perSection).map(p => ({
          url: p.url,
          caption: p.caption || "",
        }));
      }
    });
  }

  // 6. Generate PDF
  return generateInspectionPDF(inspectionData);
}

// Get follow-up questions
export async function getFollowUpQuestions(photos, acqNotes) {
  const visionData = await analyzePhotosWithVision(photos, acqNotes);
  return visionData?.followUpQuestions || [
    "Any smell of mold or moisture inside the property?",
    "What is the overall roof condition?",
    "Is the electrical panel original or updated?",
    "Any visible plumbing leaks or water damage?",
    "Any foundation cracks or signs of settling?",
  ];
}
