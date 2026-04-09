/**
 * POST /api/apeax/trade-order
 * Authenticated installer endpoint — creates an APEAX_DISTRIBUTION_ORDER.
 *
 * Creates:
 *  - An apeaxOrders record with pricing breakdown
 *  - A linked job with division: "distribution", jobType: "APEAX_DISTRIBUTION_ORDER",
 *    status: "pending", isoClauseTouchpoints seeded with quote/order clauses
 *
 * SHIELD validates the order separately via /api/apeax/order/[id]/validate.
 *
 * Auth: JWT session (Bearer) issued by /api/apeax/trade-login.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireTradeSession, calculateApeaxPricing } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface OrderLinePayload {
  sku: string;
  quantity: number;
  freightMethod?: "air" | "sea";
  notes?: string | null;
}

interface TradeOrderPayload {
  // Portal-internal shape
  lines?: OrderLinePayload[];
  // CIPHER's apeax.com.au shape
  lineItems?: OrderLinePayload[];
  freightPreference?: "air" | "sea";
  purchaseOrderRef?: string;
  submittedAt?: string;
  // Common
  deliveryMethod?: "pickup" | "courier";
  deliveryAddress?: string;
  deliveryInstructions?: string;
  notes?: string;
}

async function nextApeaxOrderNumber(db: FirebaseFirestore.Firestore): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc("apeaxOrders");
  let num = 1;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const data = snap.data() as { seq?: number; year?: number } | undefined;
    if (!snap.exists || data?.year !== year) {
      tx.set(counterRef, { seq: 1, year });
      num = 1;
    } else {
      num = (data?.seq || 0) + 1;
      tx.update(counterRef, { seq: num });
    }
  });
  return `APX-${year}-${String(num).padStart(4, "0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireTradeSession(req);
    const body = (await req.json().catch(() => ({}))) as TradeOrderPayload;

    // Accept both `lines` (portal-internal) and `lineItems` (CIPHER/apeax.com.au)
    const incomingLines = body.lineItems || body.lines || [];
    if (!Array.isArray(incomingLines) || incomingLines.length === 0) {
      throw new Error("At least one line item is required.");
    }
    // Default freight for all lines if not set per-line
    const defaultFreight: "air" | "sea" = body.freightPreference === "air" ? "air" : "sea";

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const nowIso = new Date().toISOString();

    // Resolve each line: fetch SKU, calculate price, check availability
    const resolvedLines: Array<Record<string, unknown>> = [];
    let totalAud = 0;
    for (const line of incomingLines) {
      const sku = String(line.sku || "").trim();
      const quantity = Number(line.quantity || 0);
      if (!sku || quantity <= 0) {
        throw new Error(`Invalid line: sku and positive quantity required.`);
      }
      const freightMethod: "air" | "sea" = line.freightMethod === "air"
        ? "air"
        : line.freightMethod === "sea"
          ? "sea"
          : defaultFreight;

      const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS)
        .where("sku", "==", sku)
        .limit(1)
        .get();
      if (stockSnap.empty) {
        throw new Error(`SKU not found: ${sku}`);
      }
      const stockData = stockSnap.docs[0].data();
      const unitCostUsd = Number(stockData.unitCostUsd || 0);
      if (unitCostUsd <= 0) {
        throw new Error(`SKU ${sku} has no USD cost price configured.`);
      }

      const pricing = calculateApeaxPricing({
        unitCostUsd,
        quantity,
        freightMethod,
        tradeDiscountBand: session.tradeDiscountBand,
      });

      const quantityOnHand = Number(stockData.quantityOnHand || 0);
      const stockAvailable = quantityOnHand >= quantity;

      resolvedLines.push({
        sku,
        name: stockData.name || sku,
        quantity,
        freightMethod,
        unitCostUsd,
        unitPriceAud: pricing.unitPriceAud,
        lineTotalAud: pricing.lineTotalAud,
        stockAvailable,
        quantityOnHand,
        pricingBreakdown: pricing,
      });
      totalAud += pricing.lineTotalAud;
    }

    totalAud = Math.round(totalAud * 100) / 100;
    const orderNumber = await nextApeaxOrderNumber(db);

    // Create the order
    const orderRef = await db.collection(COLLECTIONS.APEAX_ORDERS).add({
      orderNumber,
      organizationId: session.organizationId,
      organizationName: session.organizationName,
      contactEmail: session.contactEmail,
      tradeDiscountBand: session.tradeDiscountBand,
      status: "pending_validation",
      lines: resolvedLines,
      totalAud,
      currency: "AUD",
      deliveryMethod: body.deliveryMethod || "courier",
      deliveryAddress: body.deliveryAddress || null,
      notes: body.notes || null,
      poRequired: null, // determined during SHIELD validation
      shieldValidatedAt: null,
      shieldValidatedBy: null,
      isoClauseTouchpoints: ["8.2.1", "8.2.2", "8.4.1"], // Customer comms, Determining reqs, Controls for externally-provided
      sourceSystem: "apeax_portal",
      createdBy: "apeax_portal_installer",
      createdAt: now,
      updatedAt: now,
    });

    // Create a linked job (division: distribution)
    const jobNumber = orderNumber.replace("APX", "JOB-APX");
    const jobRef = await db.collection(COLLECTIONS.JOBS).add({
      jobNumber,
      jobDescription: `APEAX Distribution Order ${orderNumber} — ${resolvedLines.length} line item(s)`,
      division: "distribution",
      jobType: "APEAX_DISTRIBUTION_ORDER",
      isoClauseTouchpoints: ["8.2.1", "8.2.2", "8.4.1"],
      sourceSystem: "apeax_portal",
      clientId: session.organizationId,
      clientName: session.organizationName,
      clientEmail: session.contactEmail,
      organizationId: session.organizationId,
      vehicles: [],
      jobVehicles: [],
      damage: [],
      status: "pending",
      assignedTechnicians: [],
      statusLog: [{
        status: "pending",
        changedAt: nowIso,
        changedBy: "apeax_portal_installer",
        note: `Order submitted via apeax.com.au. Awaiting SHIELD validation.`,
      }],
      totalJobCost: totalAud,
      apeaxOrderId: orderRef.id,
      createdAt: now,
      createdBy: "apeax_portal_installer",
      updatedAt: now,
      notes: `APEAX Order ${orderNumber}. Total: A$${totalAud.toFixed(2)}.${body.notes ? "\n\nInstaller notes: " + body.notes : ""}`,
      isDeleted: false,
    });

    // Back-link job to order
    await orderRef.set({ jobId: jobRef.id }, { merge: true });

    return NextResponse.json({
      ok: true,
      orderId: orderRef.id,
      orderNumber,
      orderRef: orderNumber, // CIPHER's trade-order.js reads result.orderRef
      jobId: jobRef.id,
      linkedJobId: jobRef.id, // CIPHER's trade-order.js reads result.linkedJobId
      jobNumber,
      totalAud,
      estimatedPricingAud: {
        totalAud,
        lineCount: resolvedLines.length,
        lines: resolvedLines.map((line) => ({
          sku: line.sku,
          name: line.name,
          quantity: line.quantity,
          unitPriceAud: line.unitPriceAud,
          lineTotalAud: line.lineTotalAud,
          stockAvailable: line.stockAvailable,
        })),
      },
      lineCount: resolvedLines.length,
      status: "pending_validation",
      message: "Order received. SHIELD will validate and confirm within 1 business day.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create order.";
    const status = message.includes("session") || message.includes("token") ? 401 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
