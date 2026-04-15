import { admin } from "@/lib/firebaseAdmin";
import { AGENT_MAILBOXES, isAgentMailbox, type AgentMailboxKey, COLLECTIONS } from "@/lib/collections";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
// Legacy "me" base for OAuth user flow (Joshua's account)
const GMAIL_API = `${GMAIL_API_BASE}/users/me`;
const DEFAULT_APP_URL = "https://asiportal.live";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

// Scopes that must be authorised on the Workspace service account for
// domain-wide delegation to work for agent mailboxes.
const AGENT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
].join(" ");

export function getGmailRedirectUri() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || DEFAULT_APP_URL;
  return process.env.GMAIL_REDIRECT_URI || `${baseUrl}/api/google/gmail/callback`;
}

function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getGmailRedirectUri();
  if (!clientId || !clientSecret) throw new Error("Missing Google OAuth configuration.");
  return { clientId, clientSecret, redirectUri };
}

// ── Auth flow ──

export function buildGmailAuthUrl(state: string) {
  const { clientId, redirectUri } = getOAuthConfig();
  const url = new URL(AUTH_URL);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(" "));
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGmailCode(code: string) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token exchange failed: ${await res.text()}`);
  return res.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

async function refreshGmailToken(refreshToken: string) {
  const { clientId, clientSecret } = getOAuthConfig();
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Gmail token refresh failed: ${await res.text()}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

// ── Token storage ──

const GMAIL_TOKENS_COLLECTION = "gmailTokens";

export async function upsertGmailToken(userId: string, data: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
  email?: string;
}) {
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + data.expiresIn * 1000);
  await admin.firestore().collection(GMAIL_TOKENS_COLLECTION).doc(userId).set(
    {
      userId,
      accessToken: data.accessToken,
      ...(data.refreshToken && { refreshToken: data.refreshToken }),
      expiresAt,
      scope: data.scope || "",
      email: data.email || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

export async function getGmailAccessToken(userId: string = "default") {
  const snap = await admin.firestore().collection(GMAIL_TOKENS_COLLECTION).doc(userId).get();
  if (!snap.exists) throw new Error("Gmail not connected. Use gmail_connect to authorize.");

  const data = snap.data() as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: { toMillis?: () => number };
  };

  let accessToken = data.accessToken;
  const refreshToken = data.refreshToken;
  const expiresAt = data.expiresAt?.toMillis?.() || 0;

  if (!accessToken || Date.now() > expiresAt - 60000) {
    if (!refreshToken) throw new Error("Gmail refresh token missing. Re-authorize with gmail_connect.");
    const refreshed = await refreshGmailToken(refreshToken);
    accessToken = refreshed.access_token;
    await upsertGmailToken(userId, {
      accessToken,
      refreshToken,
      expiresIn: refreshed.expires_in,
    });
  }

  return accessToken!;
}

// ── Service account (domain-wide delegation) for agent mailboxes ──
//
// The GOOGLE_SERVICE_ACCOUNT_B64 env var must contain a base64-encoded
// Google service account JSON key. That service account must have
// domain-wide delegation enabled in Google Workspace admin console with
// the AGENT_SCOPES granted.
//
// Tokens are cached in memory per impersonated email (short-lived, ~55min).

interface CachedServiceToken {
  accessToken: string;
  expiresAt: number;
}
const serviceTokenCache = new Map<string, CachedServiceToken>();

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

function getServiceAccountKey(): ServiceAccountKey {
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  if (!b64) {
    throw new Error(
      "GOOGLE_SERVICE_ACCOUNT_B64 env var not set. Agent mailboxes require a Google Workspace service account with domain-wide delegation. See docs/gmail-service-account.md."
    );
  }
  try {
    const json = Buffer.from(b64, "base64").toString("utf-8");
    const parsed = JSON.parse(json) as ServiceAccountKey;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("Service account key missing client_email or private_key.");
    }
    return parsed;
  } catch (err) {
    throw new Error(`Invalid GOOGLE_SERVICE_ACCOUNT_B64 format: ${err instanceof Error ? err.message : "parse error"}`);
  }
}

/**
 * Sign a JWT with the service account's private key, used to exchange
 * for an access token that impersonates the target email address.
 */
async function signServiceAccountJwt(impersonateEmail: string, key: ServiceAccountKey): Promise<string> {
  const { createSign } = await import("crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: key.client_email,
    sub: impersonateEmail,
    scope: AGENT_SCOPES,
    aud: key.token_uri || TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };

  const b64url = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const unsigned = `${b64url(header)}.${b64url(payload)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  const signature = signer
    .sign(key.private_key)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return `${unsigned}.${signature}`;
}

