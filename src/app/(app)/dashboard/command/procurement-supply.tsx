"use client";

import Link from "next/link";
import { AlertTriangle, Boxes, RefreshCw, ShoppingCart, Truck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { StockItem, PurchaseOrder, GoodsReceivedInspection } from "@/lib/types";

interface Props {
  stockItems: StockItem[];
  purchaseOrders: PurchaseOrder[];
  goodsReceived: GoodsReceivedInspection[];
}

export function ProcurementSupply({ stockItems, purchaseOrders, goodsReceived }: Props) {
  const lowStock = stockItems.filter((item) => {
    const qty = item.quantityOnHand ?? 0;
    if (item.reorderThreshold && item.reorderThreshold > 0) return qty <= item.reorderThreshold;
    return item.itemType !== "plant" && qty <= 3;
  });

  const draftPOs = purchaseOrders.filter((po) => po.status === "DRAFT");
  const sentPOs = purchaseOrders.filter((po) => po.status === "AUTHORISED" || po.status === "SUBMITTED");
  const autoReorders = purchaseOrders.filter((po) => po.isAutoReorder);
  const openInspections = goodsReceived.filter((g) => g.status !== "closed");

  const totalStockValue = stockItems.reduce((sum, item) => {
    return sum + (item.costPrice ?? 0) * (item.quantityOnHand ?? 0);
  }, 0);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 h-full overflow-hidden">
      <div className="px-6 py-3 bg-gradient-to-r from-blue-500/10 via-blue-500/5 to-transparent border-b border-blue-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-4 w-4 text-blue-400" />
            <span className="font-headline font-semibold text-sm text-blue-400">
              Procurement &amp; Supply Chain
            </span>
          </div>
          <Link href="/dashboard/procurement">
            <Button variant="ghost" size="sm" className="text-xs">
              Open Module
            </Button>
          </Link>
        </div>
      </div>
      <CardContent className="space-y-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Boxes className="h-3 w-3" /> Stock Items
            </div>
            <div className="text-lg font-bold">{stockItems.length}</div>
            {totalStockValue > 0 && (
              <div className="text-xs text-muted-foreground">
                ${totalStockValue.toLocaleString("en-AU", { minimumFractionDigits: 0 })} value
              </div>
            )}
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="flex items-center gap-2 text-xs text-amber-400 mb-1">
              <AlertTriangle className="h-3 w-3" /> Low Stock
            </div>
            <div className="text-lg font-bold text-amber-400">{lowStock.length}</div>
            <div className="text-xs text-muted-foreground">below threshold</div>
          </div>
        </div>

        {/* PO Status */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Purchase Orders</p>
          <div className="flex items-center justify-between text-sm">
            <span>Draft (review needed)</span>
            <Badge className={draftPOs.length > 0 ? "bg-amber-500/20 text-amber-400" : "bg-muted text-muted-foreground"}>
              {draftPOs.length}
            </Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span>Sent / Awaiting delivery</span>
            <Badge className="bg-blue-500/20 text-blue-400">{sentPOs.length}</Badge>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1">
              <RefreshCw className="h-3 w-3 text-blue-400" /> Auto-reorders
            </span>
            <span className="text-sm font-medium">{autoReorders.length}</span>
          </div>
        </div>

        {/* Goods Received */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Goods Received</p>
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1">
              <Truck className="h-3 w-3 text-emerald-400" /> Open inspections
            </span>
            <Badge className="bg-emerald-500/20 text-emerald-400">{openInspections.length}</Badge>
          </div>
        </div>

        {/* Low stock items */}
        {lowStock.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">Alerts</p>
            {lowStock.slice(0, 3).map((item) => (
              <div key={item.id} className="text-xs flex justify-between">
                <span className="truncate">{item.description}</span>
                <span className="text-amber-400 font-medium ml-2 whitespace-nowrap">
                  {item.quantityOnHand} left
                </span>
              </div>
            ))}
            {lowStock.length > 3 && (
              <p className="text-xs text-muted-foreground">+{lowStock.length - 3} more</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
