/**
 * GET /api/apeax/trade-dashboard
 * Authenticated installer endpoint. Returns the installer's profile, order
 * history, and a filtered view of current APEAX stock + pricing based on
 * their trade discount band.
 *
 * Auth: JWT session (Bearer) issued by /api/apeax/trade-login.
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireTradeSession, calculateApeaxPricing } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const session = await requireTradeSession(req);
    const db = admin.firestore();

    // Load organization
    const orgSnap = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).doc(session.organizationId).get();
    if (!orgSnap.exists) throw new Error("Organization not found.");
    const org = orgSnap.data()!;

    // Load recent order history for this installer
    const ordersSnap = await db.collection(COLLECTIONS.APEAX_ORDERS)
      .where("organizationId", "==", session.organizationId)
      .orderBy("createdAt", "desc")
      .limit(50)
      .get();

    const orders = ordersSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        orderNumber: data.orderNumber || null,
        status: data.status || "pending_validation",
        totalAud: data.totalAud || 0,
        lineCount: (data.lines as unknown[] | undefined)?.length || 0,
        createdAt: typeof data.createdAt === "object" && data.createdAt?.toDate
          ? data.createdAt.toDate().toISOString()
          : null,
      };
    });

    // Load current APEAX stock + compute installer-specific pricing
    const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS)
      .where("supplier", "==", "APEAX")
      .limit(200)
      .get();

    const stock = stockSnap.docs.map((d) => {
      const data = d.data();
      const unitCostUsd = Number(data.unitCostUsd || 0);
      const pricing = unitCostUsd > 0
        ? calculateApeaxPricing({
            unitCostUsd,
            quantity: 1,
            freightMethod: "sea",
            tradeDiscountBand: session.tradeDiscountBand,
          })
        : null;
      return {
        id: d.id,
        sku: data.sku,
        name: data.name,
        description: data.description,
        available: Number(data.quantityOnHand || 0) > 0,
        quantityOnHand: data.quantityOnHand || 0,
        unitPriceAud: pricing?.unitPriceAud || null,
      };
    });

    return NextResponse.json({
      ok: true,
      installer: {
        organizationId: session.organizationId,
        organizationName: session.organizationName,
        contactEmail: session.contactEmail,
        tradeDiscountBand: session.tradeDiscountBand,
        paymentTerms: org.tradeAccount?.paymentTerms || "Net 14",
        creditLimit: org.tradeAccount?.creditLimit || 0,
      },
      orders,
      stock,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load dashboard.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