async function getServiceAccountAccessToken(impersonateEmail: string): Promise<string> {
  const cached = serviceTokenCache.get(impersonateEmail);
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.accessToken;
  }

  const key = getServiceAccountKey();
  const jwt = await signServiceAccountJwt(impersonateEmail, key);

  const res = await fetch(key.token_uri || TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `Service account token exchange failed for ${impersonateEmail}: ${res.status} ${text}. ` +
      "Check that domain-wide delegation is enabled and the Workspace admin has authorised these scopes: " + AGENT_SCOPES
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  const expiresAt = Date.now() + data.expires_in * 1000;
  serviceTokenCache.set(impersonateEmail, { accessToken: data.access_token, expiresAt });
  return data.access_token;
}

// ── Unified auth resolver ──
//
// Routes to either OAuth (for "default" = Joshua's personal account) or
// service account impersonation (for any agent mailbox key). Returns
// the access token AND the API base URL, because service account calls
// use /users/{email} instead of /users/me.

export interface GmailAuthContext {
  accessToken: string;
  apiBase: string;          // e.g. ".../users/me" or ".../users/accountmanager@asi-australia.com.au"
  fromAddress: string;      // The email address emails will be sent from
  displayName?: string;     // Optional human name for From header
  accountKey: string;       // "default" or agent mailbox key
}

export async function resolveGmailAuth(fromAccount: string = "default"): Promise<GmailAuthContext> {
  // Legacy OAuth path — Joshua's personal mailbox
  if (fromAccount === "default" || fromAccount === "joshua") {
    const token = await getGmailAccessToken("default");
    // For OAuth user flow, /users/me resolves to the authorised user.
    // fromAddress can come from the stored token doc or we fall back.
    const snap = await admin.firestore().collection(GMAIL_TOKENS_COLLECTION).doc("default").get();
    const fromAddress = (snap.exists ? (snap.data()?.email as string) : "") || "joshua@asi-australia.com.au";
    return {
      accessToken: token,
      apiBase: GMAIL_API,
      fromAddress,
      accountKey: "default",
    };
  }

  // Agent mailbox path — service account impersonation
  if (!isAgentMailbox(fromAccount)) {
    throw new Error(
      `Unknown fromAccount '${fromAccount}'. Valid options: 'default', ${Object.keys(AGENT_MAILBOXES).map(k => `'${k}'`).join(", ")}.`
    );
  }

  const mailbox = AGENT_MAILBOXES[fromAccount as AgentMailboxKey];
  const accessToken = await getServiceAccountAccessToken(mailbox.address);
  return {
    accessToken,
    apiBase: `${GMAIL_API_BASE}/users/${encodeURIComponent(mailbox.address)}`,
    fromAddress: mailbox.address,
    displayName: mailbox.displayName,
    accountKey: fromAccount,
  };
}

// ── Agent email audit trail ──
//
// Every email sent from an agent mailbox (and optionally every read) is
// logged to Firestore for full traceability. Stored in Firestore (not
// local), immutable once written, queryable via the agent_email_audit
// MCP tool.

export interface AgentEmailAuditEntry {
  action: "send" | "draft" | "send_draft" | "read" | "search" | "modify_labels" | "trash";
  accountKey: string;         // e.g. "accountmanager", "development", "default"
  fromAddress: string;        // Real email address
  displayName?: string;
  agentIdentity?: string;     // e.g. "LEDGER", "SENTINEL" — passed by caller if known
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  bodyPreview?: string;       // First 500 chars
  messageId?: string;         // Gmail message ID returned from the API
  threadId?: string;
  draftId?: string;
  labelsAdded?: string[];
  labelsRemoved?: string[];
  success: boolean;
  errorMessage?: string;
  createdAt: admin.firestore.FieldValue;
}

