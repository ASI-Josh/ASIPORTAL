"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  StockItem,
  ContactOrganization,
  GoodsReceivedInspection,
  PurchaseOrder,
} from "@/lib/types";

import { ProcurementOverview } from "./overview";
import { StockRegisterTab } from "./stock-register";
import { PurchaseOrdersTab } from "./purchase-orders";
import { GoodsReceivedTab } from "./goods-received";
import { ReorderAutomationTab } from "./reorder-automation";
import { ComplianceTab } from "./compliance";

export default function ProcurementPage() {
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [inspections, setInspections] = useState<GoodsReceivedInspection[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<ContactOrganization[]>([]);

  // Live subscriptions
  useEffect(() => {
    const stockQ = query(
      collection(db, COLLECTIONS.STOCK_ITEMS),
      orderBy("supplierName", "asc"),
      orderBy("description", "asc")
    );
    return onSnapshot(stockQ, (snap) => {
      setStockItems(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockItem, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    const inspQ = query(
      collection(db, COLLECTIONS.GOODS_RECEIVED),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(inspQ, (snap) => {
      setInspections(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GoodsReceivedInspection, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    const poQ = query(
      collection(db, COLLECTIONS.PURCHASE_ORDERS),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(poQ, (snap) => {
      setPurchaseOrders(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    const suppQ = query(
      collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS),
      where("category", "==", "supplier_vendor")
    );
    return onSnapshot(suppQ, (snap) => {
      setSuppliers(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ContactOrganization, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Procurement &amp; Stock Control
        </h2>
        <p className="text-muted-foreground">
          Full procurement lifecycle — stock management, purchase orders, goods received, and automated reordering.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="stock">Stock Register</TabsTrigger>
          <TabsTrigger value="purchase-orders">Purchase Orders</TabsTrigger>
          <TabsTrigger value="goods-received">Goods Received</TabsTrigger>
          <TabsTrigger value="reorder">Reorder Automation</TabsTrigger>
          <TabsTrigger value="compliance">IMS / Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <ProcurementOverview
            stockItems={stockItems}
            purchaseOrders={purchaseOrders}
            inspections={inspections}
            suppliers={suppliers}
          />
        </TabsContent>

        <TabsContent value="stock">
          <StockRegisterTab stockItems={stockItems} />
        </TabsContent>

        <TabsContent value="purchase-orders">
          <PurchaseOrdersTab
            purchaseOrders={purchaseOrders}
            suppliers={suppliers}
            stockItems={stockItems}
          />
        </TabsContent>

        <TabsContent value="goods-received">
          <GoodsReceivedTab
            inspections={inspections}
            suppliers={suppliers}
          />
        </TabsContent>

        <TabsContent value="reorder">
          <ReorderAutomationTab stockItems={stockItems} />
        </TabsContent>

        <TabsContent value="compliance">
          <ComplianceTab stockItems={stockItems} inspections={inspections} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
