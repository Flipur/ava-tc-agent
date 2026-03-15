import jwt from "jsonwebtoken";

const DOCUSIGN_AUTH_SERVER = "https://account-d.docusign.com";
const DOCUSIGN_BASE_URL = "https://demo.docusign.net/restapi/v2.1";

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
  documentBase64,
  documentName,
  emailSubject,
}) {
  try {
    const token = await getDocuSignToken();
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

    const envelope = {
      emailSubject,
      documents: [{
        documentBase64,
        name: documentName,
        fileExtension: "pdf",
        documentId: "1",
      }],
      recipients: {
        signers: [{
          email: signerEmail,
          name: signerName,
          recipientId: "1",
          tabs: {
            signHereTabs: [{
              documentId: "1",
              pageNumber: "1",
              xPosition: "200",
              yPosition: "600",
            }],
          },
        }],
      },
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
