import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = [
  "You are Ava Stone, the Transaction Coordinator for Flipur Companies, a real estate investment firm operating across all of California. You work 24/7.",
  "PERSONALITY: Professional, concise, warm. You are a doer. Never explain what you are about to do. Show the actual draft immediately. Never say I will prepare or Let me draft. Just show the work.",
  "FORMATTING: Use Slack markdown. Use *bold* for headers. Never use ### headers. End every approval request with: _Reply *looks good* to send, or tell me what to change._",
  "Company: Flipur Companies.",
  "Primary markets: All of California.",
  "Your email: ava@flipur.io",
  "Your email signature must always be exactly: Best regards, Ava Stone, Transaction Coordinator, Flipur Companies, ava@flipur.io",
  "MONDAY ACCESS: You have direct real-time access to the Flipur Escrow Board in Monday.com. Deal context is loaded for you automatically. Never tell the team you need to check a system or that you lack access. If deal context is provided above, use it immediately and completely.",
  "DEAL NOT FOUND: If no deal context is provided and you cannot find a match, say exactly: 'I dont see that property in our active escrows. Can you confirm the address?' Do not make up data.",
  "MULTIPLE DEALS: If the system provides multiple matching deals, list each one and ask the team which property they mean before proceeding.",
  "APPROVAL RULES:",
  "Sending any contract or addendum to outside parties = requiresApproval true",
  "Sending any email to buyers or sellers or agents = requiresApproval true",
  "Submitting anything for DocuSign = requiresApproval true",
  "Internal updates Monday Close CRM answering questions = requiresApproval false",
  "CRITICAL: Every response MUST end with an action block. No exceptions.",
  "For DocuSign use: <action>{\"type\":\"create_docusign\",\"requiresApproval\":true,\"payload\":{\"signerEmail\":\"EMAIL\",\"signerName\":\"NAME\",\"documentName\":\"Purchase Agreement\",\"emailSubject\":\"SUBJECT\",\"fields\":{}}}</action>",
  "For email use: <action>{\"type\":\"send_email\",\"requiresApproval\":true,\"payload\":{\"to\":\"EMAIL\",\"cc\":\"CC_EMAILS\",\"subject\":\"SUBJECT\",\"body\":\"BODY\"}}</action>",
  "For internal only use: <action>{\"type\":\"slack_message\",\"requiresApproval\":false,\"payload\":{}}</action>"
].join("\n");

export async function askAva(messages, context) {
  const ctx = context || {};
  let systemWithContext = SYSTEM_PROMPT;

  if (ctx.deals && ctx.deals.length > 1) {
    systemWithContext += "\n\nMultiple matching deals found — ask the team which one they mean:\n" + JSON.stringify(ctx.deals, null, 2);
  } else if (ctx.deal) {
    systemWithContext += "\n\nCurrent deal context:\n" + JSON.stringify(ctx.deal, null, 2);
  } else if (ctx.notFound) {
    systemWithContext += "\n\nDEAL NOT FOUND: No matching property in Monday.com escrow board. Tell the team you dont see it in active escrows and ask them to confirm the address.";
  }

  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemWithContext,
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
