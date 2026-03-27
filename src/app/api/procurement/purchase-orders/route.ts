import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import {
  xeroCreatePurchaseOrder,
  xeroSendPurchaseOrder,
  xeroGetPurchaseOrder,
} from "@/lib/xero";

async function verifyAuth(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.split("Bearer ")[1];
  return admin.auth().verifyIdToken(token);
}

// GET — list portal PO records (optionally fetch live Xero data)
export async function GET(req: NextRequest) {
  try {
    await verifyAuth(req);
    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit")) || 50, 200);
    const status = searchParams.get("status");
    const xeroId = searchParams.get("xeroId");

    // Single PO lookup by Xero ID
    if (xeroId) {
      try {
        const xeroData = await xeroGetPurchaseOrder(xeroId);
        return NextResponse.json({ ok: true, purchaseOrder: xeroData });
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: err instanceof Error ? err.message : "Failed to fetch PO" },
          { status: 500 }
        );
      }
    }

    // List from portal collection
    let q: FirebaseFirestore.Query = admin
      .firestore()
      .collection(COLLECTIONS.PURCHASE_ORDERS)
      .orderBy("createdAt", "desc")
      .limit(limit);

    if (status) {
      q = admin
        .firestore()
        .collection(COLLECTIONS.PURCHASE_ORDERS)
        .where("status", "==", status)
        .orderBy("createdAt", "desc")
        .limit(limit);
    }

    const snap = await q.get();
    const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ ok: true, purchaseOrders: docs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// POST — create a new PO (draft in Xero + record in portal)
export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyAuth(req);
    const body = await req.json();
    const { supplierName, reference, deliveryDate, lineItems, supplierId } = body;

    if (!supplierName || !lineItems?.length) {
      return NextResponse.json(
        { ok: false, error: "supplierName and lineItems are required" },
        { status: 400 }
      );
    }

    // Create draft PO in Xero
    const xeroResult = await xeroCreatePurchaseOrder({
      contactName: supplierName,
      reference: reference || "",
      deliveryDate: deliveryDate || undefined,
      lineItems: lineItems.map((li: Record<string, unknown>) => ({
        itemCode: li.itemCode || undefined,
        description: String(li.description || ""),
        quantity: Number(li.quantity) || 1,
        unitAmount: Number(li.unitAmount) || 0,
        accountCode: String(li.accountCode || "300"),
      })),
    });

    // Store in portal collection
    const now = admin.firestore.FieldValue.serverTimestamp();
    const portalDoc = {
      xeroPurchaseOrderId: xeroResult.purchaseOrderId,
      purchaseOrderNumber: xeroResult.purchaseOrderNumber,
      supplierName,
      supplierId: supplierId || "",
      reference: reference || "",
      status: xeroResult.status,
      deliveryDate: deliveryDate || "",
      lineItems,
      isAutoReorder: false,
      createdAt: now,
      updatedAt: now,
      createdBy: decoded.uid,
    };

    const ref = await admin.firestore().collection(COLLECTIONS.PURCHASE_ORDERS).add(portalDoc);

    return NextResponse.json({
      ok: true,
      id: ref.id,
      purchaseOrderId: xeroResult.purchaseOrderId,
      purchaseOrderNumber: xeroResult.purchaseOrderNumber,
      status: xeroResult.status,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// PUT — send/approve a PO in Xero
export async function PUT(req: NextRequest) {
  try {
    await verifyAuth(req);
    const body = await req.json();
    const { action, portalId, xeroPurchaseOrderId } = body;

    if (action === "send" && xeroPurchaseOrderId) {
      const result = await xeroSendPurchaseOrder(xeroPurchaseOrderId);

      // Update portal record
      if (portalId) {
        const now = admin.firestore.FieldValue.serverTimestamp();
        await admin.firestore().collection(COLLECTIONS.PURCHASE_ORDERS).doc(portalId).update({
          status: "AUTHORISED",
          sentAt: now,
          updatedAt: now,
        });
      }

      return NextResponse.json({ ok: true, sent: result.sent });
    }

    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
