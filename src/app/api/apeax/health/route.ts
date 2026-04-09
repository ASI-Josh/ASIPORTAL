/**
 * GET /api/apeax/health
 * Health check endpoint for the apeax.com.au Netlify Function uptime probe.
 *
 * Auth: SHIELD_API_KEY via x-shield-api-key header.
 *
 * Returns a minimal JSON payload confirming the portal backend is reachable
 * and Firestore admin SDK is initialised. Does not reveal any sensitive state.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireShieldServiceAuth } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    requireShieldServiceAuth(req);

    // Minimal Firestore liveness: read one doc from a known collection
    let firestoreOk = false;
    try {
      await admin.firestore().collection("_health").doc("ping").get();
      firestoreOk = true;
    } catch {
      firestoreOk = false;
    }

    return NextResponse.json({
      ok: true,
      service: "asi-portal-shield-backend",
      checkedAt: new Date().toISOString(),
      firestore: firestoreOk ? "reachable" : "degraded",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Health check failed.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
