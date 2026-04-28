import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireCuttingUser, cuttingErrorStatus } from "@/lib/server/cuttingAuth";
import type { CuttingJob, StockItem } from "@/lib/types";

// POST /api/cutting/jobs/[id]/complete
// Marks the cutting job QC pass and decrements stock atomically.
// Idempotent: if stockDecrementedAt already set, the decrement step
// is skipped and only the QC fields are updated.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireCuttingUser(req);

    // Clients are not allowed to mark QC pass — that's an operator/admin call.
    if (ctx.role === "client") {
      throw new Error("Not authorised to mark QC outcome.");
    }

    const result = await admin.firestore().runTransaction(async (tx) => {
      const cuttingRef = admin.firestore().collection(COLLECTIONS.CUTTING_JOBS).doc(id);
      const cuttingSnap = await tx.get(cuttingRef);
      if (!cuttingSnap.exists) throw new Error("Cutting job not found.");
      const job = cuttingSnap.data() as CuttingJob;

      const metres = Number(job.rollConsumedMetres ?? 0);
      let stockUpdate: { stockItemId?: string; before?: number; after?: number; reorderTriggered?: boolean } = {};

      const alreadyDecremented = !!job.stockDecrementedAt;
      if (!alreadyDecremented && job.filmStockItemId && metres > 0) {
        const stockRef = admin
          .firestore()
          .collection(COLLECTIONS.STOCK_ITEMS)
          .doc(job.filmStockItemId);
        const stockSnap = await tx.get(stockRef);
        if (!stockSnap.exists) throw new Error("Linked stock item not found.");
        const stock = stockSnap.data() as StockItem;
        const before = Number(stock.quantityOnHand ?? 0);
        const after = Math.max(0, before - metres);
        const threshold = Number(stock.reorderThreshold ?? 0);
        const reorderTriggered = before > threshold && after <= threshold && threshold > 0;

        tx.set(
          stockRef,
          {
            quantityOnHand: after,
            quantity: after,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          { merge: true },
        );
        stockUpdate = { stockItemId: job.filmStockItemId, before, after, reorderTriggered };
      }

      tx.set(
        cuttingRef,
        {
          qcStatus: "pass",
          qcCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
          qcCheckedBy: ctx.userId,
          ...(alreadyDecremented
            ? {}
            : metres > 0 && job.filmStockItemId
              ? {
                  stockDecrementedAt: admin.firestore.FieldValue.serverTimestamp(),
                  stockDecrementedAmount: metres,
                }
              : {}),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true },
      );

      return { stockUpdate, alreadyDecremented };
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: cuttingErrorStatus(msg) });
  }
}
