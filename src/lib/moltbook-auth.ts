import { NextRequest } from "next/server";

export type MoltbookAgentOwner = {
  x_handle?: string | null;
  x_verified?: boolean | null;
};

export type MoltbookAgent = {
  id: string;
  name: string;
  karma: number;
  avatar_url?: string | null;
  is_claimed?: boolean | null;
  owner?: MoltbookAgentOwner | null;
};

export type MoltbookVerifyResponse = {
  valid: boolean;
  agent?: MoltbookAgent;
  error?: "identity_token_expired" | "invalid_token" | "invalid_app_key" | string;
};

const MOLTBOOK_VERIFY_URL = "https://moltbook.com/api/v1/agents/verify-identity";

export const extractMoltbookIdentityToken = (req: NextRequest) =>
  req.headers.get("X-Moltbook-Identity") || req.headers.get("x-moltbook-identity");

export const verifyMoltbookIdentityToken = async (token: string): Promise<MoltbookVerifyResponse> => {
  const appKey = process.env.MOLTBOOK_APP_KEY;
  if (!appKey) {
    throw new Error("Missing MOLTBOOK_APP_KEY.");
  }

  const response = await fetch(MOLTBOOK_VERIFY_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Moltbook-App-Key": appKey,
    },
    body: JSON.stringify({ token }),
  });

  if (!response.ok) {
    const text = await response.text();
    return {
      valid: false,
      error: `verify_failed:${response.status}:${text.slice(0, 200)}`,
    };
  }

  const payload = (await response.json()) as MoltbookVerifyResponse;
  return payload;
};

export const getMoltbookAgentFromRequest = async (req: NextRequest) => {
  const token = extractMoltbookIdentityToken(req);
  if (!token) {
    return { agent: null, error: "missing_identity", status: 401 };
  }

  const result = await verifyMoltbookIdentityToken(token);
  if (!result.valid || !result.agent) {
    return {
      agent: null,
      error: result.error || "invalid_token",
      status: result.error === "invalid_app_key" ? 500 : 401,
    };
  }

  return { agent: result.agent, error: null, status: 200 };
};
