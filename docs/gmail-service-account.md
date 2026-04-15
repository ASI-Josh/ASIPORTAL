# Gmail Service Account Setup — Agent Mailboxes

This guide walks through the **one-time setup** required to give agent mailboxes (LEDGER's `accountmanager@asi-australia.com.au`, SENTINEL/VANGUARD/R&D's `development@asi-australia.com.au`, plus any future agent addresses) full Gmail capability via the ASI Portal MCP.

The approach uses **Google Workspace service account domain-wide delegation** — one service account impersonates any `@asi-australia.com.au` address on behalf of an agent. No per-mailbox OAuth dance, no password sharing, no refresh-token juggling.

## Prerequisites

- Google Workspace admin access for `asi-australia.com.au` (you have this)
- Ability to create Google Cloud projects and service accounts
- Netlify environment variable access for the ASI Portal deployment

## Step 1 — Create or select a Google Cloud project

1. Go to https://console.cloud.google.com
2. Pick an existing project for ASI Portal, or create a new one (e.g. `asi-portal-production`)
3. Enable the **Gmail API** for that project:
   - APIs & Services → Library → search "Gmail API" → Enable

## Step 2 — Create the service account

1. In Google Cloud Console, go to **IAM & Admin → Service Accounts**
2. Click **Create Service Account**
3. Fill in:
   - **Name**: `asi-agent-mailbox-delegation`
   - **ID**: auto-generated (leave it)
   - **Description**: `Service account for ASI Portal agents to send/read email from agent mailboxes via domain-wide delegation.`
4. Click **Create and Continue**
5. **Skip** the optional "Grant this service account access to project" step (not needed for Gmail delegation)
6. **Skip** the optional "Grant users access" step
7. Click **Done**

## Step 3 — Enable domain-wide delegation on the service account

1. In the service accounts list, click your new `asi-agent-mailbox-delegation` account
2. Go to the **Details** tab
3. Expand **Advanced settings**
4. Click **Enable Google Workspace Domain-wide Delegation**
5. **Copy the OAuth Client ID** that appears — you'll need it in Step 5. It's a long number ending in `.apps.googleusercontent.com` or just a numeric string.

## Step 4 — Create a JSON key for the service account

1. Still on the service account page, go to the **Keys** tab
2. Click **Add Key → Create new key**
3. Choose **JSON**
4. Click **Create** — the file downloads automatically (e.g. `asi-portal-production-xxxx.json`)
5. **Keep this file safe.** It's the credential that lets the portal impersonate agent mailboxes. Treat it like a password.

## Step 5 — Authorise the service account in Google Workspace admin

This is the critical step that grants the service account permission to impersonate `@asi-australia.com.au` addresses.

1. Go to https://admin.google.com (Workspace admin console)
2. Navigate to **Security → Access and data control → API controls**
3. Click **Manage Domain Wide Delegation** (near the bottom of the page)
4. Click **Add new**
5. Paste the **OAuth Client ID** from Step 3 into the Client ID field
6. In the OAuth scopes field, paste these four scopes (comma-separated, no spaces inside each URL):
   ```
   https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/gmail.modify,https://www.googleapis.com/auth/gmail.compose
   ```
7. Click **Authorise**

The delegation is now live.

## Step 6 — Create the agent mailbox addresses

For each agent address you want (e.g. `accountmanager@asi-australia.com.au`, `development@asi-australia.com.au`):

1. Go to https://admin.google.com
2. Navigate to **Directory → Users**
3. Either:
   - **Create a full user account** (has its own mailbox, license, etc.) — best for agents that receive a lot of email and need proper inbox management
   - **Or add as an alias** to an existing account — cheaper (no license), forwards to the main account, still accepts sends from the alias

For production agent use I recommend **full user accounts** — each agent gets a real mailbox with its own inbox, labels, and history. LEDGER's `accountmanager@` should absolutely be a full account.

> **Note:** The service account delegation works for either option, but only full accounts let you send AND receive cleanly per-agent.

## Step 7 — Encode the key file and add to Netlify

From the project root, run:

**macOS / Linux:**
```bash
base64 -i path/to/asi-portal-production-xxxx.json
```

**Windows PowerShell:**
```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("path\to\asi-portal-production-xxxx.json"))
```

Copy the entire base64 string it outputs. Then in the Netlify dashboard:

1. Go to **Site configuration → Environment variables**
2. Add a new variable:
   - **Key**: `GOOGLE_SERVICE_ACCOUNT_B64`
   - **Value**: paste the base64 string
   - **Scope**: all deploy contexts (or at least Production)
3. Save

