import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";

async function verifyAuth(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.split("Bearer ")[1];
  return admin.auth().verifyIdToken(token);
}

// PUT — update a stock item (quantity, thresholds, Xero code, etc.)
export async function PUT(req: NextRequest) {
  try {
    await verifyAuth(req);
    const body = await req.json();
    const { id, updates } = body;

    if (!id) {
      return NextResponse.json({ ok: false, error: "Stock item ID required" }, { status: 400 });
    }

    const ref = admin.firestore().collection(COLLECTIONS.STOCK_ITEMS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ ok: false, error: "Stock item not found" }, { status: 404 });
    }

    const allowed = new Set([
      "quantityOnHand",
      "reorderThreshold",
      "reorderQuantity",
      "xeroItemCode",
      "costPrice",
      "supplierName",
      "supplierPartNumber",
      "category",
      "unit",
      "notes",
      "description",
    ]);

    const payload: Record<string, unknown> = {
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    for (const [k, v] of Object.entries(updates || {})) {
      if (allowed.has(k)) payload[k] = v;
    }

    // Sync MCP's "quantity" field with our "quantityOnHand" for compatibility
    if ("quantityOnHand" in payload) {
      payload.quantity = payload.quantityOnHand;
    }

    await ref.set(payload, { merge: true });
    const updated = await ref.get();
    return NextResponse.json({ ok: true, stockItem: { id: updated.id, ...updated.data() } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
