import { sendEmail } from "./gmail.js";
import { createDocuSignEnvelope } from "./docusign.js";
import { updateMondayItem, createMondayItem } from "./monday.js";
import { updateCloseDeal } from "./close.js";
import { generateEscrowInvoice } from "./invoiceGenerator.js";
import { generateBidPDF } from "./bidGenerator.js";

export async function executeAction(action) {
  switch (action.type) {
    case "send_email":
      await sendEmail(action.payload);
      return { summary: "Email sent to " + action.payload.to + "." };

    case "create_docusign": {
      const envelope = await createDocuSignEnvelope(action.payload);
      return { summary: "DocuSign envelope created. ID: " + envelope.envelopeId };
    }

    case "send_invoice": {
      const { pdfBuffer, invoiceNumber, fileName } = await generateEscrowInvoice(action.payload);

      // Email to escrow
      await sendEmail({
        to: action.payload.escrowEmail,
        subject: "Invoice " + invoiceNumber + " - " + action.payload.propertyAddress,
        body: "Please find attached invoice " + invoiceNumber + " for the assignment fee on " + action.payload.propertyAddress + ".\n\nWire instructions are included on the invoice.\n\nBest regards,\nAva Stone\nTransaction Coordinator\nFlipur Companies\nava@flipur.io",
        attachments: [{
          filename: fileName,
          content: pdfBuffer.toString("base64"),
          encoding: "base64",
          contentType: "application/pdf"
        }],
      });

      // Also return PDF buffer so approvalHandler uploads it to Slack
      return {
        summary: "Invoice " + invoiceNumber + " sent to " + action.payload.escrowEmail + " and posted here.",
        pdfBuffer,
        fileName,
      };
    }

    case "generate_bid": {
      const { pdfBuffer, fileName } = await generateBidPDF(action.payload);
      return { summary: "Repair estimate ready.", pdfBuffer, fileName };
    }

    case "update_monday":
      await updateMondayItem(action.payload);
      return { summary: "Monday.com updated for " + action.payload.dealAddress + "." };

    case "create_monday_item": {
      const item = await createMondayItem(action.payload);
      return { summary: "New Monday.com task created: " + item.id };
    }

    case "update_close":
      await updateCloseDeal(action.payload);
      return { summary: "Close CRM updated." };

    case "slack_message":
      return { summary: "Slack message sent." };

    default:
      throw new Error("Unknown action type: " + action.type);
  }
}
