"use client";

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckSquare,
  Download,
  Edit2,
  Loader2,
  Save,
  X,
  Search,
} from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { auth } from "@/lib/firebaseClient";
import type { StockItem } from "@/lib/types";

interface Props {
  stockItems: StockItem[];
}

interface XeroImportItem {
  code: string;
  name: string;
  description: string;
  costPrice: number;
  salesPrice: number;
  isTrackedInventory: boolean;
  xeroQuantity: number;
  alreadyImported: boolean;
  selected?: boolean;
}

export function StockRegisterTab({ stockItems }: Props) {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [editItem, setEditItem] = useState<StockItem | null>(null);
  const [saving, setSaving] = useState(false);

  // Xero import state
  const [showImport, setShowImport] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [xeroItems, setXeroItems] = useState<XeroImportItem[]>([]);
  const [defaultSupplier, setDefaultSupplier] = useState("");

  const [editForm, setEditForm] = useState({
    quantityOnHand: 0,
    reorderThreshold: 0,
    reorderQuantity: 0,
    xeroItemCode: "",
    costPrice: 0,
    notes: "",
  });

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockItems;
    return stockItems.filter(
      (item) =>
        item.description.toLowerCase().includes(q) ||
        (item.supplierName || "").toLowerCase().includes(q) ||
        item.internalStockNumber.toLowerCase().includes(q) ||
        (item.xeroItemCode || "").toLowerCase().includes(q)
    );
  }, [stockItems, searchQuery]);

  const grouped = useMemo(() => {
    const map = new Map<string, StockItem[]>();
    filtered.forEach((item) => {
      const key = item.supplierName || "Unknown supplier";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    });
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const openEdit = (item: StockItem) => {
    setEditItem(item);
    setEditForm({
      quantityOnHand: item.quantityOnHand ?? 0,
      reorderThreshold: item.reorderThreshold ?? 0,
      reorderQuantity: item.reorderQuantity ?? 0,
      xeroItemCode: item.xeroItemCode ?? "",
      costPrice: item.costPrice ?? 0,
      notes: item.notes ?? "",
    });
  };

  const handleSave = async () => {
    if (!editItem) return;
    setSaving(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/stock", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: editItem.id,
          updates: {
            quantityOnHand: Number(editForm.quantityOnHand) || 0,
            reorderThreshold: Number(editForm.reorderThreshold) || 0,
            reorderQuantity: Number(editForm.reorderQuantity) || 0,
            xeroItemCode: editForm.xeroItemCode.trim(),
            costPrice: Number(editForm.costPrice) || 0,
            notes: editForm.notes.trim(),
          },
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      toast({ title: "Stock item updated" });
      setEditItem(null);
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const fetchXeroItems = async () => {
    setImportLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/import-xero", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      setXeroItems(data.items.map((i: XeroImportItem) => ({ ...i, selected: !i.alreadyImported })));
      setShowImport(true);
    } catch (err) {
      toast({
        title: "Failed to fetch Xero items",
        description: err instanceof Error ? err.message : "Check Xero connection",
        variant: "destructive",
      });
    } finally {
      setImportLoading(false);
    }
  };

  const handleImport = async () => {
    const selected = xeroItems.filter((i) => i.selected && !i.alreadyImported);
    if (!selected.length) {
      toast({ title: "No items selected", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch("/api/procurement/import-xero", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          items: selected.map((i) => ({
            code: i.code,
            name: i.name,
            description: i.description,
            costPrice: i.costPrice,
            xeroQuantity: i.xeroQuantity,
          })),
          defaultSupplierName: defaultSupplier || undefined,
          defaultItemType: "stock",
        }),
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error);

      toast({ title: "Import complete", description: data.message });
      setShowImport(false);
    } catch (err) {
      toast({
        title: "Import failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const toggleAll = (selected: boolean) => {
    setXeroItems(xeroItems.map((i) => (i.alreadyImported ? i : { ...i, selected })));
  };

  const isLow = (item: StockItem) => {
    const qty = item.quantityOnHand ?? 0;
    if (item.reorderThreshold && item.reorderThreshold > 0) return qty <= item.reorderThreshold;
    return item.itemType !== "plant" && qty <= 3;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search stock items, suppliers, Xero codes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <p className="text-sm text-muted-foreground">
            {filtered.length} item{filtered.length !== 1 && "s"}
          </p>
        </div>
        <Button variant="outline" onClick={fetchXeroItems} disabled={importLoading}>
          {importLoading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Import from Xero
        </Button>
      </div>

      {grouped.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            <Boxes className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No stock items found. Complete a goods inspection to populate the register.</p>
          </CardContent>
        </Card>
      ) : (
        grouped.map(([supplierName, items]) => (
          <Card key={supplierName} className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{supplierName}</CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead>Stock #</TableHead>
                    <TableHead>Xero Code</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Threshold</TableHead>
                    <TableHead className="text-right">Cost</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => {
                    const low = isLow(item);
                    return (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div className="font-medium">{item.description}</div>
                          {item.supplierPartNumber && (
                            <div className="text-xs text-muted-foreground">
                              Supplier: {item.supplierPartNumber}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {item.internalStockNumber}
                        </TableCell>
                        <TableCell className="text-xs font-mono">
                          {item.xeroItemCode || (
                            <span className="text-amber-400">Not linked</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{item.itemType}</Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={low ? "text-amber-400 font-semibold" : ""}>
                            {item.quantityOnHand} {item.unit || ""}
                          </span>
                          {low && (
                            <AlertTriangle className="inline-block ml-1 h-3 w-3 text-amber-400" />
                          )}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {item.reorderThreshold || "-"}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          {item.costPrice
                            ? `$${item.costPrice.toFixed(2)}`
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(item)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))
      )}

      {/* Edit Stock Item Dialog */}
      <Dialog open={!!editItem} onOpenChange={() => setEditItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Stock Item</DialogTitle>
            <DialogDescription>
              {editItem?.description} ({editItem?.internalStockNumber})
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Current Quantity</Label>
                <Input
                  type="number"
                  value={editForm.quantityOnHand}
                  onChange={(e) =>
                    setEditForm({ ...editForm, quantityOnHand: Number(e.target.value) })
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Unit Cost ($)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editForm.costPrice}
                  onChange={(e) =>
                    setEditForm({ ...editForm, costPrice: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label>Reorder Threshold</Label>
                <Input
                  type="number"
                  value={editForm.reorderThreshold}
                  onChange={(e) =>
                    setEditForm({ ...editForm, reorderThreshold: Number(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">Alert when stock hits this level</p>
              </div>
              <div className="grid gap-2">
                <Label>Reorder Quantity</Label>
                <Input
                  type="number"
                  value={editForm.reorderQuantity}
                  onChange={(e) =>
                    setEditForm({ ...editForm, reorderQuantity: Number(e.target.value) })
                  }
                />
                <p className="text-xs text-muted-foreground">Target quantity to order up to</p>
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Xero Item Code</Label>
              <Input
                value={editForm.xeroItemCode}
                onChange={(e) =>
                  setEditForm({ ...editForm, xeroItemCode: e.target.value })
                }
                placeholder="e.g. GA-DBM-5"
              />
              <p className="text-xs text-muted-foreground">
                Must match Xero catalogue for auto-reorder PO line items
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Notes</Label>
              <Input
                value={editForm.notes}
                onChange={(e) =>
                  setEditForm({ ...editForm, notes: e.target.value })
                }
                placeholder="Optional notes..."
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditItem(null)}>
              <X className="mr-2 h-4 w-4" /> Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import from Xero Dialog */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Import from Xero Catalogue</DialogTitle>
            <DialogDescription>
              Select items from your Xero inventory to add to the portal stock register.
              Already-imported items are greyed out.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2 max-w-sm">
              <Label>Default Supplier Name</Label>
              <Input
                value={defaultSupplier}
                onChange={(e) => setDefaultSupplier(e.target.value)}
                placeholder="e.g. Galaxy Auto Parts"
              />
              <p className="text-xs text-muted-foreground">
                You can update individual suppliers after import
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => toggleAll(true)}>
                <CheckSquare className="mr-1 h-3 w-3" /> Select All
              </Button>
              <Button variant="outline" size="sm" onClick={() => toggleAll(false)}>
                <X className="mr-1 h-3 w-3" /> Deselect All
              </Button>
              <span className="text-sm text-muted-foreground ml-2">
                {xeroItems.filter((i) => i.selected && !i.alreadyImported).length} selected
              </span>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Cost</TableHead>
                  <TableHead className="text-right">Xero Qty</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {xeroItems.map((item, idx) => (
                  <TableRow
                    key={item.code}
                    className={item.alreadyImported ? "opacity-40" : ""}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={item.selected || false}
                        disabled={item.alreadyImported}
                        onChange={(e) => {
                          const updated = [...xeroItems];
                          updated[idx] = { ...updated[idx], selected: e.target.checked };
                          setXeroItems(updated);
                        }}
                        className="h-4 w-4"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-sm">{item.code}</TableCell>
                    <TableCell>
                      <div className="font-medium">{item.name}</div>
                      {item.description !== item.name && (
                        <div className="text-xs text-muted-foreground truncate max-w-xs">
                          {item.description}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {item.costPrice ? `$${item.costPrice.toFixed(2)}` : "-"}
                    </TableCell>
                    <TableCell className="text-right">{item.xeroQuantity}</TableCell>
                    <TableCell>
                      {item.alreadyImported ? (
                        <Badge className="bg-green-500/20 text-green-400">Imported</Badge>
                      ) : (
                        <Badge variant="secondary">New</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowImport(false)}>Cancel</Button>
            <Button onClick={handleImport} disabled={importing}>
              {importing ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Download className="mr-2 h-4 w-4" />
              )}
              {importing ? "Importing..." : "Import Selected"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
