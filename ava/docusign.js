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

async function updateEnvelopeTabs(token, accountId, envelopeId, recipientId, fields) {
  const f = fields || {};

  // Map of tabLabel UUID -> value from our fields
  const tabValues = {
    "Text b7e171e1-1a3b-4378-8e62-ca6ffd64c173": f.propertyAddress,
    "Text 30668664-1b72-41f8-bce0-883b900ae306": f.propertyAddress,
    "Text 5b912215-d2a1-4308-9464-8ad8003d0354": f.propertyAddress,
    "Text f2cd4618-1150-4ef2-882e-53848eb3ed34": f.assigneeName,
    "Text c157022d-b4a7-4149-a828-d2f336a830af": f.assigneeName,
    "Text 7b185439-b773-4d40-adc4-1c0100ccaa28": f.assigneeName,
    "Text f3bee701-c23c-4c15-9de3-2ec6cb04e4cf": f.assigneeName,
    "Text 84ec4a97-b4da-4fac-8a93-f6dd3d1581b6": f.assigneeName,
    "Text 1741a6f9-d256-4d46-b4b4-c268fd0a962f": f.buyerEntity || f.assigneeName,
    "Text d0c43fdf-6732-4757-9d32-34ac3a58a5a4": f.escrowCompany,
    "Text 8a5c69ec-a0a3-4674-a6d8-ed425ab2e604": f.escrowCompany,
    "Text dce2bf8b-b150-40a1-ad11-a7b4ced221e0": f.escrowCompany,
    "Text e1168ff3-5d7b-4214-b294-5ece445af867": f.escrowAgent,
    "Text b1773cc8-ecf0-4642-bb23-ed137c29a27d": f.price,
    "Text 97505617-d983-4b0d-89e3-e4540de95eec": f.price,
    "Text 7bec216c-bd2e-48b3-8921-9a89089ddcd7": f.coeDate,
    "Text 1b77e2fb-8de1-4598-8106-98eddb054406": f.emdAmount,
    "Text 5fdc4b30-5e25-4bbb-a5ee-8e10ee535a53": f.emdTime,
    "Text 524c1743-5e3f-45e2-9c12-bfb8b20a745d": f.emdDueDate,
  };

  const textTabs = Object.entries(tabValues)
    .filter(([, value]) => value)
    .map(([tabLabel, value]) => ({
      tabLabel,
      value: String(value),
      locked: "true",
    }));

  console.log("Updating", textTabs.length, "tabs on recipient", recipientId);

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
  console.log("Tab update response:", JSON.stringify(data).slice(0, 300));
  return data;
}

export async function createDocuSignEnvelope({ signerEmail, signerName, documentName, emailSubject, fields }) {
  const token = await getDocuSignToken();
  const accountId = process.env.DOCUSIGN_ACCOUNT_ID;
  const { id: templateId, type } = pickTemplate(documentName);

  let templateRoles;

  if (type === "assignment") {
    templateRoles = [
      {
        email: "team@flipur.io",
        name: "Flipur Inc",
        roleName: "Assignor",
      },
      {
        email: signerEmail,
        name: signerName,
        roleName: "Assignee",
      },
    ];
  } else if (type === "double_close") {
    templateRoles = [
      {
        email: signerEmail,
        name: signerName,
        roleName: "Buyer",
      },
    ];
  } else {
    templateRoles = [
      {
        email: signerEmail,
        name: signerName,
        roleName: "Seller",
      },
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
  console.log("DocuSign response:", JSON.stringify(envelope));
  if (!envelope.envelopeId) throw new Error("DocuSign envelope failed: " + JSON.stringify(envelope));
  console.log("DocuSign envelope sent. ID: " + envelope.envelopeId);

  // Step 2 — get recipients to find Assignor recipientId
  if (type === "assignment" && fields) {
    const recipientsRes = await fetch(
      `${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelope.envelopeId}/recipients`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const recipients = await recipientsRes.json();
    const assignor = (recipients.signers || []).find(
      (s) => s.roleName === "Assignor" || s.email === "team@flipur.io"
    );

    if (assignor) {
      await updateEnvelopeTabs(token, accountId, envelope.envelopeId, assignor.recipientId, fields);
    } else {
      console.log("Assignor recipient not found, skipping tab update");
    }
  }

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
