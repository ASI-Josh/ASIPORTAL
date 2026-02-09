"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
} from "firebase/firestore";
import { FileText, Plus, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { IMSDocument, IMSDocumentType } from "@/lib/types";

const DOC_TYPE_OPTIONS: Array<{ value: IMSDocumentType; label: string; prefix: string }> = [
  { value: "policy", label: "Policy", prefix: "POL" },
  { value: "manual", label: "IMS Manual", prefix: "MAN" },
  { value: "ims_procedure", label: "IMS Procedure", prefix: "IMS-PROC" },
  { value: "technical_procedure", label: "Technical Procedure", prefix: "TECH-PROC" },
  { value: "work_instruction", label: "Work Instruction", prefix: "WI" },
  { value: "form", label: "Form", prefix: "FRM" },
  { value: "register", label: "Register", prefix: "REG" },
];

const statusBadge = (status: IMSDocument["status"]) => {
  switch (status) {
    case "active":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "obsolete":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  }
};

const formatDocNumber = (prefix: string, value: number) =>
  `${prefix}-${String(value).padStart(3, "0")}`;

export default function DocManagerPage() {
  const router = useRouter();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [documents, setDocuments] = useState<IMSDocument[]>([]);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [sharingAll, setSharingAll] = useState(false);
  const [newDoc, setNewDoc] = useState({
    title: "",
    docType: "ims_procedure" as IMSDocumentType,
    isoClauses: "",
  });

  useEffect(() => {
    const docsQuery = query(
      collection(db, COLLECTIONS.IMS_DOCUMENTS),
      orderBy("docNumber", "asc")
    );
    const unsubscribe = onSnapshot(docsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<IMSDocument, "id">),
      }));
      setDocuments(loaded);
    });
    return () => unsubscribe();
  }, []);

  const stats = useMemo(() => {
    const total = documents.length;
    const active = documents.filter((doc) => doc.status === "active").length;
    const draft = documents.filter((doc) => doc.status === "draft").length;
    const obsolete = documents.filter((doc) => doc.status === "obsolete").length;
    return { total, active, draft, obsolete };
  }, [documents]);

  const reserveDocNumber = async (prefix: string) => {
    return runTransaction(db, async (transaction) => {
      const counterRef = doc(db, COLLECTIONS.IMS_DOCUMENT_COUNTERS, prefix);
      const counterSnap = await transaction.get(counterRef);
      const current = counterSnap.exists()
        ? (counterSnap.data().nextNumber as number | undefined)
        : undefined;
      const nextNumber = Number.isFinite(current) && current ? current : 1;
      transaction.set(counterRef, { nextNumber: nextNumber + 1 }, { merge: true });
      return {
        nextNumber,
        docNumber: formatDocNumber(prefix, nextNumber),
      };
    });
  };

  const handleCreateDoc = async () => {
    if (!user || user.role !== "admin") {
      toast({
        title: "Admin only",
        description: "You do not have access to the doc manager.",
        variant: "destructive",
      });
      return;
    }
    if (!newDoc.title.trim()) {
      toast({
        title: "Missing title",
        description: "Enter a document title.",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const option = DOC_TYPE_OPTIONS.find((item) => item.value === newDoc.docType);
      if (!option) {
        throw new Error("Invalid document type");
      }
      const { docNumber } = await reserveDocNumber(option.prefix);
      const now = Timestamp.now();
      const isoClauses = newDoc.isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const payload: Omit<IMSDocument, "id"> = {
        docNumber,
        title: newDoc.title.trim(),
        docType: newDoc.docType,
        status: "draft",
        owner: {
          id: user.uid,
          name: user.name || user.email || "Admin",
          email: user.email || undefined,
        },
        isoClauses: isoClauses.length > 0 ? isoClauses : undefined,
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
        updatedAt: now,
      };

      await setDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docNumber), payload);
      setShowCreateDialog(false);
      setNewDoc({ title: "", docType: "ims_procedure", isoClauses: "" });
      router.push(`/dashboard/ims/doc-manager/${docNumber}`);
    } catch (error) {
      console.error("Failed to create document:", error);
      toast({
        title: "Unable to create",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Doc Manager is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
            <FileText className="h-8 w-8 text-sky-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Doc Manager</h1>
            <p className="text-muted-foreground">
              Create, revise, and issue controlled IMS documents.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={async () => {
              if (!user) return;
              setSharingAll(true);
              try {
                const token = await firebaseUser?.getIdToken();
                const response = await fetch("/api/ims/doc-context/bulk", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                  },
                  body: JSON.stringify({ maxDocs: 25 }),
                });
                const payload = await response.json();
                if (!response.ok) throw new Error(payload.error || "Unable to share IMS docs.");
                toast({
                  title: "Shared to Knowledge Hub",
                  description: `Synced ${payload.results?.synced ?? 0}, skipped ${payload.results?.skipped ?? 0}.`,
                });
              } catch (error) {
                const message =
                  error instanceof Error ? error.message : "Unable to share IMS docs.";
                toast({ title: "Share failed", description: message, variant: "destructive" });
              } finally {
                setSharingAll(false);
              }
            }}
            disabled={sharingAll}
          >
            {sharingAll ? "Sharing..." : "Share all to Knowledge Hub"}
          </Button>
          <Button onClick={() => setShowCreateDialog(true)}>
            <Plus className="mr-2 h-4 w-4" />
            New document
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{stats.total}</div>
            <p className="text-xs text-muted-foreground">Total documents</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-400">{stats.active}</div>
            <p className="text-xs text-muted-foreground">Active</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-400">{stats.draft}</div>
            <p className="text-xs text-muted-foreground">Draft</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-400">{stats.obsolete}</div>
            <p className="text-xs text-muted-foreground">Obsolete</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Document register</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {documents.length === 0 ? (
            <div className="text-sm text-muted-foreground">No documents yet.</div>
          ) : (
            documents.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium text-primary">{doc.docNumber}</div>
                  <div className="text-sm text-muted-foreground">{doc.title}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline" className={statusBadge(doc.status)}>
                    {doc.status}
                  </Badge>
                  <span>Rev {doc.currentRevisionNumber ?? "-"}</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => router.push(`/dashboard/ims/doc-manager/${doc.id}`)}
                  >
                    Manage
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>New IMS document</DialogTitle>
            <DialogDescription>
              Generate a controlled document ID and create a draft record.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid gap-2">
              <Label>Document type</Label>
              <Select
                value={newDoc.docType}
                onValueChange={(value) =>
                  setNewDoc((prev) => ({ ...prev, docType: value as IMSDocumentType }))
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOC_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label>Document title</Label>
              <Input
                value={newDoc.title}
                onChange={(event) => setNewDoc((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="e.g., Document Control Procedure"
              />
            </div>
            <div className="grid gap-2">
              <Label>ISO 9001 clauses (optional)</Label>
              <Input
                value={newDoc.isoClauses}
                onChange={(event) =>
                  setNewDoc((prev) => ({ ...prev, isoClauses: event.target.value }))
                }
                placeholder="e.g., 7.5, 8.1, 10.2"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              A unique document ID will be issued on save. Upload the revision in the detail view.
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateDoc} disabled={creating}>
              {creating ? "Creating..." : "Create document"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
