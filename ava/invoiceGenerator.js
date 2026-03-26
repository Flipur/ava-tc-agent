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
    } catch(e) { console.error("Gallery resolve error:", e.message); }
  }
  return url;
}

export async function findCompanyCamLinkInChannel(channelId) {
  try {
    const res = await slackApp.client.conversations.history({ channel: channelId, limit: 200 });
    for (const msg of res.messages || []) {
      const match = (msg.text || "").match(/https?:\/\/app\.companycam\.com\/[^\s>|]+/);
      if (match) return match[0];
    }
    return null;
  } catch (e) {
    console.error("findCompanyCamLinkInChannel error:", e.message);
    return null;
  }
}

export async function scanChannelForContext(channelId) {
  try {
    const res = await slackApp.client.conversations.history({ channel: channelId, limit: 200 });
    const messages = res.messages || [];
    const context = { companyCamUrl: null, arvMentions: [], offerPrice: null, notes: [], attachments: [] };
    for (const msg of messages) {
      const text = msg.text || "";
      const ccMatch = text.match(/https?:\/\/app\.companycam\.com\/[^\s>|]+/);
      if (ccMatch && !context.companyCamUrl) context.companyCamUrl = ccMatch[0];
      const arvMatch = text.match(/arv[:\s]*\$?([\d,]+)/i);
      if (arvMatch) context.arvMentions.push(arvMatch[1].replace(/,/g,''));
      const offerMatch = text.match(/(?:offer|purchase|price|contract)[:\s]*\$?([\d,]+)/i);
      if (offerMatch) context.offerPrice = offerMatch[1].replace(/,/g,'');
      if (!msg.bot_id && !msg.app_id && text.length > 10 && text.length < 300) {
        context.notes.push(text.substring(0, 200));
      }
      for (const file of msg.files || []) {
        if (file.name) context.attachments.push(file.name);
      }
    }
    return context;
  } catch (e) {
    console.error("scanChannelForContext error:", e.message);
    return {};
  }
}

async function analyzePhotosWithVision(photos, acqNotes) {
  const imageContents = [];
  for (const photo of photos.slice(0, 14)) {
    if (!photo.url) continue;
    try {
      const response = await fetch(photo.url);
      const buffer = await response.arrayBuffer();
      const base64 = Buffer.from(buffer).toString("base64");
      imageContents.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } });
      if (photo.caption) imageContents.push({ type: "text", text: "Caption: " + photo.caption });
    } catch (e) { console.error("Failed to fetch photo:", e.message); }
  }
  if (imageContents.length === 0 && !acqNotes) return null;

  const prompt = `You are a professional property inspector for Flipur Companies, a real estate investment firm in Southern California.

ACQ Team Notes: ${acqNotes || "No additional notes provided."}

${imageContents.length > 0 ? "Analyze these property photos and identify ALL visible deficiencies, conditions, and systems." : "Based on ACQ notes, generate a professional inspection assessment."}

Respond ONLY with valid JSON, no markdown, no backticks:
{
  "overallCondition": "CRITICAL / NOT HABITABLE or POOR / NEEDS FULL RENOVATION or FAIR / NEEDS SIGNIFICANT REPAIRS or GOOD",
  "overallSummary": "2-3 sentence professional summary",
  "unpermittedSqft": "description if visible, otherwise null",
  "overview": {
    "occupancy": "Occupied/Vacant/Tenant Occupied",
    "utilities": "All ON/All OFF/Unknown",
    "walls": "Drywall/Plaster/etc",
    "ceilings": "material types",
    "floors": "material types",
    "windows": "Single pane/Double pane/etc",
    "waterShutoff": "location if visible",
    "gasShutoff": "location if visible",
    "electricalPanel": "location if visible"
  },
  "criticalIssues": ["concise critical issue", "..."],
  "majorIssues": ["concise major issue", "..."],
  "findingsSections": [
    {
      "title": "3.1 Interior",
      "intro": "brief professional intro",
      "items": [
        {
          "title": "Ceilings",
          "text": "detailed professional description of condition",
          "observations": ["specific observation"],
          "criticalFlags": ["CRITICAL flag text if needed"],
          "attentionFlags": ["ATTENTION flag text if needed"]
        }
      ],
      "photoSection": "interior"
    }
  ],
  "suggestedBidSections": [
    {
      "title": "Demolition & Site Preparation",
      "lineItems": [{"description": "Full interior demo", "amount": 12000}]
    }
  ],
  "riskMatrix": [
    {"factor": "specific risk", "likelihood": "High/Medium/Low", "impact": "High/Medium/Low", "rating": "HIGH/MEDIUM/LOW"}
  ],
  "timeline": [
    {"phase": "phase name", "duration": "X weeks/months"}
  ],
  "totalTimeline": "X-Y months"
}`;

  const res = await claude.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 6000,
    messages: [{
      role: "user",
      content: imageContents.length > 0
        ? [...imageContents, { type: "text", text: prompt }]
        : [{ type: "text", text: prompt }],
    }],
  });

  try {
    const clean = res.content[0].text.replace(/```json|```/g, "").trim();
    return JSON.parse(clean);
  } catch (e) {
    console.error("Failed to parse vision response:", e.message);
    return null;
  }
}

