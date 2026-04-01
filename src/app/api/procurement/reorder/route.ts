import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { COLLECTIONS } from "@/lib/collections";
import { xeroCreatePurchaseOrder } from "@/lib/xero";

async function verifyAuth(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new Error("Unauthorized");
  }
  const token = authHeader.split("Bearer ")[1];
  return admin.auth().verifyIdToken(token);
}

// POST — run reorder check (same logic as MCP check_and_draft_reorders)
export async function POST(req: NextRequest) {
  try {
    const decoded = await verifyAuth(req);
    const body = await req.json();
    const dryRun = body.dryRun === true;
    const leadDays = typeof body.deliveryLeadDays === "number" ? body.deliveryLeadDays : 7;
    const deliveryDate = new Date(Date.now() + leadDays * 86400_000).toISOString().split("T")[0];

    const db = admin.firestore();

    // Find all stock items below reorder threshold
    const stockSnap = await db.collection(COLLECTIONS.STOCK_ITEMS).limit(500).get();
    const belowThreshold = stockSnap.docs
      .map((d) => ({ id: d.id, ...d.data() } as Record<string, unknown>))
      .filter((item) => {
        const qty = typeof item.quantity === "number" ? item.quantity
          : typeof item.quantityOnHand === "number" ? item.quantityOnHand : 0;
        const threshold = typeof item.reorderThreshold === "number" ? item.reorderThreshold : 0;
        return threshold > 0 && qty <= threshold;
      });

    if (belowThreshold.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "All stock levels are above reorder thresholds.",
        itemsChecked: stockSnap.size,
        reorderNeeded: 0,
        purchaseOrders: [],
      });
    }

    // Group by supplier
    const bySupplier = new Map<string, Array<Record<string, unknown>>>();
    for (const item of belowThreshold) {
      const supplier = String(item.supplierName || item.supplier || "Unknown Supplier");
      const list = bySupplier.get(supplier) || [];
      list.push(item);
      bySupplier.set(supplier, list);
    }

    // Build PO line items
    const poPlans: Array<{
      supplier: string;
      lineItems: Array<{
        itemCode: string;
        description: string;
        quantity: number;
        unitAmount: number;
        currentStock: number;
        reorderThreshold: number;
        stockItemId: string;
      }>;
    }> = [];

    for (const [supplier, items] of bySupplier) {
      const lineItems = items.map((item) => {
        const currentQty = typeof item.quantity === "number" ? item.quantity
          : typeof item.quantityOnHand === "number" ? item.quantityOnHand : 0;
        const reorderQty = typeof item.reorderQuantity === "number" && item.reorderQuantity > 0
          ? item.reorderQuantity
          : (typeof item.reorderThreshold === "number" ? item.reorderThreshold * 2 : 10);
        const orderQty = Math.max(1, reorderQty - currentQty);

        return {
          itemCode: String(item.xeroItemCode || item.itemCode || ""),
          description: String(item.name || item.description || item.itemName || "Stock item"),
          quantity: orderQty,
          unitAmount: typeof item.costPrice === "number" ? item.costPrice
            : typeof item.unitCost === "number" ? item.unitCost : 0,
          currentStock: currentQty,
          reorderThreshold: typeof item.reorderThreshold === "number" ? item.reorderThreshold : 0,
          stockItemId: String(item.id || ""),
        };
      });
      poPlans.push({ supplier, lineItems });
    }

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        dryRun: true,
        itemsChecked: stockSnap.size,
        reorderNeeded: belowThreshold.length,
        supplierCount: poPlans.length,
        purchaseOrders: poPlans.map((po) => ({
          supplier: po.supplier,
          lineItems: po.lineItems,
          estimatedTotal: po.lineItems.reduce((sum, li) => sum + li.quantity * li.unitAmount, 0),
        })),
      });
    }

    // Create draft POs in Xero and save portal records
    const createdPOs: Array<{
      supplier: string;
      portalId: string;
      purchaseOrderId: string;
      purchaseOrderNumber: string;
      lineItemCount: number;
      total: number;
    }> = [];
    const poErrors: Array<{ supplier: string; error: string }> = [];
    const now = admin.firestore.FieldValue.serverTimestamp();

    for (const po of poPlans) {
      try {
        const result = await xeroCreatePurchaseOrder({
          contactName: po.supplier,
          reference: `AUTO-REORDER-${new Date().toISOString().split("T")[0]}`,
          deliveryDate,
          lineItems: po.lineItems.map((li) => ({
            itemCode: li.itemCode || undefined,
            description: li.description,
            quantity: li.quantity,
            unitAmount: li.unitAmount,
            accountCode: "300",
          })),
        });

        // Save to portal
        const portalDoc = {
          xeroPurchaseOrderId: result.purchaseOrderId,
          purchaseOrderNumber: result.purchaseOrderNumber,
          supplierName: po.supplier,
          reference: `AUTO-REORDER-${new Date().toISOString().split("T")[0]}`,
          status: result.status,
          deliveryDate,
          lineItems: po.lineItems,
          isAutoReorder: true,
          createdAt: now,
          updatedAt: now,
          createdBy: decoded.uid,
        };
        const ref = await db.collection(COLLECTIONS.PURCHASE_ORDERS).add(portalDoc);

        createdPOs.push({
          supplier: po.supplier,
          portalId: ref.id,
          purchaseOrderId: result.purchaseOrderId,
          purchaseOrderNumber: result.purchaseOrderNumber,
          lineItemCount: po.lineItems.length,
          total: po.lineItems.reduce((sum, li) => sum + li.quantity * li.unitAmount, 0),
        });
      } catch (err) {
        poErrors.push({
          supplier: po.supplier,
          error: err instanceof Error ? err.message : "PO creation failed",
        });
      }
    }

    // Send email notification if POs were created
    if (createdPOs.length > 0) {
      const poSummary = createdPOs
        .map((po) => `  • ${po.purchaseOrderNumber} — ${po.supplier} (${po.lineItemCount} items, $${po.total.toFixed(2)} ex-GST)`)
        .join("\n");
      const errorNote = poErrors.length > 0
        ? `\n\nErrors (${poErrors.length}):\n` + poErrors.map((e) => `  • ${e.supplier}: ${e.error}`).join("\n")
        : "";

      // DISABLED: External email notifications disabled — all notifications stay in-app only
      console.log(`[EMAIL DISABLED] Would have sent reorder notification for ${createdPOs.length} PO(s)`);
    }

    return NextResponse.json({
      ok: true,
      itemsChecked: stockSnap.size,
      reorderNeeded: belowThreshold.length,
      purchaseOrdersCreated: createdPOs.length,
      purchaseOrders: createdPOs,
      errors: poErrors.length > 0 ? poErrors : undefined,
      emailSent: createdPOs.length > 0,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Server error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
