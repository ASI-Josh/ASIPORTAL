"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp, addDoc, collection, deleteDoc, doc } from "firebase/firestore";
import {
  ClipboardCheck,
  Plus,
  Search,
  Trash2,
  Truck,
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
  GoodsReceivedInspection,
  GoodsInspectionStatus,
  ContactOrganization,
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

interface Props {
  inspections: GoodsReceivedInspection[];
  suppliers: ContactOrganization[];
}

export function GoodsReceivedTab({ inspections, suppliers }: Props) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [inspectionToDelete, setInspectionToDelete] = useState<GoodsReceivedInspection | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [newInspection, setNewInspection] = useState({
    poNumber: "",
    supplierId: "",
    category: CATEGORY_OPTIONS[0],
  });

  const formatDate = (value?: Timestamp) => {
    if (!value) return "-";
    const date = value.toDate ? value.toDate() : new Date(value as unknown as string);
    return Number.isNaN(date.getTime())
      ? "-"
      : date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  };

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return inspections;
    return inspections.filter(
      (insp) =>
        insp.poNumber.toLowerCase().includes(q) ||
        insp.supplierName.toLowerCase().includes(q)
    );
  }, [inspections, searchQuery]);

  const totals = useMemo(
    () => ({
      total: inspections.length,
      open: inspections.filter((i) => i.status !== "closed").length,
    }),
    [inspections]
  );

  const handleCreateInspection = async () => {
    if (!user) return;
    if (!newInspection.poNumber.trim()) {
      toast({ title: "Missing PO number", variant: "destructive" });
      return;
    }
    if (!newInspection.supplierId) {
      toast({ title: "Missing supplier", variant: "destructive" });
      return;
    }
    setCreating(true);
    try {
      const now = Timestamp.now();
      const supplier = suppliers.find((s) => s.id === newInspection.supplierId);
      if (!supplier) throw new Error("Supplier not found");

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
        receivedBy: { id: user.uid, name: user.name, email: user.email },
      });

      setShowNewDialog(false);
      setNewInspection({ poNumber: "", supplierId: "", category: CATEGORY_OPTIONS[0] });
      router.push(`/dashboard/goods-received/${docRef.id}`);
    } catch (err) {
      toast({
        title: "Unable to create inspection",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!inspectionToDelete) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, COLLECTIONS.GOODS_RECEIVED, inspectionToDelete.id));
      setInspectionToDelete(null);
    } catch {
      toast({ title: "Delete failed", variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by supplier or PO number..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted-foreground">
            {totals.total} record{totals.total !== 1 && "s"} &middot; {totals.open} open
          </p>
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New Inspection
          </Button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            <Truck className="mx-auto h-12 w-12 mb-4 opacity-50" />
            <p>No goods inspections yet. Create one when goods arrive.</p>
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
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((insp) => (
                  <TableRow key={insp.id}>
                    <TableCell className="font-medium">{insp.poNumber}</TableCell>
                    <TableCell>{insp.supplierName}</TableCell>
                    <TableCell className="text-muted-foreground">{insp.category || "-"}</TableCell>
                    <TableCell>
                      <Badge className={STATUS_BADGE[insp.status]}>
                        {STATUS_LABELS[insp.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {insp.decision ? (
                        <Badge
                          className={
                            insp.decision === "accepted"
                              ? "bg-green-500/20 text-green-400"
                              : insp.decision === "rejected"
                              ? "bg-red-500/20 text-red-400"
                              : "bg-amber-500/20 text-amber-400"
                          }
                        >
                          {insp.decision}
                        </Badge>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell>{formatDate(insp.updatedAt)}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/dashboard/goods-received/${insp.id}`)}
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setInspectionToDelete(insp)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* New Inspection Dialog */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New Goods Inspection</DialogTitle>
            <DialogDescription>
              Create a draft inspection and log received items once goods arrive.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label>ASI Purchase Order Number</Label>
              <Input
                value={newInspection.poNumber}
                onChange={(e) => setNewInspection({ ...newInspection, poNumber: e.target.value })}
                placeholder="PO-12345"
              />
            </div>
            <div className="grid gap-2">
              <Label>Supplier</Label>
              <Select
                value={newInspection.supplierId}
                onValueChange={(v) => setNewInspection({ ...newInspection, supplierId: v })}
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
              <Label>Procurement Category</Label>
              <Select
                value={newInspection.category}
                onValueChange={(v) => setNewInspection({ ...newInspection, category: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowNewDialog(false)}>Cancel</Button>
            <Button onClick={handleCreateInspection} disabled={creating}>
              {creating ? "Creating..." : "Create Inspection"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!inspectionToDelete} onOpenChange={() => setInspectionToDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Inspection</DialogTitle>
            <DialogDescription>This will permanently remove the inspection record.</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInspectionToDelete(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
