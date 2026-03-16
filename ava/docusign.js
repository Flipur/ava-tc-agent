// Step 2 — fetch live recipients with tabs, find Assignee, update tabs
  if (type === "assignment" && fields) {
    const recipientsRes = await fetch(
      `${DOCUSIGN_BASE_URL}/accounts/${accountId}/envelopes/${envelope.envelopeId}/recipients?include_tabs=true`,
      { headers: { Authorization: "Bearer " + token } }
    );
    const recipients = await recipientsRes.json();

    // Now write to Assignee since fields are assigned to them in template
    const assignee = (recipients.signers || [])
      .find(s => s.roleName === "Assignee");

    if (assignee) {
      console.log(`Found Assignee recipientId: ${assignee.recipientId} with ${assignee.tabs?.textTabs?.length} tabs`);
      await updateAssignmentTabs(token, accountId, envelope.envelopeId, assignee, fields);
    } else {
      console.log("Assignee not found");
    }
  }
