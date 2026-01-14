import { randomBytes } from "crypto";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_API = "https://www.googleapis.com/calendar/v3";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
];

export function getRedirectUri() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:9002";
  return process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/google/calendar/callback`;
}

export function getOAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = getRedirectUri();

  if (!clientId || !clientSecret) {
    throw new Error("Missing Google OAuth configuration.");
  }

  return { clientId, clientSecret, redirectUri };
}

export function buildAuthUrl(state: string) {
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

export async function createAuthState(userId: string) {
  const state = randomBytes(16).toString("hex");
  await admin.firestore().collection("calendarAuthStates").doc(state).set({
    userId,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return state;
}

export async function exchangeCodeForTokens(code: string) {
  const { clientId, clientSecret, redirectUri } = getOAuthConfig();
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: "authorization_code",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token exchange failed: ${text}`);
  }

  return response.json() as Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function refreshAccessToken(refreshToken: string) {
  const { clientId, clientSecret } = getOAuthConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Token refresh failed: ${text}`);
  }

  return response.json() as Promise<{
    access_token: string;
    expires_in: number;
    scope?: string;
  }>;
}

export async function fetchCalendarEvents(accessToken: string, timeMin: string, timeMax: string) {
  const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("timeMin", timeMin);
  url.searchParams.set("timeMax", timeMax);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "100");
  url.searchParams.set("conferenceDataVersion", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Calendar fetch failed: ${text}`);
  }

  return response.json() as Promise<{ items?: Record<string, unknown>[] }>;
}

export async function createCalendarEvent(
  accessToken: string,
  event: Record<string, unknown>
) {
  const url = new URL(`${CALENDAR_API}/calendars/primary/events`);
  url.searchParams.set("conferenceDataVersion", "1");
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Calendar create failed: ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export async function updateCalendarEvent(
  accessToken: string,
  eventId: string,
  event: Record<string, unknown>
) {
  const url = new URL(`${CALENDAR_API}/calendars/primary/events/${eventId}`);
  url.searchParams.set("conferenceDataVersion", "1");
  const response = await fetch(url.toString(), {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Calendar update failed: ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export async function getAccessTokenForUser(userId: string) {
  const tokenSnap = await admin
    .firestore()
    .collection(COLLECTIONS.CALENDAR_TOKENS)
    .doc(userId)
    .get();

  if (!tokenSnap.exists) {
    throw new Error("No calendar connection found.");
  }

  const tokenData = tokenSnap.data() as {
    accessToken?: string;
    refreshToken?: string;
    expiresAt?: { toMillis?: () => number };
  };

  let accessToken = tokenData.accessToken;
  const refreshToken = tokenData.refreshToken;
  const expiresAt = tokenData.expiresAt?.toMillis?.() || 0;
  const now = Date.now();

  if (!accessToken || (expiresAt && now > expiresAt - 60000)) {
    if (!refreshToken) {
      throw new Error("Missing refresh token.");
    }
    const refreshed = await refreshAccessToken(refreshToken);
    accessToken = refreshed.access_token;
    await upsertCalendarToken(userId, {
      accessToken,
      refreshToken,
      expiresIn: refreshed.expires_in,
      scope: refreshed.scope,
    });
  }

  if (!accessToken) {
    throw new Error("Missing access token.");
  }

  return accessToken;
}

export async function upsertCalendarToken(userId: string, data: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  scope?: string;
}) {
  const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + data.expiresIn * 1000);
  const tokenRef = admin.firestore().collection(COLLECTIONS.CALENDAR_TOKENS).doc(userId);

  await tokenRef.set(
    {
      userId,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt,
      scope: data.scope || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}