export async function logAgentEmailAction(
  entry: Omit<AgentEmailAuditEntry, "createdAt">
): Promise<string> {
  const doc = {
    ...entry,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const ref = await admin.firestore().collection(COLLECTIONS.AGENT_EMAIL_AUDIT).add(doc);
  return ref.id;
}

// ── Gmail API helpers (legacy /me base — kept for backwards compat) ──

async function gmailGet(path: string, accessToken: string) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function gmailPost(path: string, accessToken: string, body: unknown) {
  const res = await fetch(`${GMAIL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Context-aware Gmail API helpers (new multi-account path) ──

async function gmailGetCtx(ctx: GmailAuthContext, path: string) {
  const res = await fetch(`${ctx.apiBase}${path}`, {
    headers: { Authorization: `Bearer ${ctx.accessToken}` },
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  return res.json();
}

async function gmailPostCtx(ctx: GmailAuthContext, path: string, body: unknown) {
  const res = await fetch(`${ctx.apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gmail API error: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Public API functions ──

export async function gmailGetProfile(accessToken: string) {
  return gmailGet("/profile", accessToken);
}

export async function gmailListMessages(
  accessToken: string,
  opts: { query?: string; maxResults?: number; labelIds?: string[]; pageToken?: string }
) {
  const params = new URLSearchParams();
  if (opts.query) params.set("q", opts.query);
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
  if (opts.labelIds) params.set("labelIds", opts.labelIds.join(","));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const list = await gmailGet(`/messages?${params}`, accessToken) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };

  return list;
}

export async function gmailGetMessage(accessToken: string, messageId: string, format: string = "full") {
  const msg = await gmailGet(`/messages/${messageId}?format=${format}`, accessToken) as Record<string, unknown>;

  // Parse headers for readability
  const headers = (msg.payload as Record<string, unknown>)?.headers as { name: string; value: string }[] || [];
  const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  // Decode body
  let bodyText = "";
  const payload = msg.payload as Record<string, unknown>;
  if (payload) {
    bodyText = extractBody(payload);
  }

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds,
    snippet: msg.snippet,
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    messageId: getHeader("Message-ID"),
    inReplyTo: getHeader("In-Reply-To"),
    body: bodyText.slice(0, 5000) || null,
    sizeEstimate: msg.sizeEstimate,
  };
}

function extractBody(payload: Record<string, unknown>): string {
  // Simple text/plain extraction
  const body = payload.body as { data?: string; size?: number } | undefined;
  if (body?.data) {
    return Buffer.from(body.data, "base64url").toString("utf-8");
  }

  // Multipart — recurse
  const parts = payload.parts as Record<string, unknown>[] | undefined;
  if (parts) {
    // Prefer text/plain, fallback to text/html
    for (const mime of ["text/plain", "text/html"]) {
      for (const part of parts) {
        if (part.mimeType === mime) {
          const partBody = part.body as { data?: string } | undefined;
          if (partBody?.data) {
            let text = Buffer.from(partBody.data, "base64url").toString("utf-8");
            if (mime === "text/html") {
              text = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            }
            return text;
          }
        }
        // Nested multipart
        if (part.parts) {
          const nested = extractBody(part as Record<string, unknown>);
          if (nested) return nested;
        }
      }
    }
  }

  return "";
}

export async function gmailGetThread(accessToken: string, threadId: string) {
  return gmailGet(`/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`, accessToken);
}

export async function gmailSendMessage(
  accessToken: string,
  opts: { to: string; subject: string; body: string; cc?: string; bcc?: string; replyTo?: string; inReplyTo?: string; threadId?: string }
) {
  const lines: string[] = [];
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Subject: ${opts.subject}`);
  if (opts.replyTo) lines.push(`Reply-To: ${opts.replyTo}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body);

  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  return gmailPost("/messages/send", accessToken, {
    raw,
    ...(opts.threadId && { threadId: opts.threadId }),
  });
}

export async function gmailCreateDraft(
  accessToken: string,
  opts: { to: string; subject: string; body: string; cc?: string; bcc?: string }
) {
  const lines: string[] = [];
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Subject: ${opts.subject}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body);

  const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

  return gmailPost("/drafts", accessToken, {
    message: { raw },
  });
}

export async function gmailListDrafts(accessToken: string, maxResults: number = 10) {
  return gmailGet(`/drafts?maxResults=${maxResults}`, accessToken);
}

export async function gmailSendDraft(accessToken: string, draftId: string) {
  return gmailPost(`/drafts/send`, accessToken, { id: draftId });
}

export async function gmailListLabels(accessToken: string) {
  return gmailGet("/labels", accessToken);
}

export async function gmailModifyLabels(
  accessToken: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[]
) {
  return gmailPost(`/messages/${messageId}/modify`, accessToken, {
    addLabelIds,
    removeLabelIds,
  });
}

export async function gmailTrashMessage(accessToken: string, messageId: string) {
  return gmailPost(`/messages/${messageId}/trash`, accessToken, {});
}

