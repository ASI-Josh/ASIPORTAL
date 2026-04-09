/**
 * GET /api/apeax/shield-queue
 * SHIELD-only. Returns the full operational queue:
 *  - Pending quote requests
 *  - Trade applications awaiting vetting
 *  - Orders awaiting SHIELD validation
 *
 * Auth: SHIELD_API_KEY via x-shield-api-key header.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireShieldServiceAuth } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function serializeDoc(id: string, data: FirebaseFirestore.DocumentData) {
  const out: Record<string, unknown> = { id };
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === "object" && "toDate" in v && typeof v.toDate === "function") {
      out[k] = v.toDate().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    requireShieldServiceAuth(req);
    const url = new URL(req.url);
    const queueType = url.searchParams.get("type") || "all";
    const db = admin.firestore();
    const result: Record<string, unknown> = {};

    if (queueType === "quotes" || queueType === "all") {
      const snap = await db.collection(COLLECTIONS.LEADS_REGISTER)
        .where("source.type", "==", "apeax_portal_quote")
        .where("status", "in", ["identified", "assessed"])
        .limit(100)
        .get();
      result.quotes = snap.docs.map((d) => serializeDoc(d.id, d.data()));
    }

    if (queueType === "applications" || queueType === "all") {
      const snap = await db.collection(COLLECTIONS.LEADS_REGISTER)
        .where("source.type", "==", "apeax_portal_trade_app")
        .where("status", "in", ["identified", "assessed"])
        .limit(100)
        .get();
      result.applications = snap.docs.map((d) => serializeDoc(d.id, d.data()));
    }

    if (queueType === "orders" || queueType === "all") {
      const snap = await db.collection(COLLECTIONS.APEAX_ORDERS)
        .where("status", "==", "pending_validation")
        .limit(100)
        .get();
      result.orders = snap.docs.map((d) => serializeDoc(d.id, d.data()));
    }

    // Queue summary counts
    const summary = {
      quotes: ((result.quotes as unknown[]) || []).length,
      applications: ((result.applications as unknown[]) || []).length,
      orders: ((result.orders as unknown[]) || []).length,
    };

    return NextResponse.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      summary,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load SHIELD queue.";
    const status = message.includes("SHIELD") || message.includes("credentials") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
