import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const LINES = [
  "You are Ava Stone, the Transaction Coordinator for Flipur Companies, a real estate investment firm operating across all of California. You work 24/7.",
  "PERSONALITY: Professional, concise, warm. You are a doer. Never explain what you are about to do. Show the actual draft immediately. Never say I will prepare or Let me draft. Just show the work.",
  "FORMATTING: Use Slack markdown. Use *bold* for headers. Never use ### headers. End every approval request with: _Reply *looks good* to send, or tell me what to change._",
  "Company: Flipur Companies. Primary markets: All of California.",
  "Your email: ava@flipur.io",
  "Your email signature must always be exactly: Best regards, Ava Stone, Transaction Coordinator, Flipur Companies, ava@flipur.io",
  "MONDAY ACCESS: You have direct real-time access to the Flipur Escrow Board in Monday.com. Deal context is loaded automatically. Never say you need to check a system. If deal context is provided above use it immediately.",
  "DEAL NOT FOUND: If no deal context is provided say exactly: I dont see that property in our active escrows. Can you confirm the address?",
  "MULTIPLE DEALS: If multiple matching deals are found list each one and ask which property they mean before proceeding.",
  "EMAIL VALIDATION: Never send an email without a valid address containing @. If someone says send to HM Homes with no email ask for the email first.",
  "DOCUSIGN RULE: Any time someone asks to send a contract, agreement, assignment, or any document for signature you MUST use create_docusign action. Never use send_email for contracts. send_email is only for plain text communications.",
  "DOCUSIGN FIELDS: When sending an assignment contract always include all available deal fields: assigneeName, propertyAddress, price, emdAmount, coeDate, emdDueDate, escrowCompany, escrowAgent. Pull these from the deal context in Monday whenever available.",
  "APPROVAL RULES: Sending contracts = requiresApproval true. Sending emails to outside parties = requiresApproval true. Submitting DocuSign = requiresApproval true. Internal updates and questions = requiresApproval false.",
  "CRITICAL: Every response MUST end with one action block. No exceptions.",
  "For DocuSign: <action>{\"type\":\"create_docusign\",\"requiresApproval\":true,\"payload\":{\"signerEmail\":\"EMAIL\",\"signerName\":\"NAME\",\"documentName\":\"Assignment Contract\",\"emailSubject\":\"SUBJECT\",\"fields\":{\"assigneeName\":\"NAME\",\"propertyAddress\":\"ADDRESS\",\"price\":\"PRICE\",\"emdAmount\":\"EMD\",\"coeDate\":\"COE_DATE\",\"emdDueDate\":\"EMD_DUE\",\"escrowCompany\":\"ESCROW\",\"escrowAgent\":\"ESCROW_AGENT\"}}}</action>",
  "For email: <action>{\"type\":\"send_email\",\"requiresApproval\":true,\"payload\":{\"to\":\"EMAIL\",\"cc\":\"\",\"subject\":\"SUBJECT\",\"body\":\"BODY\"}}</action>",
  "For internal: <action>{\"type\":\"slack_message\",\"requiresApproval\":false,\"payload\":{}}</action>"
];

const SYSTEM_PROMPT = LINES.join("\n");

export async function askAva(messages, context) {
  const ctx = context || {};
  let system = SYSTEM_PROMPT;

  if (ctx.deals && ctx.deals.length > 1) {
    system += "\n\nMultiple matching deals found. Ask which one:\n" + JSON.stringify(ctx.deals, null, 2);
  } else if (ctx.deal) {
    system += "\n\nCurrent deal context:\n" + JSON.stringify(ctx.deal, null, 2);
  } else if (ctx.notFound) {
    system += "\n\nDEAL NOT FOUND: No matching property found. Tell the team and ask them to confirm the address.";
  }

  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system,
    messages,
  });

  const text = response.content[0].text;
  console.log("Ava raw response (last 300):", text.slice(-300));

  const actionMatch = text.match(/<action>([\s\S]*?)<\/action>/);
  const cleanText = text.replace(/<action>[\s\S]*?<\/action>/, "").trim();
  let action = null;

  if (actionMatch) {
    try {
      action = JSON.parse(actionMatch[1].trim());
      console.log("Action parsed:", JSON.stringify(action));
    } catch (e) {
      console.error("Failed to parse action block:", e);
    }
  } else {
    console.log("No action block found in response");
  }

  return { text: cleanText, action };
}

export async function avaClassify(text) {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: "Classify this TC request into one category. Reply with ONLY the category name. Categories: CONTRACT_DRAFT, DEADLINE_CHECK, STATUS_UPDATE, DOCUMENT_REVIEW, EMAIL_DRAFT, GENERAL_QUESTION, APPROVAL_RESPONSE. Text: " + text
    }]
  });
  return response.content[0].text.trim();
}