// ══════════════════════════════════════════════════════════════════════════
// MULTI-ACCOUNT API (preferred entry point — supports agent mailboxes)
// ══════════════════════════════════════════════════════════════════════════
//
// These functions accept a `fromAccount` key that routes to either the
// default OAuth user (Joshua) or a service-account-impersonated agent
// mailbox. All send/draft/modify actions are logged to the
// agentEmailAudit Firestore collection for full traceability.

function buildRawMimeMessage(opts: {
  fromAddress: string;
  displayName?: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  replyTo?: string;
  inReplyTo?: string;
}): string {
  const fromHeader = opts.displayName
    ? `${opts.displayName} <${opts.fromAddress}>`
    : opts.fromAddress;
  const lines: string[] = [];
  lines.push(`From: ${fromHeader}`);
  lines.push(`To: ${opts.to}`);
  if (opts.cc) lines.push(`Cc: ${opts.cc}`);
  if (opts.bcc) lines.push(`Bcc: ${opts.bcc}`);
  lines.push(`Subject: ${opts.subject}`);
  if (opts.replyTo) lines.push(`Reply-To: ${opts.replyTo}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  lines.push("Content-Type: text/plain; charset=utf-8");
  lines.push("");
  lines.push(opts.body);
  return Buffer.from(lines.join("\r\n")).toString("base64url");
}

export async function gmailGetProfileForAccount(fromAccount: string) {
  const ctx = await resolveGmailAuth(fromAccount);
  return gmailGetCtx(ctx, "/profile");
}

export async function gmailListMessagesForAccount(
  fromAccount: string,
  opts: { query?: string; maxResults?: number; labelIds?: string[]; pageToken?: string }
) {
  const ctx = await resolveGmailAuth(fromAccount);
  const params = new URLSearchParams();
  if (opts.query) params.set("q", opts.query);
  if (opts.maxResults) params.set("maxResults", String(opts.maxResults));
  if (opts.labelIds) params.set("labelIds", opts.labelIds.join(","));
  if (opts.pageToken) params.set("pageToken", opts.pageToken);

  const list = await gmailGetCtx(ctx, `/messages?${params}`) as {
    messages?: { id: string; threadId: string }[];
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  return list;
}

export async function gmailGetMessageForAccount(
  fromAccount: string,
  messageId: string,
  format: string = "full"
) {
  const ctx = await resolveGmailAuth(fromAccount);
  const msg = await gmailGetCtx(ctx, `/messages/${messageId}?format=${format}`) as Record<string, unknown>;

  const headers = (msg.payload as Record<string, unknown>)?.headers as { name: string; value: string }[] || [];
  const getHeader = (name: string) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  let bodyText = "";
  const payload = msg.payload as Record<string, unknown>;
  if (payload) bodyText = extractBody(payload);

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds,
    snippet: msg.snippet,
    from: getHeader("From"),
    to: getHeader("To"),
    cc: getHeader("Cc"),
    subject: getHeader("Subject"),
    date: getHeader("Date"),
    messageId: getHeader("Message-ID"),
    inReplyTo: getHeader("In-Reply-To"),
    body: bodyText.slice(0, 5000) || null,
    sizeEstimate: msg.sizeEstimate,
  };
}

export async function gmailGetThreadForAccount(fromAccount: string, threadId: string) {
  const ctx = await resolveGmailAuth(fromAccount);
  return gmailGetCtx(
    ctx,
    `/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`
  );
}

export async function gmailSendMessageForAccount(
  fromAccount: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    replyTo?: string;
    inReplyTo?: string;
    threadId?: string;
    agentIdentity?: string;
  }
) {
  const ctx = await resolveGmailAuth(fromAccount);
  const raw = buildRawMimeMessage({
    fromAddress: ctx.fromAddress,
    displayName: ctx.displayName,
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    cc: opts.cc,
    bcc: opts.bcc,
    replyTo: opts.replyTo,
    inReplyTo: opts.inReplyTo,
  });

  let result: { id?: string; threadId?: string } | null = null;
  let success = false;
  let errorMessage: string | undefined;
  try {
    result = await gmailPostCtx(ctx, "/messages/send", {
      raw,
      ...(opts.threadId && { threadId: opts.threadId }),
    }) as { id?: string; threadId?: string };
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await logAgentEmailAction({
      action: "send",
      accountKey: ctx.accountKey,
      fromAddress: ctx.fromAddress,
      displayName: ctx.displayName,
      agentIdentity: opts.agentIdentity,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      bodyPreview: opts.body.slice(0, 500),
      messageId: result?.id,
      threadId: result?.threadId || opts.threadId,
      success,
      errorMessage,
    }).catch((logErr) => {
      console.error("[gmail-audit] Failed to log send action:", logErr);
    });
  }
}

export async function gmailCreateDraftForAccount(
  fromAccount: string,
  opts: {
    to: string;
    subject: string;
    body: string;
    cc?: string;
    bcc?: string;
    agentIdentity?: string;
  }
) {
  const ctx = await resolveGmailAuth(fromAccount);
  const raw = buildRawMimeMessage({
    fromAddress: ctx.fromAddress,
    displayName: ctx.displayName,
    to: opts.to,
    subject: opts.subject,
    body: opts.body,
    cc: opts.cc,
    bcc: opts.bcc,
  });

  let result: { id?: string; message?: { id?: string; threadId?: string } } | null = null;
  let success = false;
  let errorMessage: string | undefined;
  try {
    result = await gmailPostCtx(ctx, "/drafts", {
      message: { raw },
    }) as { id?: string; message?: { id?: string; threadId?: string } };
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await logAgentEmailAction({
      action: "draft",
      accountKey: ctx.accountKey,
      fromAddress: ctx.fromAddress,
      displayName: ctx.displayName,
      agentIdentity: opts.agentIdentity,
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      bodyPreview: opts.body.slice(0, 500),
      draftId: result?.id,
      messageId: result?.message?.id,
      threadId: result?.message?.threadId,
      success,
      errorMessage,
    }).catch((logErr) => {
      console.error("[gmail-audit] Failed to log draft action:", logErr);
    });
  }
}

export async function gmailListDraftsForAccount(fromAccount: string, maxResults: number = 10) {
  const ctx = await resolveGmailAuth(fromAccount);
  return gmailGetCtx(ctx, `/drafts?maxResults=${maxResults}`);
}

export async function gmailSendDraftForAccount(
  fromAccount: string,
  draftId: string,
  agentIdentity?: string
) {
  const ctx = await resolveGmailAuth(fromAccount);
  let result: { id?: string; threadId?: string } | null = null;
  let success = false;
  let errorMessage: string | undefined;
  try {
    result = await gmailPostCtx(ctx, "/drafts/send", { id: draftId }) as { id?: string; threadId?: string };
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await logAgentEmailAction({
      action: "send_draft",
      accountKey: ctx.accountKey,
      fromAddress: ctx.fromAddress,
      displayName: ctx.displayName,
      agentIdentity,
      draftId,
      messageId: result?.id,
      threadId: result?.threadId,
      success,
      errorMessage,
    }).catch((logErr) => {
      console.error("[gmail-audit] Failed to log send_draft action:", logErr);
    });
  }
}

export async function gmailListLabelsForAccount(fromAccount: string) {
  const ctx = await resolveGmailAuth(fromAccount);
  return gmailGetCtx(ctx, "/labels");
}

export async function gmailModifyLabelsForAccount(
  fromAccount: string,
  messageId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
  agentIdentity?: string
) {
  const ctx = await resolveGmailAuth(fromAccount);
  let success = false;
  let errorMessage: string | undefined;
  let result: unknown;
  try {
    result = await gmailPostCtx(ctx, `/messages/${messageId}/modify`, {
      addLabelIds,
      removeLabelIds,
    });
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await logAgentEmailAction({
      action: "modify_labels",
      accountKey: ctx.accountKey,
      fromAddress: ctx.fromAddress,
      displayName: ctx.displayName,
      agentIdentity,
      messageId,
      labelsAdded: addLabelIds,
      labelsRemoved: removeLabelIds,
      success,
      errorMessage,
    }).catch((logErr) => {
      console.error("[gmail-audit] Failed to log modify_labels action:", logErr);
    });
  }
}

export async function gmailTrashMessageForAccount(
  fromAccount: string,
  messageId: string,
  agentIdentity?: string
) {
  const ctx = await resolveGmailAuth(fromAccount);
  let success = false;
  let errorMessage: string | undefined;
  let result: unknown;
  try {
    result = await gmailPostCtx(ctx, `/messages/${messageId}/trash`, {});
    success = true;
    return result;
  } catch (err) {
    errorMessage = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    await logAgentEmailAction({
      action: "trash",
      accountKey: ctx.accountKey,
      fromAddress: ctx.fromAddress,
      displayName: ctx.displayName,
      agentIdentity,
      messageId,
      success,
      errorMessage,
    }).catch((logErr) => {
      console.error("[gmail-audit] Failed to log trash action:", logErr);
    });
  }
}
