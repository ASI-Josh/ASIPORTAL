"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Timestamp,
  doc,
  onSnapshot,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { ArrowLeft, CheckCircle, ClipboardCheck, Plus, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  CorrectiveAction,
  FileAttachment,
  GoodsConformance,
  GoodsDecision,
  GoodsInspectionStatus,
  GoodsReceivedInspection,
  GoodsReceivedItem,
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

const DECISION_OPTIONS: GoodsDecision[] = ["accepted", "conditional", "rejected"];
const CONFORMANCE_OPTIONS: GoodsConformance[] = ["conforming", "non_conforming"];
const CA_STATUS_OPTIONS: Array<NonNullable<CorrectiveAction["status"]>> = [
  "open",
  "in_progress",
  "closed",
];

const pruneUndefined = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => [key, pruneUndefined(val)])
  );
};

export default function GoodsReceivedDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const inspectionId = params.id as string;

  const [inspection, setInspection] = useState<GoodsReceivedInspection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [poNumber, setPoNumber] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [category, setCategory] = useState("");
  const [receivedDate, setReceivedDate] = useState("");
  const [status, setStatus] = useState<GoodsInspectionStatus>("draft");
  const [decision, setDecision] = useState<GoodsDecision | "">("");
  const [nonConformanceNotes, setNonConformanceNotes] = useState("");
  const [items, setItems] = useState<GoodsReceivedItem[]>([]);
  const [shippingDocs, setShippingDocs] = useState<FileAttachment[]>([]);
  const [packingListDocs, setPackingListDocs] = useState<FileAttachment[]>([]);
  const [correctiveAction, setCorrectiveAction] = useState<CorrectiveAction>({
    required: false,
    status: "open",
  });
  const [uploading, setUploading] = useState<Record<string, boolean>>({});
  const [newItem, setNewItem] = useState({
    description: "",
    quantity: "",
    unit: "",
    batchNumber: "",
    conformance: "conforming" as GoodsConformance,
    notes: "",
  });

  useEffect(() => {
    const inspectionRef = doc(db, COLLECTIONS.GOODS_RECEIVED, inspectionId);
    const unsubscribe = onSnapshot(
      inspectionRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setInspection(null);
          setLoading(false);
          return;
        }
        const data = snapshot.data() as Omit<GoodsReceivedInspection, "id">;
        setInspection({ id: snapshot.id, ...data });
        setLoading(false);
      },
      (error) => {
        console.warn("Failed to load goods inspection:", error);
        setInspection(null);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [inspectionId]);

  useEffect(() => {
    if (!inspection) return;
    setPoNumber(inspection.poNumber || "");
    setSupplierName(inspection.supplierName || "");
    setCategory(inspection.category || "");
    setStatus(inspection.status);
    setDecision(inspection.decision || "");
    setNonConformanceNotes(inspection.nonConformanceNotes || "");
    setItems(inspection.items || []);
    setShippingDocs(inspection.attachments?.shippingDocs || []);
    setPackingListDocs(inspection.attachments?.packingList || []);
    setCorrectiveAction(
      inspection.correctiveAction || {
        required: false,
        status: "open",
      }
    );
    const date = inspection.receivedDate?.toDate?.();
    setReceivedDate(date ? date.toISOString().split("T")[0] : "");
  }, [inspection]);

  const updateItem = (id: string, updates: Partial<GoodsReceivedItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleUploadAttachments = async (
    kind: "shipping" | "packing",
    files: FileList | null
  ) => {
    if (!inspection || !files || files.length === 0) return;
    const currentList = kind === "shipping" ? shippingDocs : packingListDocs;
    setUploading((prev) => ({ ...prev, [kind]: true }));
    try {
      const uploaded = await Promise.all(
        Array.from(files).map(async (file) => {
          const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
          const path = `goods-received/${inspection.id}/${kind}/${Date.now()}-${safeName}`;
          const storageRef = ref(storage, path);
          await uploadBytes(storageRef, file);
          const url = await getDownloadURL(storageRef);
          return {
            id: `${kind}-${Date.now()}-${safeName}`,
            name: file.name,
            url,
            uploadedAt: Timestamp.now(),
            uploadedBy: {
              id: user?.uid || "",
              name: user?.name || "User",
              email: user?.email,
            },
          };
        })
      );

      const updated = [...currentList, ...uploaded];
      const nextShippingDocs = kind === "shipping" ? updated : shippingDocs;
      const nextPackingDocs = kind === "packing" ? updated : packingListDocs;
      if (kind === "shipping") {
        setShippingDocs(updated);
      } else {
        setPackingListDocs(updated);
      }

      await updateDoc(doc(db, COLLECTIONS.GOODS_RECEIVED, inspection.id), {
        attachments: {
          shippingDocs: nextShippingDocs,
          packingList: nextPackingDocs,
        },
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: "Unable to upload attachments.",
        variant: "destructive",
      });
    } finally {
      setUploading((prev) => ({ ...prev, [kind]: false }));
    }
  };

  const handleRemoveAttachment = async (kind: "shipping" | "packing", id: string) => {
    if (!inspection) return;
    const updated =
      kind === "shipping"
        ? shippingDocs.filter((doc) => doc.id !== id)
        : packingListDocs.filter((doc) => doc.id !== id);
    const nextShippingDocs = kind === "shipping" ? updated : shippingDocs;
    const nextPackingDocs = kind === "packing" ? updated : packingListDocs;
    if (kind === "shipping") {
      setShippingDocs(updated);
    } else {
      setPackingListDocs(updated);
    }
    try {
      await updateDoc(doc(db, COLLECTIONS.GOODS_RECEIVED, inspection.id), {
        attachments: {
          shippingDocs: nextShippingDocs,
          packingList: nextPackingDocs,
        },
        updatedAt: Timestamp.now(),
      });
    } catch (error) {
      toast({
        title: "Update failed",
        description: "Unable to update attachments.",
        variant: "destructive",
      });
    }
  };

  const handleAddItem = () => {
    if (!newItem.description.trim()) {
      toast({
        title: "Missing description",
        description: "Enter an item description before adding.",
        variant: "destructive",
      });
      return;
    }
    const quantity = Number(newItem.quantity);
    if (!quantity || Number.isNaN(quantity)) {
      toast({
        title: "Missing quantity",
        description: "Enter a quantity before adding.",
        variant: "destructive",
      });
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        id: `item-${Date.now()}`,
        description: newItem.description.trim(),
        quantity,
        unit: newItem.unit.trim() || undefined,
        batchNumber: newItem.batchNumber.trim() || undefined,
        conformance: newItem.conformance,
        notes: newItem.notes.trim() || undefined,
      },
    ]);
    setNewItem({
      description: "",
      quantity: "",
      unit: "",
      batchNumber: "",
      conformance: "conforming",
      notes: "",
    });
  };

  const buildCorrectiveActionReport = useMemo(() => {
    if (!correctiveAction.required) return "";
    const lines = [
      `ASI Goods Received Corrective Action Report`,
      `PO Number: ${poNumber || "N/A"}`,
      `Supplier: ${supplierName || "N/A"}`,
      `Decision: ${decision || "Pending"}`,
      `Non-conformance: ${nonConformanceNotes || "Not specified"}`,
      `Corrective action: ${correctiveAction.description || "Not specified"}`,
      `Assigned to: ${correctiveAction.assignedTo || "Not assigned"}`,
      `Due date: ${
        correctiveAction.dueDate?.toDate?.().toLocaleDateString("en-AU") || "Not set"
      }`,
      `Status: ${correctiveAction.status || "open"}`,
      `Closed by: ${correctiveAction.closedBy || "Pending"}`,
      `Closed at: ${
        correctiveAction.closedAt?.toDate?.().toLocaleDateString("en-AU") || "Pending"
      }`,
    ];
    return lines.join("\n");
  }, [correctiveAction, decision, nonConformanceNotes, poNumber, supplierName]);

  const handleCopyReport = async () => {
    if (!buildCorrectiveActionReport) return;
    try {
      await navigator.clipboard.writeText(buildCorrectiveActionReport);
      toast({ title: "Report copied", description: "Corrective action report copied." });
    } catch (error) {
      toast({
        title: "Copy failed",
        description: "Unable to copy the report.",
        variant: "destructive",
      });
    }
  };

  const handleSave = async (overrideStatus?: GoodsInspectionStatus) => {
    if (!inspection) return;
    if (!user) {
      toast({
        title: "Not signed in",
        description: "Please sign in again and retry.",
        variant: "destructive",
      });
      return;
    }
    if (!poNumber.trim()) {
      toast({
        title: "Missing PO number",
        description: "ASI Purchase Order Number is required.",
        variant: "destructive",
      });
      return;
    }
    if (!supplierName.trim()) {
      toast({
        title: "Missing supplier",
        description: "Supplier name is required.",
        variant: "destructive",
      });
      return;
    }
    if (items.length === 0) {
      toast({
        title: "Add items",
        description: "Log at least one received item before saving.",
        variant: "destructive",
      });
      return;
    }

    const updatedStatus = overrideStatus || status;
    const now = Timestamp.now();
    const receivedTimestamp = receivedDate ? Timestamp.fromDate(new Date(receivedDate)) : null;

    let nextCorrectiveAction = correctiveAction;
    if (!correctiveAction.required) {
      nextCorrectiveAction = { required: false };
    } else if (correctiveAction.status === "closed" && !correctiveAction.closedAt) {
      nextCorrectiveAction = {
        ...correctiveAction,
        closedAt: now,
        closedBy: user?.name || user?.email || user?.uid,
      };
    }

    setSaving(true);
    try {
      const payload = pruneUndefined({
        poNumber: poNumber.trim(),
        supplierName: supplierName.trim(),
        category: category || undefined,
        receivedDate: receivedTimestamp || undefined,
        status: updatedStatus,
        decision: decision || undefined,
        nonConformanceNotes: nonConformanceNotes.trim() || undefined,
        correctiveAction: nextCorrectiveAction,
        items,
        attachments: {
          shippingDocs,
          packingList: packingListDocs,
        },
        updatedAt: now,
        closedAt: updatedStatus === "closed" ? now : inspection.closedAt || undefined,
        closedBy:
          updatedStatus === "closed"
            ? user?.name || user?.email || user?.uid
            : inspection.closedBy || undefined,
        receivedBy: inspection.receivedBy || {
          id: user?.uid || "",
          name: user?.name || "User",
          email: user?.email,
        },
      }) as Record<string, unknown>;

      await updateDoc(
        doc(db, COLLECTIONS.GOODS_RECEIVED, inspection.id),
        payload as Record<string, any>
      );
      setStatus(updatedStatus);
      toast({
        title: "Inspection saved",
        description: updatedStatus === "closed" ? "Inspection closed." : "Changes saved.",
      });
    } catch (error) {
      console.error("Failed to save goods received inspection:", error);
      const err = error as { message?: string; code?: string };
      const message = err?.message
        ? err.code
          ? `${err.code}: ${err.message}`
          : err.message
        : "Unable to save this inspection.";
      toast({
        title: "Save failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading inspection...</p>
      </div>
    );
  }

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ClipboardCheck className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Inspection Not Found</h2>
        <Button onClick={() => router.push("/dashboard/goods-received")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Goods Received
        </Button>
      </div>
    );
  }

  const canClose =
    status !== "closed" &&
    decision !== "" &&
    (!correctiveAction.required || correctiveAction.status === "closed");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => router.push("/dashboard/goods-received")}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <Badge className={STATUS_BADGE[status]}>{STATUS_LABELS[status]}</Badge>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Inspection Overview</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2">
            <Label>ASI Purchase Order Number *</Label>
            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Supplier *</Label>
            <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Procurement Category</Label>
            <Input value={category} onChange={(e) => setCategory(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>Goods Received Date</Label>
            <Input
              type="date"
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Decision</Label>
            <Select value={decision} onValueChange={(val) => setDecision(val as GoodsDecision)}>
              <SelectTrigger>
                <SelectValue placeholder="Select decision" />
              </SelectTrigger>
              <SelectContent>
                {DECISION_OPTIONS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value.replace("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Inspection Status</Label>
            <Select value={status} onValueChange={(val) => setStatus(val as GoodsInspectionStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.keys(STATUS_LABELS).map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value as GoodsInspectionStatus]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Received Items</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-6">
            <div className="md:col-span-2">
              <Label>Description *</Label>
              <Input
                value={newItem.description}
                onChange={(e) => setNewItem({ ...newItem, description: e.target.value })}
                placeholder="Item description"
              />
            </div>
            <div>
              <Label>Quantity *</Label>
              <Input
                type="number"
                value={newItem.quantity}
                onChange={(e) => setNewItem({ ...newItem, quantity: e.target.value })}
              />
            </div>
            <div>
              <Label>Unit</Label>
              <Input
                value={newItem.unit}
                onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
              />
            </div>
            <div>
              <Label>Batch/Lot</Label>
              <Input
                value={newItem.batchNumber}
                onChange={(e) => setNewItem({ ...newItem, batchNumber: e.target.value })}
              />
            </div>
            <div>
              <Label>Conformance</Label>
              <Select
                value={newItem.conformance}
                onValueChange={(val) =>
                  setNewItem({ ...newItem, conformance: val as GoodsConformance })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONFORMANCE_OPTIONS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {value.replace("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-6">
              <Label>Notes</Label>
              <Textarea
                value={newItem.notes}
                onChange={(e) => setNewItem({ ...newItem, notes: e.target.value })}
                placeholder="Inspection notes (optional)"
              />
            </div>
            <div className="md:col-span-6">
              <Button onClick={handleAddItem} variant="outline">
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </div>
          </div>

          {items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No items logged yet.</p>
          ) : (
            <div className="space-y-3">
              {items.map((item) => (
                <Card key={item.id} className="bg-background/60 border-border/30">
                  <CardContent className="grid gap-3 md:grid-cols-6 py-4">
                    <div className="md:col-span-2">
                      <Label>Description</Label>
                      <Input
                        value={item.description}
                        onChange={(e) => updateItem(item.id, { description: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Qty</Label>
                      <Input
                        type="number"
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(item.id, { quantity: Number(e.target.value) || 0 })
                        }
                      />
                    </div>
                    <div>
                      <Label>Unit</Label>
                      <Input
                        value={item.unit || ""}
                        onChange={(e) => updateItem(item.id, { unit: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Batch/Lot</Label>
                      <Input
                        value={item.batchNumber || ""}
                        onChange={(e) => updateItem(item.id, { batchNumber: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label>Conformance</Label>
                      <Select
                        value={item.conformance}
                        onValueChange={(val) =>
                          updateItem(item.id, { conformance: val as GoodsConformance })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONFORMANCE_OPTIONS.map((value) => (
                            <SelectItem key={value} value={value}>
                              {value.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="md:col-span-5">
                      <Label>Notes</Label>
                      <Textarea
                        value={item.notes || ""}
                        onChange={(e) => updateItem(item.id, { notes: e.target.value })}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => removeItem(item.id)}
                      >
                        Remove
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Attachments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <Label>Shipping Documents (optional)</Label>
            <Input
              type="file"
              multiple
              onChange={(e) => handleUploadAttachments("shipping", e.target.files)}
              disabled={uploading.shipping}
            />
            {shippingDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No shipping documents uploaded.</p>
            ) : (
              <div className="space-y-2">
                {shippingDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {doc.name}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveAttachment("shipping", doc.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <Label>Packing List (optional)</Label>
            <Input
              type="file"
              multiple
              onChange={(e) => handleUploadAttachments("packing", e.target.files)}
              disabled={uploading.packing}
            />
            {packingListDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No packing list uploaded.</p>
            ) : (
              <div className="space-y-2">
                {packingListDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between">
                    <a
                      href={doc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-primary hover:underline"
                    >
                      {doc.name}
                    </a>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveAttachment("packing", doc.id)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>Non-Conformance & Corrective Action</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label>Non-Conformance Notes</Label>
            <Textarea
              value={nonConformanceNotes}
              onChange={(e) => setNonConformanceNotes(e.target.value)}
              placeholder="Describe any non-conformance identified."
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              id="ca-required"
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={correctiveAction.required}
              onChange={(e) =>
                setCorrectiveAction((prev) => ({ ...prev, required: e.target.checked }))
              }
            />
            <Label htmlFor="ca-required" className="text-sm font-normal">
              Corrective action required
            </Label>
          </div>

          {correctiveAction.required && (
            <div className="grid gap-4 md:grid-cols-2">
              <div className="grid gap-2 md:col-span-2">
                <Label>Corrective Action Description</Label>
                <Textarea
                  value={correctiveAction.description || ""}
                  onChange={(e) =>
                    setCorrectiveAction((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Assigned To</Label>
                <Input
                  value={correctiveAction.assignedTo || ""}
                  onChange={(e) =>
                    setCorrectiveAction((prev) => ({
                      ...prev,
                      assignedTo: e.target.value,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={
                    correctiveAction.dueDate?.toDate?.().toISOString().split("T")[0] || ""
                  }
                  onChange={(e) =>
                    setCorrectiveAction((prev) => ({
                      ...prev,
                      dueDate: e.target.value
                        ? Timestamp.fromDate(new Date(e.target.value))
                        : undefined,
                    }))
                  }
                />
              </div>
              <div className="grid gap-2">
                <Label>Status</Label>
                <Select
                  value={correctiveAction.status || "open"}
                  onValueChange={(val) =>
                    setCorrectiveAction((prev) => ({
                      ...prev,
                      status: val as CorrectiveAction["status"],
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CA_STATUS_OPTIONS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option.replace("_", " ")}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Closure Notes</Label>
                <Textarea
                  value={correctiveAction.closureNotes || ""}
                  onChange={(e) =>
                    setCorrectiveAction((prev) => ({
                      ...prev,
                      closureNotes: e.target.value,
                    }))
                  }
                />
              </div>
              {buildCorrectiveActionReport && (
                <div className="md:col-span-2">
                  <Label>Corrective Action Report</Label>
                  <Textarea value={buildCorrectiveActionReport} readOnly rows={8} />
                  <Button variant="outline" className="mt-2" onClick={handleCopyReport}>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Copy report
                  </Button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={() => handleSave()} disabled={saving}>
          <Save className="mr-2 h-4 w-4" />
          Save changes
        </Button>
        {status === "draft" && (
          <Button onClick={() => handleSave("submitted")} disabled={saving}>
            Submit inspection
          </Button>
        )}
        {canClose && (
          <Button onClick={() => handleSave("closed")} disabled={saving}>
            Close inspection
          </Button>
        )}
      </div>
    </div>
  );
}
