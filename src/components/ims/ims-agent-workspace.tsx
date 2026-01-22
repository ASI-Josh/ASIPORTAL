"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  doc,
  getDoc,
  runTransaction,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { Bot, ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { generateImsDocumentDraftAction } from "@/app/actions/ims-doc-manager";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  IMSAgentDraftOutput,
  IMSDocument,
  IMSDocumentRevision,
  IMSDocumentType,
} from "@/lib/types";

type AgentWorkspaceProps = {
  heading: string;
  description: string;
  defaultDocType?: IMSDocumentType;
  defaultTitle?: string;
  defaultBrief?: string;
};

const DOC_TYPE_OPTIONS: Array<{ value: IMSDocumentType; label: string; prefix: string }> = [
  { value: "policy", label: "Policy", prefix: "POL" },
  { value: "manual", label: "IMS Manual", prefix: "MAN" },
  { value: "ims_procedure", label: "IMS Procedure", prefix: "IMS-PROC" },
  { value: "technical_procedure", label: "Technical Procedure", prefix: "TECH-PROC" },
  { value: "work_instruction", label: "Work Instruction", prefix: "WI" },
  { value: "form", label: "Form", prefix: "FRM" },
  { value: "register", label: "Register", prefix: "REG" },
];

const buildLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
};

const formatDocNumber = (prefix: string, value: number) =>
  `${prefix}-${String(value).padStart(3, "0")}`;

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

const buildAgentTemplate = ({
  title,
  docType,
  processOwner,
  isoClauses,
  relatedDocs,
}: {
  title: string;
  docType: IMSDocumentType;
  processOwner: string;
  isoClauses: string;
  relatedDocs: string;
}) =>
  [
    `Document title: ${title || "TBD"}`,
    `Document type: ${docType}`,
    `Process owner: ${processOwner || "TBD"}`,
    `ISO clauses: ${isoClauses || "TBD"}`,
    `Related documents: ${relatedDocs || "None"}`,
    "",
    "Purpose:",
    "Scope:",
    "Inputs/outputs:",
    "Records produced:",
    "Key risks/controls:",
    "Verification/monitoring:",
    "Tools/equipment/systems:",
    "Process steps (high level):",
    "Responsibilities:",
    "Notes/constraints:",
  ].join("\n");

