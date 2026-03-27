import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { xeroListItems } from "@/lib/xero";

async function verifyAuth(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.split("Bearer ")[1];
  return admin.auth().verifyIdToken(token);
}

// GET — preview Xero items that can be imported
export async function GET(req: NextRequest) {
  try {
    await verifyAuth(req);

    // Fetch all Xero items (paginated up to 100)
    const result = await xeroListItems() as {
      Items?: Array<{
        ItemID: string;
        Code: string;
        Name: string;
        Description?: string;
        PurchaseDescription?: string;
        PurchaseDetails?: {
          UnitPrice?: number;
          AccountCode?: string;
          COGSAccountCode?: string;
        };
        SalesDetails?: {
          UnitPrice?: number;
        };
        IsTrackedAsInventory?: boolean;
        QuantityOnHand?: number;
        TotalCostPool?: number;
      }>;
    };

    const xeroItems = result.Items || [];

    // Check which ones already exist in portal stock
    const stockSnap = await admin.firestore().collection(COLLECTIONS.STOCK_ITEMS).get();
    const existingXeroCodes = new Set<string>();
    stockSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.xeroItemCode) existingXeroCodes.add(data.xeroItemCode);
    });

    const items = xeroItems.map((xi) => ({
      xeroItemId: xi.ItemID,
      code: xi.Code,
      name: xi.Name,
      description: xi.Description || xi.PurchaseDescription || xi.Name,
      costPrice: xi.PurchaseDetails?.UnitPrice ?? 0,
      salesPrice: xi.SalesDetails?.UnitPrice ?? 0,
      isTrackedInventory: xi.IsTrackedAsInventory ?? false,
      xeroQuantity: xi.QuantityOnHand ?? 0,
      alreadyImported: existingXeroCodes.has(xi.Code),
    }));

    return NextResponse.json({
      ok: true,
      totalXeroItems: xeroItems.length,
      alreadyImported: items.filter((i) => i.alreadyImported).length,
      available: items.filter((i) => !i.alreadyImported).length,
      items,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

// POST — import selected Xero items into portal stock register
export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyAuth(req);
    const body = await req.json();
    const { items, defaultSupplierName, defaultItemType } = body as {
      items: Array<{
        code: string;
        name: string;
        description: string;
        costPrice: number;
        xeroQuantity?: number;
      }>;
      defaultSupplierName?: string;
      defaultItemType?: string;
    };

    if (!items?.length) {
      return NextResponse.json({ ok: false, error: "No items to import" }, { status: 400 });
    }

    const db = admin.firestore();
    const now = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    let imported = 0;
    let skipped = 0;

    // Check existing
    const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS).get();
    const existingXeroCodes = new Set<string>();
    stockSnap.docs.forEach((d) => {
      const data = d.data();
      if (data.xeroItemCode) existingXeroCodes.add(data.xeroItemCode);
    });

    // Get next stock number
    let stockCounter = stockSnap.size;

    for (const item of items) {
      if (existingXeroCodes.has(item.code)) {
        skipped++;
        continue;
      }

      stockCounter++;
      const stockNumber = `STK-${String(stockCounter).padStart(4, "0")}`;
      const lookupKey = item.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

      const ref = db.collection(COLLECTIONS.STOCK_ITEMS).doc();
      batch.set(ref, {
        description: item.description || item.name,
        lookupKey,
        internalStockNumber: stockNumber,
        xeroItemCode: item.code,
        costPrice: item.costPrice || 0,
        quantityOnHand: item.xeroQuantity ?? 0,
        quantity: item.xeroQuantity ?? 0, // MCP compat field
        reorderThreshold: 0,
        reorderQuantity: 0,
        supplierName: defaultSupplierName || "Unknown Supplier",
        itemType: defaultItemType || "stock",
        unit: "each",
        notes: `Imported from Xero catalogue (${item.code})`,
        createdAt: now,
        updatedAt: now,
        createdBy: decoded.uid,
      });

      imported++;
    }

    if (imported > 0) {
      await batch.commit();
    }

    return NextResponse.json({
      ok: true,
      imported,
      skipped,
      message: `Imported ${imported} items, skipped ${skipped} (already exist).`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