function parseFollowUpAnswers(answers, notes) {
  const combined = (answers + " " + notes);
  const result = { arv: 0, targetBudget: 0, extraNotes: answers };

  const arvPatterns = [/arv[:\s]+\$?([\d,]+)/i, /resale[:\s]+\$?([\d,]+)/i, /sell.for[:\s]+\$?([\d,]+)/i, /worth[:\s]+\$?([\d,]+)/i, /after.repair[:\s]+\$?([\d,]+)/i];
  for (const pat of arvPatterns) {
    const m = combined.match(pat);
    if (m) { result.arv = parseFloat(m[1].replace(/,/g,'')); break; }
  }

  const budgetPatterns = [/budget[:\s]+\$?([\d,]+)/i, /reno[:\s]+\$?([\d,]+)/i, /renovation[:\s]+\$?([\d,]+)/i, /target[:\s]+\$?([\d,]+)/i];
  for (const pat of budgetPatterns) {
    const m = combined.match(pat);
    if (m) { result.targetBudget = parseFloat(m[1].replace(/,/g,'')); break; }
  }

  // Fallback: largest dollar amount over $100k is likely ARV
  if (!result.arv) {
    const amounts = (combined.match(/\$[\d,]+/g) || []).map(a => parseFloat(a.replace(/[$,]/g,'')));
    const large = amounts.filter(a => a > 100000);
    if (large.length > 0) result.arv = Math.max(...large);
  }

  return result;
}

