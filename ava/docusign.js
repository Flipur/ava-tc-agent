import jwt from "jsonwebtoken";

const DOCUSIGN_AUTH_SERVER = "https://account-d.docusign.com";
const DOCUSIGN_BASE_URL = "https://demo.docusign.net/restapi/v2.1";

const TEMPLATES = {
  assignment:      "36c3b300-bbf9-4aa0-8b37-7decaf3433e2",
  direct_purchase: "8db27d0c-ab93-4b61-97ba-90de1ae6c365",
  double_close:    "47c21830-910a-4be7-b6d9-fa77a5c9b77d",
};

function pickTemplate(documentName) {
  const name = (documentName || "").toLowerCase();
  if (name.includes("assignment")) return { id: TEMPLATES.assignment, type: "assignment" };
  if (name.includes("double close") || name.includes("b-c") || name.includes("bc")) return { id: TEMPLATES.double_close, type: "double_close" };
  return { id: TEMPLATES.direct_purchase, type: "direct_purchase" };
}

async function getDocuSignToken() {
  const integrationKey = process.env.DOCUSIGN_INTEGRATION_KEY;
  const userId = process.env.DOCUSIGN_USER_ID;
  const privateKey = process.env.DOCUSIGN_PRIVATE_KEY.replace(/\\n/g, "\n");

  const payload = {
    iss: integrationKey,
    sub: userId,
    aud: "account-d.docusign.com",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    scope: "signature impersonation",
  };

  const assertion = jwt.sign(payload, privateKey, { algorithm: "RS256" });

  const res = await fetch(`${DOCUSIGN_AUTH_SERVER}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  const data = await res.json();
  if (!data.access_token) throw new Error("DocuSign auth failed: " + JSON.stringify(data));
  return data.access_token;
}

async function updateAssignmentTabs(token, accountId, envelopeId, recipientId, fields) {
  const f = fields || {};

  // tabId -> field value mapping (tabIds are stable per template)
  const tabMap = [
    { tabId: "12d8db10-d6ef-43ba-8b7b-c7c4da7336ea", value: f.propertyAddress },   // Property Address p1
    { tabId: "e5a18136-cf17-4ad2-a17d-fb5000b68ba6", value: f.propertyAddress },   // Property Address p1
    { tabId: "fa83f22a-11a0-4a8d-8ff1-8992942cf154", value: f.propertyAddress },   // Property Address p1
    { tabId: "5886913f-e6fd-4d92-a459-d64fbdf72745", value: f.assigneeName },      // Assignee Entity/Name
    { tabId: "24bcbb02-f9fe-4f5b-bd6e-b8f2835d859e", value: f.assigneeName },      // Assignee Entity/Name
    { tabId: "11a1fc89-3b52-4062-9406-4a59acf5c42a", value: f.assigneeName },      // Assignee Entity/Name
    { tabId: "e28d3498-38e1-44c7-b5be-2c3c4001510e", value: f.assigneeName },      // Assignee Entity/Name
    { tabId: "64182d38-f932-4b4d-9305-9cdce15d27b5", value: f.assigneeName },      // Assignee Entity/Name p2
    { tabId: "59848f1d-298f-4ab4-b133-ed9ff1ebc62a", value: f.buyerEntity || f.assigneeName }, // Buyer Entity
    { tabId: "e725e107-0d80-4901-bea5-0bfed04141f0", value: f.escrowCompany },     // Escrow Company p1
    { tabId: "c11f863a-9a88-4b57-8600-a3a1a6472896", value: f.escrowCompany },     // Escrow Company p1
    { tabId: "adecb426-760c-4a7d-b878-04bb25c7371b", value: f.escrowCompany },     // Escrow Company p2
    { tabId: "dc9dad65-8fcc-4ef5-b03a-704bbd9975ba", value: f.escrowAgent },       // Escrow Agent
    { tabId: "811821fd-1a8d-44fa-9135-8362cad2dfdc", value: f.price },             // Price
    { tabId: "903d344a-0f97-4f42-8b60-d32bf9552742", value: f.price },             // Price (disbursement)
    { tabId: "1aa86d22-3cb2-478c-813e-82c674c8b511", value: f.coeDate },           // COE Date
    { tabId: "b518dd0f-23cc-42c1-94a2-89b129507e5d", value: f.emdAmount },         // EMD Amount
    { tabId: "41bdd920-da41-4ea4-a92e-7933a69bffbe", value: f.emdTime },           // Time
    { tabId: "5e50a0a4-d067-4ad4-b2bb-3d31e9557e97", value: f.emdDueDate },        // EMD Due Date
  ];

  const textTabs = tabMap
    .filter(t => t.value)
    .map(t => ({ tabId: t.tabId, value: String(t.value), locked: "true" }));

  console.log(`Updating ${textTabs.length} tabs on recipient ${recipientId}`);

  const res = await fetch(
    `${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelopeId}/recipients/${recipientId}/tabs`,
    {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ textTabs }),
    }
  );

  const data = await res.json();
  console.log("Tab update response:", JSON.stringify(data).slice(0, 200));
  return data;
}

export async function createDocuSignEnvelope({ signerEmail, signerName, documentName, emailSubject, fields }) {
  const token = await getDocuSignToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const { id: templateId, type } = pickTemplate(documentName);

  let templateRoles;

  if (type === "assignment") {
    templateRoles = [
      { email: "team@flipur.io", name: "Flipur Inc", roleName: "Assignor" },
      { email: signerEmail, name: signerName, roleName: "Assignee" },
    ];
  } else if (type === "double_close") {
    templateRoles = [
      { email: signerEmail, name: signerName, roleName: "Buyer" },
    ];
  } else {
    templateRoles = [
      { email: signerEmail, name: signerName, roleName: "Seller" },
    ];
  }

  // Step 1 — create envelope
  const envelopeRes = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emailSubject, templateId, templateRoles, status: "sent" }),
  });

  const envelope = await envelopeRes.json();
  console.log("DocuSign envelope created. ID:", envelope.envelopeId);
  if (!envelope.envelopeId) throw new Error("DocuSign envelope failed: " + JSON.stringify(envelope));

  // Step 2 — get recipients and find Assignor recipientId
  if (type === "assignment" && fields) {
    const recipientsRes = await fetch(
      `${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelope.envelopeId}/recipients?include_tabs=true`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const recipients = await recipientsRes.json();

    // Find the Assignor with the most tabs (recipientId 1)
    const assignor = (recipients.signers || [])
      .filter(s => s.roleName === "Assignor" || s.email === "team@flipur.io")
      .sort((a, b) => (b.tabs?.textTabs?.length || 0) - (a.tabs?.textTabs?.length || 0))[0];

    if (assignor) {
      console.log("Found Assignor recipientId:", assignor.recipientId, "with", assignor.tabs?.textTabs?.length, "tabs");
      await updateAssignmentTabs(token, accountId, envelope.envelopeId, assignor.recipientId, fields);
    } else {
      console.log("Assignor not found in recipients");
    }
  }

  console.log("DocuSign envelope sent. ID: " + envelope.envelopeId);
  return envelope;
}

export async function getEnvelopeStatus(envelopeId) {
  const token = await getDocuSignToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelopeId}`, {
    headers: { Authorization: "Bearer " + token },
  });
  return res.json();
}

export { TEMPLATES };
