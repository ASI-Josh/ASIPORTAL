/**
 * POST /api/leads/migrate-segment
 * Admin-only. One-time migration: backfill marketSegment = "heavy_vehicle"
 * on any existing sales-stream leads that don't have one.
 *
 * Rationale: when MERCER joined in April 2026, the sales stream was sub-
 * divided between SENTINEL (heavy vehicle / fleet / bus & coach) and MERCER
 * (passenger vehicle / trade). All pre-MERCER sales leads were SENTINEL's
 * (HV/Coach market per Josh's handover), so they all default to
 * marketSegment: "heavy_vehicle".
 *
 * Safe to run multiple times — skips leads that already have a marketSegment.
 */
import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";

export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId(req);
    const db = admin.firestore();
    const userSnap = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    const user = userSnap.data() as { role?: string } | undefined;
    if (user?.role !== "admin") {
      return NextResponse.json({ error: "Admin only." }, { status: 403 });
    }

    const snap = await db.collection(COLLECTIONS.LEADS).get();
    let updated = 0;
    let skipped = 0;
    const batch = db.batch();
    let batchCount = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const streamType = String(data.streamType || "sales");
      if (streamType !== "sales") { skipped++; continue; }
      if (typeof data.marketSegment === "string") { skipped++; continue; }

      batch.update(doc.ref, {
        marketSegment: "heavy_vehicle",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      updated++;
      batchCount++;

      // Firestore batches cap at 500 writes
      if (batchCount >= 400) {
        await batch.commit();
        batchCount = 0;
      }
    }

    if (batchCount > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      updated,
      skipped,
      message: `Backfilled marketSegment='heavy_vehicle' (SENTINEL) on ${updated} existing sales leads.`,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Migration failed." },
      { status: 400 }
    );
  }
}