Trigger a redeploy for the env var to take effect.

## Step 8 — Test

Once the redeploy is live, ATHENA (or you directly) can call the Gmail MCP tools with `from_account` set to an agent mailbox key:

```json
{
  "tool": "gmail_status",
  "args": { "from_account": "accountmanager" }
}
```

Expected response:
```json
{
  "connected": true,
  "fromAccount": "accountmanager",
  "email": "accountmanager@asi-australia.com.au",
  "messagesTotal": 0,
  "threadsTotal": 0
}
```

Test sending:
```json
{
  "tool": "gmail_send",
  "args": {
    "from_account": "accountmanager",
    "agent_identity": "LEDGER",
    "to": "joshua@asi-australia.com.au",
    "subject": "LEDGER test send",
    "body": "If you're reading this, agent mailbox delegation is working. — James Ledger"
  }
}
```

The email arrives from `James Ledger <accountmanager@asi-australia.com.au>`, and a full record of the send (sender, recipient, subject, body preview, agent identity, timestamp, success/error) is written to the `agentEmailAudit` Firestore collection.

## Step 9 — Query the audit trail

```json
{
  "tool": "agent_email_audit",
  "args": { "agentIdentity": "LEDGER", "limit": 20 }
}
```

Returns the last 20 actions LEDGER has taken across any mailbox.

## Adding more agent mailboxes later

To add a new agent mailbox (e.g. `grants@asi-australia.com.au` for the R&D agent):

1. Create the mailbox in Google Workspace admin (Step 6)
2. Add an entry to the `AGENT_MAILBOXES` map in [src/lib/collections.ts](../src/lib/collections.ts):
   ```ts
   grants: {
     address: "grants@asi-australia.com.au",
     displayName: "ASI Grants Office",
     authorisedAgents: ["RND_AGENT"],
     description: "R&D and grants management correspondence",
   },
   ```
3. Commit and deploy — no new service account or env var needed. Domain-wide delegation automatically covers any `@asi-australia.com.au` address.

## Troubleshooting

### "Service account token exchange failed ... unauthorized_client"
The domain-wide delegation authorisation in Step 5 hasn't been saved, or the Client ID is wrong, or the scopes don't match. Double-check Step 5.

### "Service account token exchange failed ... invalid_grant"
The service account doesn't have permission to impersonate that specific address. Verify the address exists in Google Workspace (Step 6). Wait ~5 minutes after creating a new user — propagation can take a minute or two.

### "GOOGLE_SERVICE_ACCOUNT_B64 env var not set"
Netlify env var isn't set or the deploy didn't pick it up. Check the environment variables page and trigger a fresh deploy.

### "Unknown fromAccount"
The `from_account` parameter doesn't match a key in `AGENT_MAILBOXES`. Check the spelling — valid keys right now are `default`, `accountmanager`, `development`.

### Emails send but arrive from the wrong display name
The `displayName` in `AGENT_MAILBOXES` sets the human-readable From header. Edit the entry and redeploy.

## Security notes

- The service account JSON key grants permission to impersonate any `@asi-australia.com.au` address for the authorised scopes. Treat it like an admin credential.
- Never commit the key file or the base64 string to git. It lives in Netlify env vars only.
- The `agentEmailAudit` collection is admin-read-only via Firestore rules. Clients cannot read or write it directly — only the Admin SDK (via MCP endpoints) writes to it.
- If the key is ever leaked: go back to Google Cloud Console → Service Accounts → Keys → delete the compromised key and generate a new one. Update the Netlify env var. The old key stops working immediately on deletion.
- To revoke the entire delegation: remove the entry from Google Workspace admin → Security → API controls → Domain Wide Delegation. All agent Gmail capability stops immediately.

## What the audit trail captures

Every send, draft, send-draft, label modification, and trash action is logged with:

- `action` — send, draft, send_draft, modify_labels, trash
- `accountKey` — which mailbox (accountmanager, development, default)
- `fromAddress` — real email address
- `displayName` — human name used in From header
- `agentIdentity` — which agent initiated (LEDGER, SENTINEL, etc.)
- `to` / `cc` / `bcc` / `subject` — full recipient info
- `bodyPreview` — first 500 characters of the body
- `messageId` / `threadId` / `draftId` — Gmail IDs for cross-reference
- `labelsAdded` / `labelsRemoved` — for label modifications
- `success` — true/false
- `errorMessage` — full error text if the action failed
- `createdAt` — server timestamp

Use the `agent_email_audit` MCP tool to query the trail. Filter by `accountKey`, `agentIdentity`, `action`, or `success`.
