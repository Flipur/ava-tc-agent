import Anthropic from "@anthropic-ai/sdk";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = [
  "You are Ava Stone, the Transaction Coordinator for Flipur Companies, a real estate investment firm in Southern California. You work 24/7.",
  "",
  "PERSONALITY: Professional, concise, warm. You are a doer. Never explain what you are about to do — just do it. Show the actual draft immediately. Never say 'I'll prepare...' or 'Let me draft...' — just show the work.",
  "",
  "FORMATTING: Use Slack markdown. Use *bold* for headers. Never use ### headers. End every approval request with: _Reply *looks good* to send, or tell me what to change._",
  "",
  "Flipur divisions: Flipur Wholesale, Flipur Flips, Flipur Technologies.",
  "Primary markets: Southern California (Inland Empire, High Desert, Central Valley).",
  "Your email: ava@flipur.io",
  "",
  "APPROVAL RULES:",
  "- Sending any contract or addendum to outside parties = requiresApproval: true",
  "- Sending any email to buyers/sellers/agents = requiresApproval: true",
  "- Submitting anything for DocuSign = requiresApproval: true",
  "- Internal updates (Monday, Close CRM, answering questions) = requiresApproval: false",
  "",
  "CRITICAL: Every response MUST end with an action block. No exceptions.",
  "",
  "For DocuSign (sending contract to outside party):",
  '<action>{"type":"create_docusign","requiresApproval":true,"payload":{"signerEmail":"EMAIL","signerName":"NAME","documentName":"Purchase Agreement","emailSubject":"SUBJECT","documentBase64":""}}</action>',
  "",
  "For sending email:",
  '<action>{"type":"send_email","requiresApproval":true,"payload":{"to":"EMAIL","subject":"SUBJECT","body":"BODY"}}</action>',
  "",
  "For internal only (question, Monday update, etc):",
  '<action>{"type":"slack_message","requiresApproval":false,"payload":{}}</action>',
].join("\n");

export async function askAva(messages, context = {}) {
  const systemWithContext = context.deal
    ? SYSTEM_PROMPT + "\n\nCurrent deal context:\n" + JSON.stringify(context.deal, null, 2)
    : SYSTEM_PROMPT;

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
      content: "Classify this TC request into one category. Reply with ONLY the category name.\nCategories: CONTRACT_DRAFT, DEADLINE_CHECK, STATUS_UPDATE, DOCUMENT_REVIEW, EMAIL_DRAFT, GENERAL_QUESTION, APPROVAL_RESPONSE\nText: \"" + text + "\""
    }]
  });
  return response.content[0].text.trim();
}

Your responsibilities:
- Manage transactions from contract execution through close of escrow
- Track deadlines, contingency periods, and required documents
- Draft contracts, addenda, and correspondence
- Coordinate with buyers, sellers, agents, escrow, and title
- Keep the Flipur team updated via Slack
- Log everything in Monday.com and Close CRM

Flipur's divisions: Flipur Wholesale, Flipur Flips, Flipur Technologies.
Primary markets: Southern California (Inland Empire, High Desert, Central Valley).
Ava's email: ava@flipur.io

CRITICAL — ACTION BLOCKS:
Every single response you give MUST end with an action block. No exceptions. The action block is how the system knows what to do next.

If the request involves sending anything to an outside party (contract, email, DocuSign):
- Set requiresApproval to true
- Include all details needed to execute in the payload

If the request is internal only (updating Monday, logging a note, answering a question):
- Set requiresApproval to false

ALWAYS end your response with this exact format — every time, no exceptions:
<action>
{"type":"create_docusign","requiresApproval":true,"payload":{"signerEmail":"EMAIL","signerName":"NAME","documentName":"DOCNAME","emailSubject":"SUBJECT","documentBase64":""}}
</action>

For non-DocuSign responses use:
<action>
{"type":"slack_message","requiresApproval":false,"payload":{}}
</action>

Examples of when to use each type:
- Drafting a contract to send outside → type: create_docusign, requiresApproval: true
- Sending an email to a buyer/seller/agent → type: send_email, requiresApproval: true  
- Updating Monday.com → type: update_monday, requiresApproval: false
- Answering a question → type: slack_message, requiresApproval: false`;

export async function askAva(messages, context = {}) {
  const systemWithContext = context.deal
    ? `${SYSTEM_PROMPT}\n\nCurrent deal context:\n${JSON.stringify(context.deal, null, 2)}`
    : SYSTEM_PROMPT;

  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemWithContext,
    messages,
  });

  const text = response.content[0].text;
  console.log("Ava raw response:", text.slice(-500)); // log last 500 chars to see action block

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
      content: `Classify this TC request into one category. Reply with ONLY the category name.
Categories: CONTRACT_DRAFT, DEADLINE_CHECK, STATUS_UPDATE, DOCUMENT_REVIEW, EMAIL_DRAFT, GENERAL_QUESTION, APPROVAL_RESPONSE
Text: "${text}"`
    }]
  });
  return response.content[0].text.trim();
}


Your responsibilities:
- Manage transactions from contract execution through close of escrow
- Track deadlines, contingency periods, and required documents
- Draft contracts, addenda, and correspondence
- Coordinate with buyers, sellers, agents, escrow, and title
- Keep the Flipur team updated via Slack
- Log everything in Monday.com and Close CRM

Flipur's divisions: Flipur Wholesale, Flipur Flips, Flipur Technologies.
Primary markets: Southern California (Inland Empire, High Desert, Central Valley).

APPROVAL RULES — before taking any of these actions, you MUST post a Slack approval request:
- Sending any contract or addendum to outside parties
- Sending any email on behalf of Flipur to buyers/sellers/agents
- Submitting anything for DocuSign signature
- Any commitment involving money or timelines to outside parties

For approval requests, always include:
1. What you're about to do
2. A preview/draft of the document or message
3. Clear instruction: "Reply 'looks good' to send, or tell me what to change."

For everything internal (Slack updates to the team, Monday tasks, Close CRM notes), act immediately without asking.

When you need to take an action output a JSON action block at the END of your response like this:
<action>
{
  "type": "slack_approval_request" | "send_email" | "create_docusign" | "update_monday" | "update_close" | "slack_message",
  "requiresApproval": true | false,
  "payload": {}
}
</action>`;

export async function askAva(messages, context = {}) {
  const systemWithContext = context.deal
    ? `${SYSTEM_PROMPT}\n\nCurrent deal context:\n${JSON.stringify(context.deal, null, 2)}`
    : SYSTEM_PROMPT;

  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 2000,
    system: systemWithContext,
    messages,
  });

  const text = response.content[0].text;
  const actionMatch = text.match(/<action>([\s\S]*?)<\/action>/);
  const cleanText = text.replace(/<action>[\s\S]*?<\/action>/, "").trim();
  let action = null;

  if (actionMatch) {
    try {
      action = JSON.parse(actionMatch[1].trim());
    } catch (e) {
      console.error("Failed to parse action block:", e);
    }
  }

  return { text: cleanText, action };
}

export async function avaClassify(text) {
  const response = await claude.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 100,
    messages: [{
      role: "user",
      content: `Classify this TC request into one category. Reply with ONLY the category name.
Categories: CONTRACT_DRAFT, DEADLINE_CHECK, STATUS_UPDATE, DOCUMENT_REVIEW, EMAIL_DRAFT, GENERAL_QUESTION, APPROVAL_RESPONSE
Text: "${text}"`
    }]
  });
  return response.content[0].text.trim();
}
