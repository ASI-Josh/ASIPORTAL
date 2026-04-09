/**
 * POST /api/apeax/trade-login
 * Public endpoint — validates installer credentials and issues a JWT session.
 *
 * Credentials are stored on the ContactOrganization.installerAuth field
 * (passwordHash/passwordSalt). Sessions TTL 7 days.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { signTradeSession } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface LoginPayload {
  email?: string;
  password?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as LoginPayload;
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!email || !password) throw new Error("Email and password are required.");

    const db = admin.firestore();

    // Find organization with matching installerAuth email
    const snap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS)
      .where("installerAuth.email", "==", email)
      .where("isApeaxTradeInstaller", "==", true)
      .limit(1)
      .get();

    if (snap.empty) {
      // Generic error to avoid user enumeration
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    const orgDoc = snap.docs[0];
    const org = orgDoc.data();
    const auth = org.installerAuth as {
      passwordHash?: string;
      passwordSalt?: string;
      mustChangePassword?: boolean;
      contactName?: string;
    } | undefined;

    if (!auth?.passwordHash || !auth?.passwordSalt) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }
    if (org.tradeAccount?.isActive === false) {
      return NextResponse.json({ error: "Account suspended. Contact ASI Australia." }, { status: 403 });
    }

    const computedHash = crypto
      .createHmac("sha256", auth.passwordSalt)
      .update(password)
      .digest("hex");

    const providedBuf = Buffer.from(computedHash);
    const storedBuf = Buffer.from(auth.passwordHash);
    if (
      providedBuf.length !== storedBuf.length ||
      !crypto.timingSafeEqual(providedBuf, storedBuf)
    ) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }

    // Update last login
    await orgDoc.ref.set({
      installerAuth: {
        ...auth,
        lastLoginAt: new Date().toISOString(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    // Sign JWT
    const token = signTradeSession({
      organizationId: orgDoc.id,
      organizationName: String(org.name || ""),
      contactEmail: email,
      tradeDiscountBand: (org.tradeAccount?.tradeDiscountBand as "A" | "B" | "C") || "C",
    });

    // Compute JWT expiry (matches shieldAuth.ts TRADE_SESSION_TTL_SECONDS = 7 days)
    const expiresAt = new Date(Date.now() + 7 * 86400 * 1000).toISOString();

    return NextResponse.json({
      ok: true,
      token,
      expiresAt,
      expiresInDays: 7,
      // CIPHER's trade-login.js reads tradeAccount.{id,legalName,tradingAs,discountTier}
      tradeAccount: {
        id: orgDoc.id,
        legalName: org.name,
        tradingAs: org.tradeAccount?.tradingAs || null,
        discountTier: org.tradeAccount?.tradeDiscountBand || "C",
        contactName: auth.contactName,
        mustChangePassword: auth.mustChangePassword || false,
      },
      // Back-compat for portal-internal callers
      installer: {
        organizationId: orgDoc.id,
        organizationName: org.name,
        contactName: auth.contactName,
        tradeDiscountBand: org.tradeAccount?.tradeDiscountBand || "C",
        mustChangePassword: auth.mustChangePassword || false,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