export function ImsAgentWorkspace({
  heading,
  description,
  defaultDocType = "ims_procedure",
  defaultTitle = "",
  defaultBrief = "",
}: AgentWorkspaceProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState<"new" | "existing">("new");
  const [docNumber, setDocNumber] = useState("");
  const [title, setTitle] = useState(defaultTitle);
  const [docType, setDocType] = useState<IMSDocumentType>(defaultDocType);
  const [isoClauses, setIsoClauses] = useState("");
  const [relatedDocs, setRelatedDocs] = useState("");
  const [revision, setRevision] = useState("0");
  const [issueDate, setIssueDate] = useState(buildLocalDateString());
  const [processOwner, setProcessOwner] = useState("");
  const [brief, setBrief] = useState(defaultBrief);
  const [working, setWorking] = useState(false);
  const [latestDocNumber, setLatestDocNumber] = useState("");
  const [latestPrompt, setLatestPrompt] = useState("");
  const [latestDraft, setLatestDraft] = useState<IMSAgentDraftOutput | null>(null);

  const parsedIsoClauses = useMemo(
    () =>
      isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [isoClauses]
  );

  const parsedRelatedDocs = useMemo(
    () =>
      relatedDocs
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [relatedDocs]
  );

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

  const handleGenerate = async () => {
    if (!user || user.role !== "admin") return;
    if (!brief.trim()) {
      toast({
        title: "Missing instruction",
        description: "Provide a clear instruction for the agent.",
        variant: "destructive",
      });
      return;
    }
    if (mode === "new" && !title.trim()) {
      toast({
        title: "Missing title",
        description: "New documents need a title.",
        variant: "destructive",
      });
      return;
    }
    if (mode === "existing" && !docNumber.trim()) {
      toast({
        title: "Missing doc number",
        description: "Enter the document ID to attach this draft.",
        variant: "destructive",
      });
      return;
    }

    setWorking(true);
    try {
      const now = Timestamp.now();
      let workingDocNumber = docNumber.trim();
      let workingTitle = title.trim();
      let workingType = docType;
      let workingIsoClauses = parsedIsoClauses;

      if (mode === "existing") {
        const existingRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, workingDocNumber);
        const existingSnap = await getDoc(existingRef);
        if (!existingSnap.exists()) {
          throw new Error("Document not found. Check the ID or create a new document.");
        }
        const existing = existingSnap.data() as Omit<IMSDocument, "id">;
        workingTitle = existing.title;
        workingType = existing.docType;
        if (!workingIsoClauses.length && existing.isoClauses?.length) {
          workingIsoClauses = existing.isoClauses;
        }
      } else {
        const option = DOC_TYPE_OPTIONS.find((item) => item.value === workingType);
        if (!option) {
          throw new Error("Invalid document type.");
        }
        const reservation = await reserveDocNumber(option.prefix);
        workingDocNumber = reservation.docNumber;
        const payload: Omit<IMSDocument, "id"> = {
          docNumber: workingDocNumber,
          title: workingTitle,
          docType: workingType,
          status: "draft",
          owner: {
            id: user.uid,
            name: user.name || user.email || "Admin",
            email: user.email || undefined,
          },
          isoClauses: workingIsoClauses.length > 0 ? workingIsoClauses : undefined,
          createdAt: now,
          createdById: user.uid,
          createdByName: user.name || user.email || "Admin",
          createdByEmail: user.email || undefined,
          updatedAt: now,
        };
        await setDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, workingDocNumber), payload);
      }

      const result = await generateImsDocumentDraftAction({
        docNumber: workingDocNumber,
        title: workingTitle,
        docType: workingType,
        revision: revision || "0",
        issueDate,
        processOwner,
        isoClauses: workingIsoClauses,
        relatedDocs: parsedRelatedDocs,
        brief: brief.trim(),
      });

      const revisionNumber = Number.parseInt(revision, 10) || 0;
      const revisionId = `draft-${revisionNumber}-${Date.now()}`;
      const draftOutput = result.draft as IMSAgentDraftOutput;
      const revisionPayload: Omit<IMSDocumentRevision, "id"> = {
        revisionNumber,
        issueDate: issueDate ? Timestamp.fromDate(new Date(issueDate)) : now,
        status: "draft",
        summary: "AI draft generated",
        draftOutput,
        draftPrompt: brief.trim(),
        isCurrent: false,
        source: "agent",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };
      await setDoc(
        doc(db, COLLECTIONS.IMS_DOCUMENTS, workingDocNumber, "revisions", revisionId),
        pruneUndefined(revisionPayload) as IMSDocumentRevision
      );

      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, workingDocNumber), {
        updatedAt: now,
      });

      setLatestDocNumber(workingDocNumber);
      setLatestPrompt(brief.trim());
      setLatestDraft(draftOutput);
      toast({
        title: "Draft generated",
        description: `Saved to ${workingDocNumber}.`,
      });
    } catch (error) {
      console.error("Agent draft failed:", error);
      const message = error instanceof Error ? error.message : "Unable to generate draft.";
      toast({
        title: "Draft failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setWorking(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Doc Manager agent access is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
          <Bot className="h-8 w-8 text-sky-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">{heading}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Agent workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Document target</div>
              <Tabs value={mode} onValueChange={(value) => setMode(value as "new" | "existing")}>
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="new">New document</TabsTrigger>
                  <TabsTrigger value="existing">Existing document</TabsTrigger>
                </TabsList>
                <TabsContent value="new" className="mt-4 space-y-3">
                  <div className="grid gap-2">
                    <Label>Document title</Label>
                    <Input
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                      placeholder="e.g., Document Control Procedure"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label>Document type</Label>
                    <Select
                      value={docType}
                      onValueChange={(value) => setDocType(value as IMSDocumentType)}
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
                    <Label>ISO 9001 clauses</Label>
                    <Input
                      value={isoClauses}
                      onChange={(event) => setIsoClauses(event.target.value)}
                      placeholder="7.5, 8.1, 10.2"
                    />
                  </div>
                </TabsContent>
                <TabsContent value="existing" className="mt-4 space-y-3">
                  <div className="grid gap-2">
                    <Label>Document ID</Label>
                    <Input
                      value={docNumber}
                      onChange={(event) => setDocNumber(event.target.value)}
                      placeholder="IMS-PROC-001"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Use this to add a new draft revision to an existing document.
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Draft settings</div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Revision</Label>
                  <Input value={revision} onChange={(event) => setRevision(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Issue date</Label>
                  <Input
                    type="date"
                    value={issueDate}
                    onChange={(event) => setIssueDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Process owner</Label>
                  <Input
                    value={processOwner}
                    onChange={(event) => setProcessOwner(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Related documents (comma-separated)</Label>
                <Input
                  value={relatedDocs}
                  onChange={(event) => setRelatedDocs(event.target.value)}
                  placeholder="IMS-PROC-001, POL-002"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Your instruction</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setBrief(
                        buildAgentTemplate({
                          title: title.trim(),
                          docType,
                          processOwner,
                          isoClauses,
                          relatedDocs,
                        })
                      )
                    }
                  >
                    Insert template
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setBrief("")}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                placeholder="Tell the agent what to draft (purpose, scope, records, risks, verification, tools)."
                rows={10}
              />
              <div className="text-xs text-muted-foreground">
                This instruction is stored with the draft for traceability.
              </div>
            </div>

            <div className="flex justify-end">
              <Button onClick={handleGenerate} disabled={working}>
                {working ? "Generating..." : "Generate draft with agent"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Agent response</div>
                {latestDocNumber ? (
                  <Badge variant="outline" className="border-sky-500/40 text-sky-300">
                    {latestDocNumber}
                  </Badge>
                ) : null}
              </div>
              {latestDocNumber ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push(`/dashboard/ims/doc-manager/${latestDocNumber}`)}
                  className="gap-2"
                >
                  <ExternalLink className="h-4 w-4" />
                  Open document
                </Button>
              ) : null}
              {latestDraft ? (
                <>
                  {latestPrompt ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase text-muted-foreground">You</div>
                      <Textarea readOnly rows={6} value={latestPrompt} />
                    </div>
                  ) : null}
                  {latestDraft.questions?.length ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      {latestDraft.questions.map((question) => (
                        <div key={question}>- {question}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground">Agent draft (JSON)</div>
                    <Textarea readOnly rows={14} value={JSON.stringify(latestDraft, null, 2)} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No agent draft yet. Use the instruction panel to generate one.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