function getDefaultBidSections(visionData) {
  const critical = (visionData?.criticalIssues || []).join(" ").toLowerCase();
  const hasMold   = /mold|moisture/.test(critical);
  const hasRoof   = /roof/.test(critical);
  const hasElec   = /electr/.test(critical);
  const hasPlumb  = /plumb|water/.test(critical);
  const hasFound  = /foundation|crack/.test(critical);

  const sections = [
    { title: "4.1 Demolition & Site Preparation", shortTitle: "Demo & Site Prep", lineItems: [
      { description: "Full interior demo — kitchen, bathrooms, laundry", amount: 12000 },
      { description: "Selective demo — damaged drywall, closets, ceiling areas", amount: 6500 },
      { description: "Debris haul-off", amount: 3200 },
      ...(hasMold ? [{ description: "Moisture remediation / mold testing & treatment", amount: 8000 }] : []),
      { description: "Subfloor repair / leveling", amount: 4500 },
    ]},
  ];

  if (hasRoof) sections.push({ title: "4.2 Roof & Exterior", shortTitle: "Roof & Exterior", lineItems: [
    { description: "Full roof replacement (comp shingle)", amount: 22000 },
    { description: "Fascia & eave replacement / repair", amount: 6500 },
    { description: "Exterior paint (full body — 2 coats)", amount: 9500 },
    { description: "Driveway / walkway repair", amount: 3500 },
  ]});

  if (hasElec) sections.push({ title: "4.3 Electrical", shortTitle: "Electrical", lineItems: [
    { description: "Main panel upgrade & correction", amount: 4500 },
    { description: "Full interior rewire / grounding", amount: 18000 },
    { description: "GFCI installation — all wet areas", amount: 1800 },
    { description: "Recessed lighting installation", amount: 4200 },
  ]});

  if (hasPlumb) sections.push({ title: "4.4 Plumbing", shortTitle: "Plumbing", lineItems: [
    { description: "Full bathroom plumbing fixture replacement", amount: 8500 },
    { description: "Water heater replacement", amount: 4200 },
    { description: "Kitchen plumbing reconnection", amount: 3200 },
  ]});

  if (hasFound) sections.push({ title: "4.5 Foundation", shortTitle: "Foundation", lineItems: [
    { description: "Structural engineering evaluation", amount: 3500 },
    { description: "Foundation crack repair and stabilization", amount: 18000 },
  ]});

  sections.push({ title: "4." + (sections.length+1) + " HVAC", shortTitle: "HVAC", lineItems: [
    { description: "Full HVAC system replacement (furnace + A/C)", amount: 14500 },
    { description: "Ductwork repair and sealing", amount: 3200 },
  ]});

  sections.push({ title: "4." + (sections.length+1) + " Kitchen Renovation", shortTitle: "Kitchen", lineItems: [
    { description: "Custom cabinetry (semi-custom shaker, soft-close)", amount: 14000 },
    { description: "Quartz countertops (installed)", amount: 7500 },
    { description: "Stainless appliance package", amount: 6500 },
    { description: "Kitchen flooring (LVP or tile)", amount: 3500 },
  ]});

  sections.push({ title: "4." + (sections.length+1) + " Bathroom Renovation", shortTitle: "Bathrooms", lineItems: [
    { description: "Full tile demo & new shower surround", amount: 10000 },
    { description: "Vanities, countertops, sinks & faucets", amount: 5500 },
    { description: "Toilets, mirrors, accessories", amount: 2800 },
    { description: "Bathroom flooring (tile)", amount: 3200 },
  ]});

  sections.push({ title: "4." + (sections.length+1) + " Interior Finishes", shortTitle: "Interior Finishes", lineItems: [
    { description: "Full interior paint (walls, ceilings, trim)", amount: 11000 },
    { description: "Flooring — LVP throughout living areas & bedrooms", amount: 12500 },
    { description: "Interior doors & hardware", amount: 4800 },
    { description: "Baseboards, casing, window & door trim", amount: 3500 },
  ]});

  sections.push({ title: "4." + (sections.length+1) + " Landscaping & Final Detail", shortTitle: "Landscaping & Detail", lineItems: [
    { description: "Front yard landscaping & cleanup", amount: 3500 },
    { description: "Garage — paint, clean, epoxy floor coat", amount: 2800 },
    { description: "Final deep clean & staging prep", amount: 1500 },
  ]});

  return sections;
}

function getDefaultRiskMatrix(visionData) {
  const risks = [
    { factor: "Hidden moisture/mold damage behind walls", likelihood: "Medium", impact: "High", rating: "HIGH" },
    { factor: "Reno costs exceed budget", likelihood: "Medium", impact: "Medium", rating: "MEDIUM" },
    { factor: "Market softens during renovation hold", likelihood: "Medium", impact: "High", rating: "MEDIUM" },
    { factor: "HVAC / electrical upgrade costs exceed estimate", likelihood: "Low", impact: "Medium", rating: "LOW" },
    { factor: "Title/escrow complications", likelihood: "Low", impact: "Medium", rating: "LOW" },
  ];
  if (visionData?.unpermittedSqft) {
    risks.unshift({ factor: "Permit delayed beyond 6 months", likelihood: "High", impact: "Medium", rating: "HIGH" });
    risks.unshift({ factor: "Unpermitted area permit denial or demo required", likelihood: "Medium", impact: "High", rating: "HIGH" });
  }
  return risks;
}

