import { admin } from "@/lib/firebaseAdmin";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";
const DEFAULT_APP_URL = "https://asiportal.live";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.modify",
];

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

// ── Gmail API helpers ──

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
