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

function buildAssignmentTabs(fields) {
  // Tab labels must match exactly what's in the DocuSign template
  const textTabs = [];
  const f = fields || {};

  if (f.assigneeName)    textTabs.push({ tabLabel: "Assignee Entity/Name**", value: f.assigneeName });
  if (f.propertyAddress) textTabs.push({ tabLabel: "Property Address**",     value: f.propertyAddress });
  if (f.escrowCompany)   textTabs.push({ tabLabel: "Escrow Company**",        value: f.escrowCompany });
  if (f.escrowAgent)     textTabs.push({ tabLabel: "Escrow Agent**",          value: f.escrowAgent });
  if (f.price)           textTabs.push({ tabLabel: "Price**",                 value: f.price });
  if (f.coeDate)         textTabs.push({ tabLabel: "COE Date**",              value: f.coeDate });
  if (f.emdAmount)       textTabs.push({ tabLabel: "EMD Amount**",            value: f.emdAmount });
  if (f.emdTime)         textTabs.push({ tabLabel: "Time**",                  value: f.emdTime });
  if (f.emdDueDate)      textTabs.push({ tabLabel: "EMD Due Date**",          value: f.emdDueDate });
  if (f.buyerEntity)     textTabs.push({ tabLabel: "Buyer Entity**",          value: f.buyerEntity });
  if (f.fullName)        textTabs.push({ tabLabel: "Full Name",               value: f.fullName });

  return { textTabs };
}

function buildDirectPurchaseTabs(fields) {
  const textTabs = [];
  const f = fields || {};

  if (f.sellerName)      textTabs.push({ tabLabel: "Full Name",        value: f.sellerName });
  if (f.sellerEmail)     textTabs.push({ tabLabel: "Seller email",     value: f.sellerEmail });
  if (f.sellerAddress)   textTabs.push({ tabLabel: "Mailing Address",  value: f.sellerAddress });
  if (f.sellerPhone)     textTabs.push({ tabLabel: "Text",             value: f.sellerPhone });
  if (f.propertyAddress) textTabs.push({ tabLabel: "Property Address", value: f.propertyAddress });
  if (f.price || f.purchasePrice) textTabs.push({ tabLabel: "Purchase Price", value: f.price || f.purchasePrice });
  if (f.emdAmount)       textTabs.push({ tabLabel: "EMD",              value: f.emdAmount });
  if (f.coeDate)         textTabs.push({ tabLabel: "COE days",         value: f.coeDate });
  if (f.inspectionDays)  textTabs.push({ tabLabel: "Tex",              value: f.inspectionDays });

  return { textTabs };
}

function buildDoubleCloseTabs(fields) {
  const textTabs = [];
  const f = fields || {};

  if (f.buyerName)       textTabs.push({ tabLabel: "Text",             value: f.buyerName });
  if (f.buyerFullName || f.buyerName) textTabs.push({ tabLabel: "Full Name", value: f.buyerFullName || f.buyerName });
  if (f.propertyAddress) textTabs.push({ tabLabel: "Property Address", value: f.propertyAddress });
  if (f.price || f.purchasePrice) textTabs.push({ tabLabel: "Purchase Price", value: f.price || f.purchasePrice });
  if (f.emdAmount)       textTabs.push({ tabLabel: "EMD",              value: f.emdAmount });
  if (f.coeDate)         textTabs.push({ tabLabel: "COE days",         value: f.coeDate });
  if (f.inspectionDays)  textTabs.push({ tabLabel: "Text",             value: f.inspectionDays });

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
  if (!data.access_token) throw new Error("DocuSign auth failed: " + JSON.stringify(data));
  return data.access_token;
}

export async function createDocuSignEnvelope({ signerEmail, signerName, documentName, emailSubject, fields }) {
  const token = await getDocuSignToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const { id: templateId, type } = pickTemplate(documentName);

  let templateRoles;

  if (type === "assignment") {
    // Two roles: Assignor (Flipur — pre-filled in template) and Assignee (the buyer)
    templateRoles = [
      {
        email: "team@flipur.io",
        name: "Flipur Inc",
        roleName: "Assignor",
        // Assignor fields are pre-filled in the template — no tabs needed
      },
      {
        email: signerEmail,
        name: signerName,
        roleName: "Assignee",
        tabs: buildAssignmentTabs(fields),
      },
    ];
  } else if (type === "double_close") {
    templateRoles = [
      {
        email: signerEmail,
        name: signerName,
        roleName: "Buyer",
        tabs: buildDoubleCloseTabs(fields),
      },
    ];
  } else {
    // direct_purchase
    templateRoles = [
      {
        email: signerEmail,
        name: signerName,
        roleName: "Seller",
        tabs: buildDirectPurchaseTabs(fields),
      },
    ];
  }

  const envelope = {
    emailSubject,
    templateId,
    templateRoles,
    status: "sent",
  };

  const res = await fetch(`${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(envelope),
  });

  const data = await res.json();
  console.log("DocuSign response:", JSON.stringify(data));
  if (!data.envelopeId) throw new Error("DocuSign envelope failed: " + JSON.stringify(data));
  console.log("DocuSign envelope sent. ID: " + data.envelopeId);
  return data;
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
