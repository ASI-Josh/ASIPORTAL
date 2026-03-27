"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  Boxes,
  FileText,
  PackageCheck,
  ShoppingCart,
  TrendingDown,
  Truck,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type {
  StockItem,
  PurchaseOrder,
  GoodsReceivedInspection,
  ContactOrganization,
} from "@/lib/types";

interface Props {
  stockItems: StockItem[];
  purchaseOrders: PurchaseOrder[];
  inspections: GoodsReceivedInspection[];
  suppliers: ContactOrganization[];
}

export function ProcurementOverview({ stockItems, purchaseOrders, inspections, suppliers }: Props) {
  const lowStock = useMemo(
    () =>
      stockItems.filter((item) => {
        const qty = item.quantityOnHand ?? 0;
        if (item.reorderThreshold && item.reorderThreshold > 0) return qty <= item.reorderThreshold;
        return item.itemType !== "plant" && qty <= 3;
      }),
    [stockItems]
  );

  const draftPOs = useMemo(
    () => purchaseOrders.filter((po) => po.status === "DRAFT"),
    [purchaseOrders]
  );

  const sentPOs = useMemo(
    () => purchaseOrders.filter((po) => po.status === "AUTHORISED" || po.status === "SUBMITTED"),
    [purchaseOrders]
  );

  const openInspections = useMemo(
    () => inspections.filter((i) => i.status !== "closed"),
    [inspections]
  );

  const autoReorderPOs = useMemo(
    () => purchaseOrders.filter((po) => po.isAutoReorder),
    [purchaseOrders]
  );

  const totalStockValue = useMemo(
    () =>
      stockItems.reduce((sum, item) => {
        const cost = item.costPrice ?? 0;
        const qty = item.quantityOnHand ?? 0;
        return sum + cost * qty;
      }, 0),
    [stockItems]
  );

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Boxes className="h-4 w-4 text-primary" />
              Stock Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stockItems.length}</div>
            <p className="text-xs text-muted-foreground">
              {totalStockValue > 0 ? `$${totalStockValue.toLocaleString("en-AU", { minimumFractionDigits: 2 })} est. value` : "across all suppliers"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Low Stock Alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-400">{lowStock.length}</div>
            <p className="text-xs text-muted-foreground">items below reorder threshold</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShoppingCart className="h-4 w-4 text-blue-400" />
              Draft POs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{draftPOs.length}</div>
            <p className="text-xs text-muted-foreground">
              {sentPOs.length} sent / awaiting delivery
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <PackageCheck className="h-4 w-4 text-emerald-400" />
              Suppliers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{suppliers.length}</div>
            <p className="text-xs text-muted-foreground">active supplier contacts</p>
          </CardContent>
        </Card>
      </div>

      {/* Low Stock Alerts */}
      {lowStock.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-amber-500/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-400">
              <TrendingDown className="h-5 w-5" />
              Items Below Reorder Threshold
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {lowStock.map((item) => {
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3"
                >
                  <div>
                    <div className="font-medium">{item.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {item.supplierName} &middot; {item.internalStockNumber}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-amber-400 font-semibold">
                      {item.quantityOnHand} {item.unit || ""}
                    </span>
                    {item.reorderThreshold && (
                      <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">
                        Threshold: {item.reorderThreshold}
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent POs */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileText className="h-4 w-4 text-primary" />
              Recent Purchase Orders
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {purchaseOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
            ) : (
              purchaseOrders.slice(0, 5).map((po) => (
                <div
                  key={po.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 p-3"
                >
                  <div>
                    <div className="font-medium text-sm">
                      {po.purchaseOrderNumber || "Pending"}
                    </div>
                    <div className="text-xs text-muted-foreground">{po.supplierName}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {po.isAutoReorder && (
                      <RefreshCw className="h-3 w-3 text-blue-400" />
                    )}
                    <Badge
                      className={
                        po.status === "DRAFT"
                          ? "bg-muted text-muted-foreground"
                          : po.status === "AUTHORISED"
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-blue-500/20 text-blue-400 border-blue-500/30"
                      }
                    >
                      {po.status}
                    </Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {/* Recent Goods Received */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Truck className="h-4 w-4 text-emerald-400" />
              Recent Goods Received
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {inspections.length === 0 ? (
              <p className="text-sm text-muted-foreground">No goods received records yet.</p>
            ) : (
              inspections.slice(0, 5).map((insp) => (
                <div
                  key={insp.id}
                  className="flex items-center justify-between rounded-lg border border-border/40 bg-background/60 p-3"
                >
                  <div>
                    <div className="font-medium text-sm">{insp.poNumber}</div>
                    <div className="text-xs text-muted-foreground">{insp.supplierName}</div>
                  </div>
                  <Badge
                    className={
                      insp.status === "closed"
                        ? "bg-green-500/20 text-green-400 border-green-500/30"
                        : insp.status === "submitted"
                        ? "bg-amber-500/20 text-amber-400 border-amber-500/30"
                        : "bg-muted text-muted-foreground"
                    }
                  >
                    {insp.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Auto Reorder Stats */}
      {autoReorderPOs.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <RefreshCw className="h-4 w-4 text-blue-400" />
              Auto-Reorder Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {autoReorderPOs.length} purchase order{autoReorderPOs.length !== 1 && "s"} created by
              LEDGER&apos;s automated reorder system.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
