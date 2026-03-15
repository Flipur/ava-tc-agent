import { sendEmail } from "./gmail.js";
import { createDocuSignEnvelope } from "./docusign.js";
import { updateMondayItem, createMondayItem } from "./monday.js";
import { updateCloseDeal } from "./close.js";

export async function executeAction(action) {
  switch (action.type) {

    case "send_email":
      await sendEmail(action.payload);
      return { summary: `Email sent to ${action.payload.to}.` };

    case "create_docusign":
      const envelope = await createDocuSignEnvelope(action.payload);
      return { summary: `DocuSign envelope created. ID: ${envelope.envelopeId}` };

    case "update_monday":
      await updateMondayItem(action.payload);
      return { summary: `Monday.com updated for ${action.payload.dealAddress}.` };

    case "create_monday_item":
      const item = await createMondayItem(action.payload);
      return { summary: `New Monday.com task created: ${item.id}` };

    case "update_close":
      await updateCloseDeal(action.payload);
      return { summary: `Close CRM updated.` };

    case "slack_message":
      // Internal Slack messages are handled directly by slackHandler
      return { summary: `Slack message sent.` };

    default:
      throw new Error(`Unknown action type: ${action.type}`);
  }
}
