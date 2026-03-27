"use client";

import { useMemo, useState } from "react";
import {
  FileText,
  Plus,
  Send,
  Search,
  ShoppingCart,
  RefreshCw,
  Trash2,
  Eye,
} from "lucide-react";
import { Timestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { auth } from "@/lib/firebaseClient";
import type { PurchaseOrder, ContactOrganization, StockItem } from "@/lib/types";

interface Props {
  purchaseOrders: PurchaseOrder[];
  suppliers: ContactOrganization[];
  stockItems: StockItem[];
}

interface NewLineItem {
  description: string;
  quantity: number;
  unitAmount: number;
  itemCode: string;
  stockItemId: string;
}

export function PurchaseOrdersTab({ purchaseOrders, suppliers, stockItems }: Props) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [viewPO, setViewPO] = useState<PurchaseOrder | null>(null);

  const [newPO, setNewPO] = useState({
    supplierId: "",
    reference: "",
    deliveryDate: "",
    lineItems: [{ description: "", quantity: 1, unitAmount: 0, itemCode: "", stockItemId: "" }] as NewLineItem[],
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return purchaseOrders;
    return purchaseOrders.filter(
      (po) =>
        (po.purchaseOrderNumber || "").toLowerCase().includes(q) ||
        po.supplierName.toLowerCase().includes(q) ||
        (po.reference || "").toLowerCase().includes(q)
    );
  }, [purchaseOrders, searchQuery]);

  const formatDate = (value?: Timestamp | string) => {
    if (!value) return "-";
    if (typeof value === "string") return value;
    const date = value.toDate ? value.toDate() : new Date(value as unknown as string);
    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  const addLineItem = () => {
    setNewPO({
      ...newPO,
      lineItems: [...newPO.lineItems, { description: "", quantity: 1, unitAmount: 0, itemCode: "", stockItemId: "" }],
    });
  };

  const removeLineItem = (idx: number) => {
    setNewPO({
      ...newPO,
      lineItems: newPO.lineItems.filter((_, i) => i !== idx),
    });
  };

  const updateLineItem = (idx: number, field: keyof NewLineItem, value: string | number) => {
    const items = [...newPO.lineItems];
    items[idx] = { ...items[idx], [field]: value };

    // Auto-fill from stock item
    if (field === "stockItemId" && value) {
      const stockItem = stockItems.find((s) => s.id === value);
      if (stockItem) {
        items[idx].description = stockItem.description;
        items[idx].itemCode = stockItem.xeroItemCode || "";
        items[idx].unitAmount = stockItem.costPrice || 0;
      }
    }

    setNewPO({ ...newPO, lineItems: items });
  };

  const handleCreate = async () => {
    const supplier = suppliers.find((s) => s.id === newPO.supplierId);
    if (!supplier) {
      toast({ title: "Select a supplier", variant: "destructive" });
      return;
    }
    if (!newPO.lineItems.some((li) => li.description.trim())) {
      toast({ title: "Add at least one line item", variant: "destructive" });
      return;
    }

    setCreating(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/purchase-orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          supplierName: supplier.name,
          supplierId: supplier.id,
          reference: newPO.reference,
          deliveryDate: newPO.deliveryDate || undefined,
          lineItems: newPO.lineItems
            .filter((li) => li.description.trim())
            .map((li) => ({
              description: li.description,
              quantity: Number(li.quantity) || 1,
              unitAmount: Number(li.unitAmount) || 0,
              itemCode: li.itemCode || undefined,
            })),
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      toast({
        title: "Purchase order created",
        description: `${data.purchaseOrderNumber} — DRAFT in Xero`,
      });
      setShowCreate(false);
      setNewPO({
        supplierId: "",
        reference: "",
        deliveryDate: "",
        lineItems: [{ description: "", quantity: 1, unitAmount: 0, itemCode: "", stockItemId: "" }],
      });
    } catch (err) {
      toast({
        title: "Failed to create PO",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleSend = async (po: PurchaseOrder) => {
    if (!po.xeroPurchaseOrderId) {
      toast({ title: "No Xero PO ID", variant: "destructive" });
      return;
    }
    setSending(po.id);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/purchase-orders", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: "send",
          portalId: po.id,
          xeroPurchaseOrderId: po.xeroPurchaseOrderId,
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      toast({
        title: "Purchase order sent",
        description: `${po.purchaseOrderNumber} approved and emailed to supplier`,
      });
    } catch (err) {
      toast({
        title: "Failed to send PO",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSending(null);
    }
  };

  const lineTotal = (li: NewLineItem) => (Number(li.quantity) || 0) * (Number(li.unitAmount) || 0);
  const poTotal = newPO.lineItems.reduce((sum, li) => sum + lineTotal(li), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search POs, suppliers, references..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Purchase Order
        </Button>
      </div>

      {filtered.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            <ShoppingCart className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No purchase orders yet. Create one or let LEDGER auto-generate from reorder checks.</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="pt-6">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Delivery</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((po) => (
                  <TableRow key={po.id}>
                    <TableCell className="font-medium font-mono">
                      {po.purchaseOrderNumber || "Pending"}
                      {po.isAutoReorder && (
                        <RefreshCw className="inline-block ml-1 h-3 w-3 text-blue-400" />
                      )}
                    </TableCell>
                    <TableCell>{po.supplierName}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {po.reference || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          po.status === "DRAFT"
                            ? "bg-muted text-muted-foreground"
                            : po.status === "AUTHORISED"
                            ? "bg-green-500/20 text-green-400 border-green-500/30"
                            : po.status === "SUBMITTED"
                            ? "bg-blue-500/20 text-blue-400 border-blue-500/30"
                            : po.status === "BILLED"
                            ? "bg-purple-500/20 text-purple-400 border-purple-500/30"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {po.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{po.deliveryDate || "-"}</TableCell>
                    <TableCell>{po.lineItems?.length || 0}</TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setViewPO(po)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {po.status === "DRAFT" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleSend(po)}
                          disabled={sending === po.id}
                        >
                          <Send className="mr-1 h-3 w-3" />
                          {sending === po.id ? "Sending..." : "Approve & Send"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* View PO Detail Dialog */}
      <Dialog open={!!viewPO} onOpenChange={() => setViewPO(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {viewPO?.purchaseOrderNumber || "Purchase Order"}
            </DialogTitle>
            <DialogDescription>
              {viewPO?.supplierName} &middot; {viewPO?.status}
              {viewPO?.isAutoReorder && " (Auto-reorder)"}
            </DialogDescription>
          </DialogHeader>
          {viewPO && (
            <div className="space-y-4">
              {viewPO.reference && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Reference:</span> {viewPO.reference}
                </div>
              )}
              {viewPO.deliveryDate && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Delivery date:</span>{" "}
                  {viewPO.deliveryDate}
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit $</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(viewPO.lineItems || []).map((li, i) => (
                    <TableRow key={i}>
                      <TableCell>{li.description}</TableCell>
                      <TableCell className="font-mono text-xs">{li.itemCode || "-"}</TableCell>
                      <TableCell className="text-right">{li.quantity}</TableCell>
                      <TableCell className="text-right">${li.unitAmount.toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${(li.quantity * li.unitAmount).toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="text-right font-bold">
                Total: $
                {(viewPO.lineItems || [])
                  .reduce((sum, li) => sum + li.quantity * li.unitAmount, 0)
                  .toFixed(2)}{" "}
                ex-GST
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Create PO Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>
              Creates a DRAFT PO in Xero. Review and approve before sending to supplier.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Supplier</Label>
                <Select
                  value={newPO.supplierId}
                  onValueChange={(v) => setNewPO({ ...newPO, supplierId: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Reference</Label>
                <Input
                  value={newPO.reference}
                  onChange={(e) => setNewPO({ ...newPO, reference: e.target.value })}
                  placeholder="Optional reference"
                />
              </div>
            </div>
            <div className="grid gap-2 max-w-xs">
              <Label>Expected Delivery Date</Label>
              <Input
                type="date"
                value={newPO.deliveryDate}
                onChange={(e) => setNewPO({ ...newPO, deliveryDate: e.target.value })}
              />
            </div>

            <div className="space-y-3">
              <Label>Line Items</Label>
              {newPO.lineItems.map((li, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end">
                  <div className="col-span-3">
                    <Label className="text-xs">Stock Item</Label>
                    <Select
                      value={li.stockItemId || "manual"}
                      onValueChange={(v) =>
                        updateLineItem(idx, "stockItemId", v === "manual" ? "" : v)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Manual entry" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual entry</SelectItem>
                        {stockItems.map((s) => (
                          <SelectItem key={s.id} value={s.id}>
                            {s.description}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-3">
                    <Label className="text-xs">Description</Label>
                    <Input
                      value={li.description}
                      onChange={(e) => updateLineItem(idx, "description", e.target.value)}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Item Code</Label>
                    <Input
                      value={li.itemCode}
                      onChange={(e) => updateLineItem(idx, "itemCode", e.target.value)}
                      placeholder="Xero code"
                    />
                  </div>
                  <div className="col-span-1">
                    <Label className="text-xs">Qty</Label>
                    <Input
                      type="number"
                      value={li.quantity}
                      onChange={(e) => updateLineItem(idx, "quantity", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Unit $ (ex-GST)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      value={li.unitAmount}
                      onChange={(e) => updateLineItem(idx, "unitAmount", Number(e.target.value))}
                    />
                  </div>
                  <div className="col-span-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeLineItem(idx)}
                      disabled={newPO.lineItems.length <= 1}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={addLineItem}>
                <Plus className="mr-1 h-3 w-3" /> Add Line
              </Button>
            </div>

            <div className="text-right font-bold text-lg">
              Total: ${poTotal.toFixed(2)} ex-GST
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={creating}>
              <FileText className="mr-2 h-4 w-4" />
              {creating ? "Creating..." : "Create Draft PO"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
