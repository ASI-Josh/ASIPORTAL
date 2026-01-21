"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Boxes, AlertTriangle, PackageCheck } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { StockItem } from "@/lib/types";

export default function StockRegisterPage() {
  const [items, setItems] = useState<StockItem[]>([]);

  useEffect(() => {
    const itemsQuery = query(
      collection(db, COLLECTIONS.STOCK_ITEMS),
      orderBy("supplierName", "asc"),
      orderBy("description", "asc")
    );
    const unsubscribe = onSnapshot(
      itemsQuery,
      (snapshot) => {
        setItems(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<StockItem, "id">),
          }))
        );
      },
      () => setItems([])
    );
    return () => unsubscribe();
  }, []);

  const lowStock = useMemo(
    () =>
      items.filter(
        (item) =>
          item.itemType !== "plant" && (item.quantityOnHand ?? 0) <= 3
      ),
    [items]
  );

  const suppliers = useMemo(() => {
    const grouped = new Map<string, StockItem[]>();
    items.forEach((item) => {
      const key = item.supplierName || "Unknown supplier";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Stock & Consumables Register
        </h2>
        <p className="text-muted-foreground">
          Live inventory overview by supplier and product.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <Boxes className="h-4 w-4 text-primary" />
              Items tracked
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{items.length}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Low stock alerts
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{lowStock.length}</div>
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
          </CardContent>
        </Card>
      </div>

      {suppliers.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            No stock items logged yet. Add goods received inspections to populate the register.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {suppliers.map(([supplierName, supplierItems]) => (
            <Card key={supplierName} className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardHeader>
                <CardTitle className="text-base">{supplierName}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {supplierItems.map((item) => {
                  const isLow = item.itemType !== "plant" && item.quantityOnHand <= 3;
                  return (
                    <div
                      key={item.id}
                      className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <div className="font-medium">{item.description}</div>
                        <div className="text-xs text-muted-foreground">
                          {item.internalStockNumber}
                          {item.supplierPartNumber ? ` • ${item.supplierPartNumber}` : ""}
                          {item.category ? ` • ${item.category}` : ""}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 text-sm">
                        <Badge variant="secondary">{item.itemType}</Badge>
                        <span className={isLow ? "text-amber-400 font-semibold" : ""}>
                          {item.quantityOnHand} {item.unit || ""}
                        </span>
                        {isLow ? (
                          <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/40">
                            Low stock
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