function buildReportData(propertyAddress, dealContext, visionData, userAnswers) {
  const arv = userAnswers.arv || 0;
  const targetBudget = userAnswers.targetBudget || 0;
  const extraNotes = userAnswers.extraNotes || "";

  // Build bid sections
  const suggestedSections = visionData?.suggestedBidSections || [];
  let bidSections;
  if (suggestedSections.length > 0) {
    bidSections = suggestedSections.map((s, i) => ({
      title: "4." + (i+1) + " " + s.title,
      shortTitle: s.title,
      lineItems: s.lineItems || [],
    }));
  } else {
    bidSections = getDefaultBidSections(visionData);
  }

  // Scale to target budget
  if (targetBudget > 0) {
    const currentTotal = bidSections.reduce((sum, sec) =>
      sum + sec.lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0), 0);
    if (currentTotal > 0) {
      const scale = targetBudget / currentTotal;
      bidSections.forEach(sec => {
        sec.lineItems.forEach(li => { li.amount = Math.round((parseFloat(li.amount) || 0) * scale); });
      });
    }
  }

  const grandTotal = bidSections.reduce((sum, sec) =>
    sum + sec.lineItems.reduce((s, li) => s + (parseFloat(li.amount) || 0), 0), 0);
  const budget = targetBudget || grandTotal;

  const holdMonths = 9;
  const carry = arv > 0 ? Math.round(budget * 0.4) : 0;
  const commission = arv > 0 ? Math.round(arv * 0.03) : 0;
  const taxesClosing = arv > 0 ? Math.round(arv * 0.011) : 0;
  const insurance = 4800;
  const targetProfit = 80000;
  const mao = arv > 0 ? arv - budget - carry - commission - taxesClosing - insurance - targetProfit : 0;
  const offerLow  = mao > 0 ? Math.round(mao * 0.93 / 1000) * 1000 : 0;
  const offerHigh = mao > 0 ? Math.round(mao * 0.97 / 1000) * 1000 : 0;

  // Assign photos to finding sections
  const findingsSections = (visionData?.findingsSections || []).map(sec => ({ ...sec, photos: [] }));

  return {
    propertyAddress,
    propertyType: dealContext?.propertyType || "Single-Family Residence",
    inspectionDate: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
    inspectionFirm: "Tri County Inspection and Project Management",
    inspector: "Field Inspector",
    reportNumber: "TRI-" + new Date().toISOString().substring(0,10).replace(/-/g,"") + "-001",
    unpermittedSqft: visionData?.unpermittedSqft || "",
    overview: {
      inspectionType: "Standard Property Inspection",
      occupancy: dealContext?.tenantOccupied ? "Tenant Occupied" : (visionData?.overview?.occupancy || "Vacant"),
      utilities: visionData?.overview?.utilities || "Per field inspection",
      walls: visionData?.overview?.walls || "N/A",
      ceilings: visionData?.overview?.ceilings || "N/A",
      floors: visionData?.overview?.floors || "N/A",
      windows: visionData?.overview?.windows || "N/A",
      waterShutoff: visionData?.overview?.waterShutoff || "Per field inspection",
      gasShutoff: visionData?.overview?.gasShutoff || "Per field inspection",
      electricalPanel: visionData?.overview?.electricalPanel || "Per field inspection",
    },
    findingsSections,
    bidIntro:
      "The following renovation bid is based on the inspection findings above and current market costs in " +
      (propertyAddress.match(/CA/) ? "Los Angeles / Southern California" : "the local market") +
      ". All costs are estimates subject to adjustment upon contractor walkthrough. " +
      (extraNotes ? "ACQ notes: " + extraNotes + "." : ""),
    bidSections,
    targetBudget: budget,
    financials: arv > 0 ? {
      arv, holdMonths, carryCosts: carry, agentCommission: commission,
      taxesClosing, insurance, targetProfit,
    } : null,
    scenarios: arv > 0 ? [
      { name: "Base Case", resale: "$" + arv.toLocaleString(), maoProfit: "~$80,000", targetProfit: "~$" + Math.round(arv - budget - carry - commission - taxesClosing - insurance - mao).toLocaleString() },
      { name: "Upside (market premium +3%)", resale: "$" + Math.round(arv*1.03).toLocaleString(), maoProfit: "~$" + Math.round(arv*0.03 + 80000).toLocaleString(), targetProfit: "~$" + Math.round(arv*1.03 - budget - carry - commission - taxesClosing - insurance - mao).toLocaleString() },
      { name: "Extended Hold (12+ mo carry)", resale: "$" + arv.toLocaleString(), maoProfit: "~$" + Math.round(80000 - carry*0.33).toLocaleString(), targetProfit: "~$" + Math.round(arv - budget - carry*1.33 - commission - taxesClosing - insurance - mao).toLocaleString() },
    ] : [],
    riskMatrix: visionData?.riskMatrix || getDefaultRiskMatrix(visionData),
    timeline: visionData?.timeline || [
      { phase: "Close of Escrow & Mobilization", duration: "2–3 weeks" },
      { phase: "Demo & Site Prep", duration: "3–4 weeks" },
      { phase: "Structural, Rough Electrical, Plumbing, HVAC", duration: "6–8 weeks" },
      { phase: "Finish Work — Tile, Cabinets, Flooring, Paint", duration: "6–8 weeks" },
      { phase: "Final Punch List, Landscaping, Staging", duration: "2–3 weeks" },
    ],
    totalTimeline: visionData?.totalTimeline || "6–9 months",
  };
}

