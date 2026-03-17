import { askAva } from "./brain.js";
import { executeAction } from "./actionExecutor.js";
import { getDealContext } from "./monday.js";
import { pendingApprovals, handleApproval } from "./approvalHandler.js";
import { slackApp } from "../server.js";

// Detect if a channel name looks like a property address
// e.g. "172-lawnview-cir-danville-ca-94526-usa"
function extractAddressFromChannelName(channelName) {
  if (!channelName) return null;
  // Channel names use hyphens instead of spaces
  // Property channels start with a street number
  const match = channelName.match(/^(\d+)-(.+)/);
  if (!match) return null;
  // Convert hyphens back to spaces, remove trailing -usa if present
  const address = channelName
    .replace(/-usa$/, "")
    .replace(/-/g, " ")
    .trim();
  return address;
}

async function getChannelName(channelId) {
  try {
    const result = await slackApp.client.conversations.info({ channel: channelId });
    return result.channel?.name || null;
  } catch (e) {
    console.error("Failed to get channel name:", e.message);
    return null;
  }
}

export async function handleSlackMessage({ event, say, type }) {
  const text = event.text || "";
  const userId = event.user;
  const channel = event.channel;
  const ts = event.ts;
  const threadTs = event.thread_ts;
  const cleanText = text.replace(/<@[A-Z0-9]+>/g, "").trim();
  if (!cleanText) return;

  // If this is a thread reply and there's a pending approval, route to approval handler
  if (threadTs && pendingApprovals.has(threadTs)) {
    await handleApproval({ message: { ...event, text: cleanText }, say });
    return;
  }

  try {
    let messages = [];
    if (threadTs) {
      try {
        const history = await slackApp.client.conversations.replies({
          channel,
          ts: threadTs,
          limit: 20,
        });
        for (const msg of history.messages || []) {
          const msgText = (msg.text || "").replace(/<@[A-Z0-9]+>/g, "").trim();
          if (!msgText) continue;
          const isAva = msg.app_id || msg.bot_id;
          messages.push({ role: isAva ? "assistant" : "user", content: msgText });
        }
      } catch (e) {
        console.error("Failed to fetch thread history:", e.message);
        messages = [{ role: "user", content: cleanText }];
      }
    } else {
      messages = [{ role: "user", content: cleanText }];
    }

    // Check if this is a property channel — if so use channel name as deal lookup
    let dealResult = null;
    const channelName = await getChannelName(channel);
    const channelAddress = extractAddressFromChannelName(channelName);

    if (channelAddress) {
      console.log("Property channel detected:", channelName, "-> searching for:", channelAddress);
      dealResult = await getDealContext(channelAddress);
    }

    // If no property channel match, fall back to searching message text
    if (!dealResult || dealResult.notFound) {
      const fullThreadText = messages.filter(m => m.role === "user").map(m => m.content).join(" ");
      dealResult = await getDealContext(fullThreadText);
    }

    const context =
      dealResult && dealResult.deals
        ? { deals: dealResult.deals }
        : dealResult && dealResult.notFound
        ? { notFound: true }
        : dealResult
        ? { deal: dealResult }
        : {};

    // If in a property channel with a loaded deal, add channel context to system
    const channelContext = channelAddress && context.deal
      ? { ...context, propertyChannel: channelName, autoLoadedAddress: channelAddress }
      : context;

    const { text: avaResponse, action } = await askAva(messages, {
      ...channelContext,
      slackUser: userId,
      channel,
    });

    if (action && action.requiresApproval) {
      await say({
        text: avaResponse,
        thread_ts: threadTs || ts,
        blocks: [
          { type: "section", text: { type: "mrkdwn", text: avaResponse } },
          {
            type: "context",
            elements: [{ type: "mrkdwn", text: "_Reply *looks good* to send, or tell me what to change._" }],
          },
        ],
      });

      const approvalKey = threadTs || ts;
      console.log("Storing pending approval with key: " + approvalKey);
      pendingApprovals.set(approvalKey, {
        action,
        channel,
        requestedBy: userId,
        dealContext: context.deal || null,
        createdAt: Date.now(),
      });
    } else if (action && !action.requiresApproval) {
      await say({ text: avaResponse, thread_ts: threadTs || ts });
      await executeAction(action);
    } else {
      await say({ text: avaResponse, thread_ts: threadTs || ts });
    }
  } catch (err) {
    console.error("Ava slackHandler error:", err);
    await say({
      text: "Hit an error on my end. Let me know if you need me to retry.",
      thread_ts: threadTs || ts,
    });
  }
}
```

Also need to add one scope to Slack so Ava can read channel names. Go to **api.slack.com/apps** → your Ava app → **OAuth & Permissions** → **Bot Token Scopes** and add:

- `channels:read`
- `groups:read`

Then **Reinstall to Workspace**.

After that commit `slackHandler.js` and deploy. Then invite Ava to a property channel and test with:
```
@Ava what's the status on this deal?
