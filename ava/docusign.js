export async function createDocuSignEnvelope({
  signerEmail,
  signerName,
  documentBase64,
  documentName,
  emailSubject,
}) {
  try {
    const token = process.env.DOCUSIGN_ACCESS_TOKEN;
    const accountId = process.env.DOCUSIGN_ACCOUNT_ID;

    const envelope = {
      emailSubject,
      documents: [
        {
          documentBase64,
          name: documentName,
          fileExtension: "pdf",
          documentId: "1",
        },
      ],
      recipients: {
        signers: [
          {
            email: signerEmail,
            name: signerName,
            recipientId: "1",
            tabs: {
              signHereTabs: [
                {
                  documentId: "1",
                  pageNumber: "1",
                  xPosition: "200",
                  yPosition: "600",
                },
              ],
            },
          },
        ],
      },
      status: "sent",
    };

    const res = await fetch(
      `https://na4.docusign.net/restapi/v2.1/accounts/${accountId}/envelopes`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(envelope),
      }
    );

    const data = await res.json();
    console.log(`DocuSign envelope created: ${data.envelopeId}`);
    return data;

  } catch (err) {
    console.error("DocuSign error:", err);
    throw err;
  }
}