export async function generateInspectionPDF(payload) {
  const outputPath = "/tmp/inspection-" + Date.now() + ".pdf";
  const scriptPath = path.join(__dirname, "inspection.py");
  const { stdout } = await execFileAsync("python3", [
    scriptPath, JSON.stringify(payload), outputPath,
  ], { maxBuffer: 50 * 1024 * 1024 });
  const result = JSON.parse(stdout.trim());
  if (!result.success) throw new Error("Inspection PDF generation failed");
  const pdfBuffer = fs.readFileSync(outputPath);
  fs.unlinkSync(outputPath);
  return {
    pdfBuffer,
    fileName: "Flipur-InspectionReport-" + (payload.propertyAddress || "Property")
      .split(",")[0].replace(/\s+/g, "-") + ".pdf",
  };
}

export async function createInspectionReport({ propertyAddress, channelId, companyCamUrl, acqNotes, followUpAnswers, dealContext }) {
  // 1. Scan channel
  let channelContext = {};
  if (channelId) channelContext = await scanChannelForContext(channelId);

  // 2. Resolve CompanyCam URL
  let ccUrl = companyCamUrl || channelContext.companyCamUrl;
  if (ccUrl) ccUrl = await resolveCompanyCamUrl(ccUrl, propertyAddress);

  // 3. Fetch photos
  let photos = [];
  if (ccUrl) {
    const ccContext = await getCompanyCamContext(ccUrl);
    if (ccContext) { photos = ccContext.photos || []; console.log("Photos fetched:", photos.length); }
  }

  // 4. Parse answers
  const userAnswers = parseFollowUpAnswers(followUpAnswers || "", acqNotes || "");

  // 5. Combine notes
  const allNotes = [acqNotes, channelContext.notes?.slice(0,5).join(". "), followUpAnswers].filter(Boolean).join(". ");

  // 6. Vision analysis
  console.log("Analyzing with Claude Vision — photos:", photos.length);
  const visionData = await analyzePhotosWithVision(photos, allNotes);

  // 7. Build report
  const reportData = buildReportData(propertyAddress, dealContext || {}, visionData, userAnswers);

  // 8. Assign photos to sections
  if (photos.length > 0 && reportData.findingsSections.length > 0) {
    const perSection = Math.ceil(photos.length / reportData.findingsSections.length);
    reportData.findingsSections.forEach((sec, i) => {
      sec.photos = photos.slice(i * perSection, (i+1) * perSection).map(p => ({ url: p.url, caption: p.caption || "" }));
    });
  }

  // 9. Generate PDF
  return generateInspectionPDF(reportData);
}

export async function getFollowUpQuestions(channelContext) {
  const hasArv = channelContext?.arvMentions?.length > 0;
  const questions = [];
  if (!hasArv) questions.push("What's the ARV (projected resale price) on this one?");
  questions.push("What's your target renovation budget?");
  questions.push("Anything not visible in the photos — mold smell, foundation issues, unpermitted work, tenant situation?");
  return questions;
}
