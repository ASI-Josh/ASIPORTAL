/**
 * GET /api/apeax/stock
 * Returns current APEAX stock levels by SKU.
 *
 * Auth: dual mode —
 *   - SHIELD service account (x-shield-api-key) returns full detail (cost prices, full levels)
 *   - Trade installer JWT (Bearer) returns filtered view (availability + installer-specific pricing)
 */

import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { requireShieldServiceAuth, verifyTradeSession, calculateApeaxPricing } from "@/lib/server/shieldAuth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AuthContext =
  | { type: "shield" }
  | { type: "installer"; tradeDiscountBand: "A" | "B" | "C" }
  | { type: "none" };

function resolveAuth(req: NextRequest): AuthContext {
  // Try SHIELD first
  try {
    requireShieldServiceAuth(req);
    return { type: "shield" };
  } catch {
    // Try installer JWT
    const authHeader = req.headers.get("authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const payload = verifyTradeSession(authHeader.slice(7));
        return { type: "installer", tradeDiscountBand: payload.tradeDiscountBand };
      } catch {
        // fall through
      }
    }
  }
  return { type: "none" };
}

export async function GET(req: NextRequest) {
  try {
    const auth = resolveAuth(req);
    if (auth.type === "none") {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const url = new URL(req.url);
    const skuFilter = url.searchParams.get("sku");

    const db = admin.firestore();
    let q: admin.firestore.Query = db.collection(COLLECTIONS.STOCK_ITEMS);
    if (skuFilter) {
      q = q.where("sku", "==", skuFilter);
    } else {
      q = q.where("supplier", "==", "APEAX");
    }
    const snap = await q.limit(200).get();

    const items = snap.docs.map((d) => {
      const data = d.data();
      const unitCostUsd = Number(data.unitCostUsd || 0);

      const base = {
        id: d.id,
        sku: data.sku,
        name: data.name,
        description: data.description,
        category: data.category || null,
      };

      if (auth.type === "shield") {
        return {
          ...base,
          quantityOnHand: Number(data.quantityOnHand || 0),
          reorderPoint: Number(data.reorderPoint || 0),
          unitCostUsd,
          safetyStock: data.safetyStock || 0,
          wasteAllowance: data.wasteAllowance || null,
          lastUpdated: data.updatedAt,
        };
      }

      // Installer view — availability only + their pricing
      const quantityOnHand = Number(data.quantityOnHand || 0);
      const pricing = unitCostUsd > 0
        ? calculateApeaxPricing({
            unitCostUsd,
            quantity: 1,
            freightMethod: "sea",
            tradeDiscountBand: auth.tradeDiscountBand,
          })
        : null;

      return {
        ...base,
        available: quantityOnHand > 0,
        stockLevel: quantityOnHand > 50 ? "high" : quantityOnHand > 10 ? "medium" : quantityOnHand > 0 ? "low" : "out",
        unitPriceAud: pricing?.unitPriceAud || null,
      };
    });

    return NextResponse.json({
      ok: true,
      authContext: auth.type,
      totalSkus: items.length,
      items,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load stock.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
