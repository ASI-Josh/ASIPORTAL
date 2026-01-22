"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { ArrowLeft, FileText, Save, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { generateImsDocumentDraftAction } from "@/app/actions/ims-doc-manager";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  IMSDocument,
  IMSAgentDraftOutput,
  IMSDocumentRevision,
  IMSDocumentType,
  IMSDocumentStatus,
  IMSRevisionStatus,
} from "@/lib/types";

const DOC_TYPE_OPTIONS: Array<{ value: IMSDocumentType; label: string }> = [
  { value: "policy", label: "Policy" },
  { value: "manual", label: "IMS Manual" },
  { value: "ims_procedure", label: "IMS Procedure" },
  { value: "technical_procedure", label: "Technical Procedure" },
  { value: "work_instruction", label: "Work Instruction" },
  { value: "form", label: "Form" },
  { value: "register", label: "Register" },
];

const DOC_STATUS_OPTIONS: IMSDocumentStatus[] = ["draft", "active", "obsolete"];
const REVISION_STATUS_OPTIONS: IMSRevisionStatus[] = ["draft", "issued", "obsolete"];

const buildLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
};

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

const pruneUndefined = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value;
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

export default function DocManagerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const docId = params.id as string;

  const [docRecord, setDocRecord] = useState<IMSDocument | null>(null);
  const [revisions, setRevisions] = useState<IMSDocumentRevision[]>([]);
  const [metadata, setMetadata] = useState({
    title: "",
    docType: "ims_procedure" as IMSDocumentType,
    status: "draft" as IMSDocumentStatus,
    isoClauses: "",
  });
  const [savingMeta, setSavingMeta] = useState(false);
  const [newRevision, setNewRevision] = useState({
    issueDate: buildLocalDateString(),
    summary: "",
    status: "issued" as IMSRevisionStatus,
    file: null as File | null,
  });
  const [agentBrief, setAgentBrief] = useState("");
  const [agentIssueDate, setAgentIssueDate] = useState(buildLocalDateString());
  const [agentProcessOwner, setAgentProcessOwner] = useState("");
  const [agentRevision, setAgentRevision] = useState("");
  const [agentWorking, setAgentWorking] = useState(false);
  const [latestDraft, setLatestDraft] = useState<IMSDocumentRevision | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const docRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, docId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setDocRecord(null);
          return;
        }
        const data = snapshot.data() as Omit<IMSDocument, "id">;
        setDocRecord({ id: snapshot.id, ...data });
      },
      () => setDocRecord(null)
    );
    return () => unsubscribe();
  }, [docId]);

  useEffect(() => {
    if (!docRecord) return;
    setMetadata({
      title: docRecord.title,
      docType: docRecord.docType,
      status: docRecord.status,
      isoClauses: docRecord.isoClauses?.join(", ") || "",
    });
    setAgentProcessOwner(docRecord.owner?.name || "");
  }, [docRecord]);

  useEffect(() => {
    const revisionsRef = collection(db, COLLECTIONS.IMS_DOCUMENTS, docId, "revisions");
    const revisionsQuery = query(revisionsRef, orderBy("revisionNumber", "desc"));
    const unsubscribe = onSnapshot(revisionsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<IMSDocumentRevision, "id">),
      }));
      setRevisions(loaded);
    });
    return () => unsubscribe();
  }, [docId]);

  useEffect(() => {
    const pending = revisions.filter(
      (revision) => revision.file?.path && !downloadUrls[revision.id]
    );
    if (pending.length === 0) return;
    pending.forEach((revision) => {
      if (!revision.file?.path) return;
      getDownloadURL(ref(storage, revision.file.path))
        .then((url) => {
          setDownloadUrls((prev) => ({ ...prev, [revision.id]: url }));
        })
        .catch(() => {
          setDownloadUrls((prev) => ({ ...prev, [revision.id]: "" }));
        });
    });
  }, [revisions, downloadUrls]);

  const nextRevisionNumber = useMemo(() => {
    const max = revisions.reduce(
      (current, revision) => Math.max(current, revision.revisionNumber || 0),
      0
    );
    return max + 1;
  }, [revisions]);

  useEffect(() => {
    if (!agentRevision) {
      setAgentRevision(String(nextRevisionNumber));
    }
  }, [agentRevision, nextRevisionNumber]);

  useEffect(() => {
    const draft = revisions.find((revision) => Boolean(revision.draftOutput));
    setLatestDraft(draft || null);
  }, [revisions]);

  const handleSaveMetadata = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!metadata.title.trim()) {
      toast({
        title: "Missing title",
        description: "Document title is required.",
        variant: "destructive",
      });
      return;
    }

    setSavingMeta(true);
    try {
      const now = Timestamp.now();
      const isoClauses = metadata.isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const payload = pruneUndefined({
        title: metadata.title.trim(),
        docType: metadata.docType,
        status: metadata.status,
        isoClauses: isoClauses.length > 0 ? isoClauses : undefined,
        updatedAt: now,
      }) as Partial<IMSDocument>;
      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id), payload);
      toast({
        title: "Document updated",
        description: "Metadata saved successfully.",
      });
    } catch (error) {
      console.error("Failed to update document:", error);
      toast({
        title: "Update failed",
        description: "Unable to save changes.",
        variant: "destructive",
      });
    } finally {
      setSavingMeta(false);
    }
  };

  const handleUploadRevision = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!newRevision.file) {
      toast({
        title: "Missing file",
        description: "Attach a revision file before uploading.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const now = Timestamp.now();
      const issueDate = newRevision.issueDate
        ? Timestamp.fromDate(new Date(newRevision.issueDate))
        : now;
      const revisionId = `rev-${String(nextRevisionNumber).padStart(3, "0")}`;
      const safeName = newRevision.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `ims-documents/${docRecord.id}/${revisionId}/${safeName}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, newRevision.file);

      const revisionPayload: Omit<IMSDocumentRevision, "id"> = {
        revisionNumber: nextRevisionNumber,
        issueDate,
        status: newRevision.status,
        summary: newRevision.summary.trim() || undefined,
        file: {
          name: newRevision.file.name,
          path: filePath,
          contentType: newRevision.file.type || undefined,
          size: newRevision.file.size,
        },
        isCurrent: newRevision.status === "issued",
        source: "manual",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };

      await setDoc(
        doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id, "revisions", revisionId),
        pruneUndefined(revisionPayload) as IMSDocumentRevision
      );

      if (docRecord.currentRevisionId && newRevision.status === "issued") {
        await updateDoc(
          doc(
            db,
            COLLECTIONS.IMS_DOCUMENTS,
            docRecord.id,
            "revisions",
            docRecord.currentRevisionId
          ),
          {
            isCurrent: false,
            status: "obsolete",
          }
        );
      }

      const nextDocStatus = newRevision.status === "issued" ? "active" : docRecord.status;
      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id), {
        currentRevisionId: newRevision.status === "issued" ? revisionId : docRecord.currentRevisionId,
        currentRevisionNumber:
          newRevision.status === "issued" ? nextRevisionNumber : docRecord.currentRevisionNumber,
        currentIssueDate: newRevision.status === "issued" ? issueDate : docRecord.currentIssueDate,
        currentFile:
          newRevision.status === "issued"
            ? revisionPayload.file
            : docRecord.currentFile || undefined,
        status: nextDocStatus,
        updatedAt: now,
      });

      setNewRevision({
        issueDate: buildLocalDateString(),
        summary: "",
        status: "issued",
        file: null,
      });
      toast({
        title: "Revision saved",
        description: "New revision has been issued.",
      });
    } catch (error) {
      console.error("Failed to upload revision:", error);
      toast({
        title: "Upload failed",
        description: "Unable to save this revision.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!agentBrief.trim()) {
      toast({
        title: "Missing brief",
        description: "Provide document requirements before generating a draft.",
        variant: "destructive",
      });
      return;
    }

    setAgentWorking(true);
    try {
      const isoClauses = metadata.isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await generateImsDocumentDraftAction({
        docNumber: docRecord.docNumber,
        title: metadata.title.trim() || docRecord.title,
        docType: metadata.docType,
        revision: agentRevision || String(nextRevisionNumber),
        issueDate: agentIssueDate,
        processOwner: agentProcessOwner,
        isoClauses,
        relatedDocs: [],
        brief: agentBrief,
      });
      const now = Timestamp.now();
      const revisionNumber = Number.parseInt(agentRevision, 10) || nextRevisionNumber;
      const revisionId = `draft-${revisionNumber}-${Date.now()}`;
      const draftOutput = result.draft as IMSAgentDraftOutput;
      const revisionPayload: Omit<IMSDocumentRevision, "id"> = {
        revisionNumber,
        issueDate: agentIssueDate
          ? Timestamp.fromDate(new Date(agentIssueDate))
          : now,
        status: "draft",
        summary: "AI draft generated",
        draftOutput,
        isCurrent: false,
        source: "agent",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };
      await setDoc(
        doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id, "revisions", revisionId),
        pruneUndefined(revisionPayload) as IMSDocumentRevision
      );
      toast({
        title: "Draft generated",
        description: "Agent draft saved to revision history.",
      });
    } catch (error) {
      console.error("Failed to generate draft:", error);
      const message =
        error instanceof Error ? error.message : "Unable to generate draft.";
      toast({
        title: "Draft failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAgentWorking(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Doc Manager is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  if (!docRecord) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/doc-manager")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to doc manager
        </Button>
        <div className="text-muted-foreground">Document not found.</div>
      </div>
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
            <h1 className="text-3xl font-bold">{docRecord.docNumber}</h1>
            <p className="text-muted-foreground">{docRecord.title}</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/doc-manager")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to doc manager
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Document metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <Label>Title</Label>
            <Input
              value={metadata.title}
              onChange={(event) => setMetadata((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Document type</Label>
            <Select
              value={metadata.docType}
              onValueChange={(value) =>
                setMetadata((prev) => ({ ...prev, docType: value as IMSDocumentType }))
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
            <Label>Status</Label>
            <Select
              value={metadata.status}
              onValueChange={(value) =>
                setMetadata((prev) => ({ ...prev, status: value as IMSDocumentStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>ISO 9001 clauses</Label>
            <Input
              value={metadata.isoClauses}
              onChange={(event) =>
                setMetadata((prev) => ({ ...prev, isoClauses: event.target.value }))
              }
              placeholder="Comma-separated, e.g., 7.5, 8.1"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleSaveMetadata} disabled={savingMeta}>
              <Save className="mr-2 h-4 w-4" />
              {savingMeta ? "Saving..." : "Save metadata"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Upload new revision</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Next revision</Label>
            <Input value={`Rev ${nextRevisionNumber}`} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Issue date</Label>
            <Input
              type="date"
              value={newRevision.issueDate}
              onChange={(event) =>
                setNewRevision((prev) => ({ ...prev, issueDate: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={newRevision.status}
              onValueChange={(value) =>
                setNewRevision((prev) => ({ ...prev, status: value as IMSRevisionStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVISION_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:col-span-3">
            <Label>Revision summary</Label>
            <Textarea
              value={newRevision.summary}
              onChange={(event) =>
                setNewRevision((prev) => ({ ...prev, summary: event.target.value }))
              }
              placeholder="Describe the revision changes"
            />
          </div>
          <div className="grid gap-2 md:col-span-3">
            <Label>Revision file</Label>
            <Input
              type="file"
              onChange={(event) =>
                setNewRevision((prev) => ({
                  ...prev,
                  file: event.target.files?.[0] || null,
                }))
              }
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <Button onClick={handleUploadRevision} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload revision"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Generate AI draft</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Draft revision</Label>
            <Input
              value={agentRevision}
              onChange={(event) => setAgentRevision(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Issue date</Label>
            <Input
              type="date"
              value={agentIssueDate}
              onChange={(event) => setAgentIssueDate(event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>Process owner</Label>
            <Input
              value={agentProcessOwner}
              onChange={(event) => setAgentProcessOwner(event.target.value)}
            />
          </div>
          <div className="grid gap-2 md:col-span-3">
            <Label>Agent brief (include purpose, scope, records, risks, verification)</Label>
            <Textarea
              value={agentBrief}
              onChange={(event) => setAgentBrief(event.target.value)}
              placeholder="Provide the required inputs so the agent can draft the document."
              rows={6}
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <Button onClick={handleGenerateDraft} disabled={agentWorking}>
              {agentWorking ? "Generating..." : "Generate draft with agent"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {latestDraft?.draftOutput ? (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Latest agent draft</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {latestDraft.draftOutput.questions?.length ? (
              <div className="text-sm text-amber-400">
                {latestDraft.draftOutput.questions.map((question) => (
                  <div key={question}>• {question}</div>
                ))}
              </div>
            ) : null}
            <Textarea
              readOnly
              rows={12}
              value={JSON.stringify(latestDraft.draftOutput, null, 2)}
            />
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Revision history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {revisions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No revisions issued yet.</div>
          ) : (
            revisions.map((revision) => (
              <div
                key={revision.id}
                className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium">
                    Rev {revision.revisionNumber} {revision.isCurrent ? "(Current)" : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Issued {revision.issueDate?.toDate?.().toLocaleDateString("en-AU")}
                  </div>
                  {revision.summary ? (
                    <div className="text-sm text-muted-foreground">{revision.summary}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant="outline"
                    className={statusBadge(
                      revision.status === "issued"
                        ? "active"
                        : revision.status === "obsolete"
                          ? "obsolete"
                          : "draft"
                    )}
                  >
                    {revision.status}
                  </Badge>
                  {revision.file?.name ? (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      disabled={!downloadUrls[revision.id]}
                    >
                      <a
                        href={downloadUrls[revision.id] || "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download
                      </a>
                    </Button>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
