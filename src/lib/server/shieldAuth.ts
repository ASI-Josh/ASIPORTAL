/**
 * SHIELD service account authentication + installer JWT session helpers.
 *
 * Three auth contexts:
 *   1. SHIELD service account — operational endpoints (shield-queue, validate)
 *      Env: SHIELD_API_KEY
 *      Header: x-shield-api-key or Authorization: Bearer <SHIELD_API_KEY>
 *   2. Trade installer JWT — authenticated installer flows (trade-dashboard,
 *      trade-order). JWTs are signed with SHIELD_JWT_SECRET, TTL 7 days.
 *   3. Public — quote-request and trade-application (no auth, rate-limited
 *      upstream by Netlify Functions).
 */

import { NextRequest } from "next/server";
import crypto from "crypto";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

// ─── SHIELD service account ─────────────────────────────────────────────────

export function requireShieldServiceAuth(req: NextRequest): void {
  const apiKey = process.env.SHIELD_API_KEY;
  if (!apiKey) {
    throw new Error("SHIELD_API_KEY not configured on server.");
  }
  const headerKey = req.headers.get("x-shield-api-key") || "";
  const authHeader = req.headers.get("authorization") || "";
  const bearerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (headerKey !== apiKey && bearerKey !== apiKey) {
    throw new Error("Invalid SHIELD service credentials.");
  }
}

// ─── Trade installer JWT session ────────────────────────────────────────────

export interface TradeSessionPayload {
  organizationId: string;
  organizationName: string;
  contactEmail: string;
  tradeDiscountBand: "A" | "B" | "C";
  iat: number;
  exp: number;
}

const TRADE_SESSION_TTL_SECONDS = 7 * 86400; // 7 days

function base64urlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  input = input.replace(/-/g, "+").replace(/_/g, "/");
  while (input.length % 4) input += "=";
  return Buffer.from(input, "base64");
}

export function signTradeSession(
  payload: Omit<TradeSessionPayload, "iat" | "exp">
): string {
  const secret = process.env.SHIELD_JWT_SECRET;
  if (!secret) throw new Error("SHIELD_JWT_SECRET not configured.");

  const now = Math.floor(Date.now() / 1000);
  const fullPayload: TradeSessionPayload = {
    ...payload,
    iat: now,
    exp: now + TRADE_SESSION_TTL_SECONDS,
  };

  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64urlEncode(JSON.stringify(header));
  const encodedPayload = base64urlEncode(JSON.stringify(fullPayload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", secret)
    .update(signingInput)
    .digest();
  const encodedSignature = base64urlEncode(signature);
  return `${signingInput}.${encodedSignature}`;
}

export function verifyTradeSession(token: string): TradeSessionPayload {
  const secret = process.env.SHIELD_JWT_SECRET;
  if (!secret) throw new Error("SHIELD_JWT_SECRET not configured.");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed JWT.");
  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const expectedSig = base64urlEncode(
    crypto.createHmac("sha256", secret).update(signingInput).digest()
  );
  // Constant-time comparison
  if (
    expectedSig.length !== encodedSignature.length ||
    !crypto.timingSafeEqual(Buffer.from(expectedSig), Buffer.from(encodedSignature))
  ) {
    throw new Error("Invalid JWT signature.");
  }
  const payload = JSON.parse(base64urlDecode(encodedPayload).toString("utf8")) as TradeSessionPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw new Error("JWT expired.");
  }
  return payload;
}

export async function requireTradeSession(req: NextRequest): Promise<TradeSessionPayload> {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    throw new Error("Missing installer session token.");
  }
  const token = header.slice(7);
  const payload = verifyTradeSession(token);

  // Check organization is still active
  const orgSnap = await admin
    .firestore()
    .collection(COLLECTIONS.CONTACT_ORGANIZATIONS)
    .doc(payload.organizationId)
    .get();
  if (!orgSnap.exists) {
    throw new Error("Organization not found.");
  }
  const org = orgSnap.data()!;
  if (org.tradeAccount?.isActive === false) {
    throw new Error("Trade account suspended.");
  }
  if (!org.isApeaxTradeInstaller) {
    throw new Error("Not an APEAX trade installer.");
  }
  return payload;
}

// ─── Pricing ────────────────────────────────────────────────────────────────

export interface ApeaxPricingInput {
  unitCostUsd: number;
  quantity: number;
  freightMethod: "air" | "sea";
  tradeDiscountBand: "A" | "B" | "C";
}

const USD_TO_AUD = 1.62;
const FREIGHT_MARKUP = { air: 0.32, sea: 0.17 } as const;
const GST_RATE = 0.10;
const TRADE_DISCOUNTS: Record<"A" | "B" | "C", number> = {
  A: 0.20, // 20% discount
  B: 0.12,
  C: 0.06,
};

export function calculateApeaxPricing(input: ApeaxPricingInput) {
  const { unitCostUsd, quantity, freightMethod, tradeDiscountBand } = input;
  const baseAud = unitCostUsd * USD_TO_AUD;
  const withFreight = baseAud * (1 + FREIGHT_MARKUP[freightMethod]);
  const withGst = withFreight * (1 + GST_RATE);
  const discount = TRADE_DISCOUNTS[tradeDiscountBand];
  const unitPriceAud = withGst * (1 - discount);
  const lineTotalAud = unitPriceAud * quantity;
  return {
    unitCostUsd,
    usdToAud: USD_TO_AUD,
    baseAud,
    freightMarkup: FREIGHT_MARKUP[freightMethod],
    withFreight,
    gstRate: GST_RATE,
    withGst,
    tradeDiscountBand,
    discountRate: discount,
    unitPriceAud: Math.round(unitPriceAud * 100) / 100,
    quantity,
    lineTotalAud: Math.round(lineTotalAud * 100) / 100,
  };
}
