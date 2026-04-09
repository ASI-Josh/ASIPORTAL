/**
 * POST /api/apeax/order/:id/validate
 * SHIELD-only. Marks an order as SHIELD-validated, checks stock per line item,
 * flags stock shortfalls, and sets poRequired=true if any shortfall exists.
 *
 * Downstream: the caller triggers Xero PO creation via xero_create_purchase_order
 * using the returned stockShortfall payload.
 *
 * Auth: SHIELD_API_KEY via x-shield-api-key header.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireShieldServiceAuth } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ValidatePayload {
  validatedBy?: string;
  notes?: string;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    requireShieldServiceAuth(req);
    const { id } = await params;
    if (!id) throw new Error("Missing order id.");

    const body = (await req.json().catch(() => ({}))) as ValidatePayload;
    const validatedBy = body.validatedBy || "shield-agent";
    const notes = body.notes || null;

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    const orderRef = db.collection(COLLECTIONS.APEAX_ORDERS).doc(id);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) throw new Error("APEAX order not found.");
    const order = orderSnap.data()!;
    if (order.status !== "pending_validation") {
      throw new Error(`Cannot validate: order status is '${order.status}', expected 'pending_validation'.`);
    }

    // Check stock for each line item
    const lines = (order.lines as Array<Record<string, unknown>>) || [];
    const stockShortfall: Array<{ sku: string; requested: number; available: number; shortfall: number }> = [];
    for (const line of lines) {
      const sku = String(line.sku || "");
      if (!sku) continue;
      const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS)
        .where("sku", "==", sku)
        .limit(1)
        .get();
      const available = stockSnap.empty ? 0 : Number(stockSnap.docs[0].data().quantityOnHand || 0);
      const requested = Number(line.quantity || 0);
      if (available < requested) {
        stockShortfall.push({ sku, requested, available, shortfall: requested - available });
      }
    }

    const poRequired = stockShortfall.length > 0;
    const newStatus = poRequired ? "validated_po_required" : "validated_stock_available";

    // Update order
    await orderRef.set({
      status: newStatus,
      shieldValidatedAt: nowIso,
      shieldValidatedBy: validatedBy,
      shieldNotes: notes,
      stockShortfall,
      poRequired,
      isoClauseTouchpoints: admin.firestore.FieldValue.arrayUnion("8.4.2", "8.4.3"), // Type/extent of control, info for external providers
      updatedAt: now,
    }, { merge: true });

    // Sync to linked job
    if (order.jobId) {
      await db.collection(COLLECTIONS.JOBS).doc(String(order.jobId)).set({
        status: "scheduled",
        statusLog: admin.firestore.FieldValue.arrayUnion({
          status: "scheduled",
          changedAt: nowIso,
          changedBy: validatedBy,
          note: poRequired
            ? `SHIELD validated. Stock shortfall on ${stockShortfall.length} line(s). PO to APEAX USA required.`
            : `SHIELD validated. Stock available — ready for allocation and dispatch.`,
        }),
        isoClauseTouchpoints: admin.firestore.FieldValue.arrayUnion("8.4.2", "8.4.3"),
        updatedAt: now,
      }, { merge: true });
    }

    return NextResponse.json({
      ok: true,
      orderId: id,
      validated: true,
      status: newStatus,
      poRequired,
      stockShortfall,
      validatedAt: nowIso,
      validatedBy,
      nextStep: poRequired
        ? "Call xero_create_purchase_order with stockShortfall line items to raise PO to APEAX USA."
        : "Allocate stock and dispatch. Call xero_create_invoice to bill the installer.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to validate order.";
    const status = message.includes("SHIELD") || message.includes("credentials") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
