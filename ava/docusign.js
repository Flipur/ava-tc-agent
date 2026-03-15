import jwt from "jsonwebtoken";

const DOCUSIGN_AUTH_SERVER = "https://account-d.docusign.com";
const DOCUSIGN_BASE_URL = "https://demo.docusign.net/restapi/v2.1";

const TEMPLATES = {
  assignment:      "36c3b300-bbf9-4aa0-8b37-7decaf3433e2",
  direct_purchase: "8db27d0c-ab93-4b61-97ba-90de1ae6c365",
  double_close:    "47c21830-910a-4be7-b6d9-fa77a5c9b77d",
};

function pickTemplate(documentName = "") {
  const name = documentName.toLowerCase();
  if (name.includes("assignment")) return TEMPLATES.assignment;
  if (name.includes("double close") || name.includes("b-c") || name.includes("bc")) return TEMPLATES.double_close;
  if (name.includes("direct") || name.includes("purchase") || name.includes("seller")) return TEMPLATES.direct_purchase;
  return TEMPLATES.assignment;
}

function buildTabs(fields = {}) {
  const MAP = {
    assigneeName:    "Assignee Entity/Name**",
    propertyAddress: "Property Address**",
    escrowCompany:   "Escrow Company**",
    escrowAgent:     "Escrow Agent**",
    price:           "Price**",
    coeDate:         "COE Date**",
    emdAmount:       "EMD Amount**",
    emdTime:         "Time**",
    emdDueDate:      "EMD Due Date**",
    buyerName:       "Assignee Entity/Name**",
    purchasePrice:   "Price**",
    closingDate:     "COE Date**",
  };

  const textTabs = [];
  for (const [key, value] of Object.entries(fields)) {
    const tabLabel = MAP[key] || key;
    if (value) textTabs.push({ tabLabel, value: String(value) });
  }
  return { textTabs };
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
  if (!data.access_token) throw new Error(`DocuSign auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function createDocuSignEnvelope({
  signerEmail,
  signerName,
  documentName,
  emailSubject,
  fields = {},
}) {
  try {
    const token = await getDocuSignToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const templateId = pickTemplate(documentName);

    const envelope = {
      emailSubject,
      templateId,
      templateRoles: [{
        email: signerEmail,
        name: signerName,
        roleName: "Signer",
        tabs: buildTabs(fields),
      }],
      status: "sent",
    };

    const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });

    const data = await res.json();
    console.log("DocuSign response:", JSON.stringify(data));
    if (!data.envelopeId) throw new Error(`DocuSign envelope failed: ${JSON.stringify(data)}`);
    console.log(`DocuSign envelope sent. ID: ${data.envelopeId}`);
    return data;

  } catch (err) {
    console.error("DocuSign error:", err);
    throw err;
  }
}

export async function getEnvelopeStatus(envelopeId) {
  try {
    const token = await getDocuSignToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelopeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  } catch (err) {
    console.error("DocuSign getEnvelopeStatus error:", err);
    throw err;
  }
}

export { TEMPLATES };

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
  if (!data.access_token) throw new Error(`DocuSign auth failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

export async function createDocuSignEnvelope({
  signerEmail,
  signerName,
  documentName,
  emailSubject,
  fields = {},
}) {
  try {
    const token = await getDocuSignToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const templateId = pickTemplate(documentName);

    // Build tab values from deal fields so Ava pre-fills the template
    const textTabs = Object.entries(fields).map(([tabLabel, value]) => ({
      tabLabel,
      value: String(value),
    }));

    const envelope = {
      emailSubject,
      templateId,
      templateRoles: [{
        email: signerEmail,
        name: signerName,
        roleName: "Signer",
        tabs: {
          textTabs,
        },
      }],
      status: "sent",
    };

    const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(envelope),
    });

    const data = await res.json();
    console.log("DocuSign response:", JSON.stringify(data));

    if (!data.envelopeId) throw new Error(`DocuSign envelope failed: ${JSON.stringify(data)}`);
    console.log(`DocuSign envelope created: ${data.envelopeId}`);
    return data;

  } catch (err) {
    console.error("DocuSign error:", err);
    throw err;
  }
}

export async function getEnvelopeStatus(envelopeId) {
  try {
    const token = await getDocuSignToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
    const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelopeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return res.json();
  } catch (err) {
    console.error("DocuSign getEnvelopeStatus error:", err);
    throw err;
  }
}

export { TEMPLATES };
