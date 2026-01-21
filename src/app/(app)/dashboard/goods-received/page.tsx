"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { AlertTriangle, Boxes, ClipboardCheck, PackageCheck, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  ContactOrganization,
  GoodsReceivedInspection,
  GoodsInspectionStatus,
  StockItem,
} from "@/lib/types";

const STATUS_LABELS: Record<GoodsInspectionStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  closed: "Closed",
};

const STATUS_BADGE: Record<GoodsInspectionStatus, string> = {
  draft: "bg-muted text-muted-foreground",
  submitted: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  closed: "bg-green-500/20 text-green-400 border-green-500/30",
};

const CATEGORY_OPTIONS = [
  "Apeax Film Materials",
  "GForce Scratch Removal Consumables",
  "Windscreen Crack Repair Consumables",
  "Other Supplier Procurement",
];

export default function GoodsReceivedPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [inspections, setInspections] = useState<GoodsReceivedInspection[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [suppliers, setSuppliers] = useState<ContactOrganization[]>([]);
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inspectionToDelete, setInspectionToDelete] = useState<GoodsReceivedInspection | null>(
    null
  );
  const [deleting, setDeleting] = useState(false);
  const [newInspection, setNewInspection] = useState({
    poNumber: "",
    supplierId: "",
    category: CATEGORY_OPTIONS[0],
  });

  useEffect(() => {
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.GOODS_RECEIVED),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(inspectionsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<GoodsReceivedInspection, "id">),
      }));
      setInspections(loaded);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const stockQuery = query(
      collection(db, COLLECTIONS.STOCK_ITEMS),
      orderBy("supplierName", "asc"),
      orderBy("description", "asc")
    );
    const unsubscribe = onSnapshot(stockQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<StockItem, "id">),
      }));
      setStockItems(loaded);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const suppliersQuery = query(
      collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS),
      where("category", "==", "supplier_vendor")
    );
    const unsubscribe = onSnapshot(suppliersQuery, (snapshot) => {
      const loaded = snapshot.docs
        .map((docSnap) => ({
          id: docSnap.id,
          ...(docSnap.data() as Omit<ContactOrganization, "id">),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setSuppliers(loaded);
    });
    return () => unsubscribe();
  }, []);

  const formatDate = (value?: Timestamp) => {
    if (!value) return "-";
    const date = value.toDate ? value.toDate() : new Date(value as unknown as string);
    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  const handleCreateInspection = async () => {
    if (!user) return;
    if (!newInspection.poNumber.trim()) {
      toast({
        title: "Missing PO number",
        description: "Enter the ASI Purchase Order number to continue.",
        variant: "destructive",
      });
      return;
    }
    if (!newInspection.supplierId) {
      toast({
        title: "Missing supplier",
        description: "Select a supplier to continue.",
        variant: "destructive",
      });
      return;
    }
    setCreating(true);
    try {
      const now = Timestamp.now();
      const supplier = suppliers.find((item) => item.id === newInspection.supplierId);
      if (!supplier) {
        toast({
          title: "Supplier not found",
          description: "Select a valid supplier before saving.",
          variant: "destructive",
        });
        return;
      }
      const docRef = await addDoc(collection(db, COLLECTIONS.GOODS_RECEIVED), {
        poNumber: newInspection.poNumber.trim(),
        supplierId: newInspection.supplierId,
        supplierName: supplier.name,
        category: newInspection.category,
        status: "draft",
        items: [],
        createdAt: now,
        createdBy: user.uid,
        updatedAt: now,
        receivedBy: {
          id: user.uid,
          name: user.name,
          email: user.email,
        },
      });
      setShowNewDialog(false);
      setNewInspection({
        poNumber: "",
        supplierId: "",
        category: CATEGORY_OPTIONS[0],
      });
      router.push(`/dashboard/goods-received/${docRef.id}`);
    } catch (error) {
      toast({
        title: "Unable to create inspection",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteInspection = async () => {
    if (!inspectionToDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.GOODS_RECEIVED, inspectionToDelete.id));
      setInspectionToDelete(null);
    } catch (error) {
      toast({
        title: "Delete failed",
        description: "Unable to delete this inspection.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  const totals = useMemo(
    () => ({
      total: inspections.length,
      open: inspections.filter((inspection) => inspection.status !== "closed").length,
    }),
    [inspections]
  );

  const filteredInspections = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    if (!queryText) return inspections;
    return inspections.filter(
      (inspection) =>
        inspection.poNumber.toLowerCase().includes(queryText) ||
        inspection.supplierName.toLowerCase().includes(queryText)
    );
  }, [inspections, searchQuery]);

  const lowStock = useMemo(
    () =>
      stockItems.filter(
        (item) =>
          item.itemType !== "plant" && (item.quantityOnHand ?? 0) <= 3
      ),
    [stockItems]
  );

  const stockSuppliers = useMemo(() => {
    const grouped = new Map<string, StockItem[]>();
    stockItems.forEach((item) => {
      const key = item.supplierName || "Unknown supplier";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(item);
    });
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [stockItems]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            Stock Control
          </h2>
          <p className="text-muted-foreground">
            Log and track goods inspections, non-conformance, and corrective actions.
          </p>
        </div>
        <Button onClick={() => setShowNewDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          New Inspection
        </Button>
      </div>

      <Tabs defaultValue="stock" className="space-y-6">
        <TabsList>
          <TabsTrigger value="stock">Stock dashboard</TabsTrigger>
          <TabsTrigger value="inspections">Inspection register</TabsTrigger>
        </TabsList>

        <TabsContent value="stock" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-3">
            <Card className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm font-medium">
                  <Boxes className="h-4 w-4 text-primary" />
                  Items tracked
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{stockItems.length}</div>
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
                <div className="text-2xl font-bold">{stockSuppliers.length}</div>
              </CardContent>
            </Card>
          </div>

          {stockSuppliers.length === 0 ? (
            <Card className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardContent className="p-10 text-center text-muted-foreground">
                No stock items logged yet. Complete a goods inspection to populate the register.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              {stockSuppliers.map(([supplierName, supplierItems]) => (
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
                              {item.supplierPartNumber ? ` - ${item.supplierPartNumber}` : ""}
                              {item.category ? ` - ${item.category}` : ""}
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
        </TabsContent>

        <TabsContent value="inspections">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Inspection Register</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {totals.total} inspection{totals.total !== 1 && "s"} logged - {totals.open} open
                  </p>
                </div>
                <div className="w-full md:max-w-xs">
                  <Input
                    placeholder="Search by supplier or PO number..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">
                {filteredInspections.length} result{filteredInspections.length !== 1 && "s"}
              </p>
            </CardHeader>
            <CardContent>
              {filteredInspections.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <ClipboardCheck className="mx-auto h-12 w-12 mb-4 opacity-50" />
                  <p>No goods inspections yet. Create the first one to get started.</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>PO Number</TableHead>
                      <TableHead>Supplier</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Updated</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredInspections.map((inspection) => (
                      <TableRow key={inspection.id}>
                        <TableCell className="font-medium">{inspection.poNumber}</TableCell>
                        <TableCell>{inspection.supplierName}</TableCell>
                        <TableCell>{inspection.category || "-"}</TableCell>
                        <TableCell>
                          <Badge className={STATUS_BADGE[inspection.status]}>
                            {STATUS_LABELS[inspection.status]}
                          </Badge>
                        </TableCell>
                        <TableCell>{formatDate(inspection.updatedAt)}</TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/dashboard/goods-received/${inspection.id}`)}
                          >
                            Open
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setInspectionToDelete(inspection)}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Goods Inspection</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="po-number">ASI Purchase Order Number</Label>
              <Input
                id="po-number"
                value={newInspection.poNumber}
                onChange={(e) =>
                  setNewInspection({ ...newInspection, poNumber: e.target.value })
                }
                placeholder="PO-12345"
              />
            </div>
          <div className="grid gap-2">
              <Label>Supplier</Label>
              <Select
                value={newInspection.supplierId}
                onValueChange={(value) =>
                  setNewInspection({ ...newInspection, supplierId: value })
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select supplier" />
                </SelectTrigger>
                <SelectContent>
                  {suppliers.length === 0 ? (
                    <SelectItem value="none" disabled>
                      No suppliers available
                    </SelectItem>
                  ) : (
                    suppliers.map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Add suppliers in Contacts (Supplier/Vendor category).
              </p>
            </div>
            <div className="grid gap-2">
              <Label>Procurement Category</Label>
              <Select
                value={newInspection.category}
                onValueChange={(value) =>
                  setNewInspection({ ...newInspection, category: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateInspection} disabled={creating}>
              {creating ? "Creating..." : "Create Inspection"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!inspectionToDelete} onOpenChange={() => setInspectionToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Inspection</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove the inspection record.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInspectionToDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteInspection} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
