"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Timestamp,
  doc,
  setDoc,
} from "firebase/firestore";
import { Bot, RefreshCcw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { generateImsAuditReportAction } from "@/app/actions/ims-auditor";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { IMSAuditReport } from "@/lib/types";

const buildLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
};

const buildAuditId = () => {
  const now = new Date();
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 900 + 100);
  return `AUD-${date}-${random}`;
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

export function ImsAuditorWorkspace() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [auditId, setAuditId] = useState(buildAuditId());
  const [auditDate, setAuditDate] = useState(buildLocalDateString());
  const [status, setStatus] = useState<"planned" | "in_progress" | "completed">("planned");
  const [scope, setScope] = useState("");
  const [period, setPeriod] = useState("");
  const [sites, setSites] = useState("");
  const [processes, setProcesses] = useState("");
  const [leadAuditor, setLeadAuditor] = useState("");
  const [evidenceSources, setEvidenceSources] = useState("");
  const [brief, setBrief] = useState("");
  const [working, setWorking] = useState(false);
  const [latestAuditId, setLatestAuditId] = useState("");
  const [latestPrompt, setLatestPrompt] = useState("");
  const [latestReport, setLatestReport] = useState<IMSAuditReport | null>(null);

  useEffect(() => {
    if (user?.name && !leadAuditor) {
      setLeadAuditor(user.name);
    }
  }, [leadAuditor, user?.name]);

  const parsedSites = useMemo(
    () =>
      sites
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [sites]
  );

  const parsedProcesses = useMemo(
    () =>
      processes
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [processes]
  );

  const handleGenerate = async () => {
    if (!user || user.role !== "admin") return;
    if (!scope.trim()) {
      toast({
        title: "Missing scope",
        description: "Provide the audit scope before generating.",
        variant: "destructive",
      });
      return;
    }
    if (!period.trim()) {
      toast({
        title: "Missing period",
        description: "Provide the audit period.",
        variant: "destructive",
      });
      return;
    }
    if (!leadAuditor.trim()) {
      toast({
        title: "Missing auditor",
        description: "Enter the lead auditor name.",
        variant: "destructive",
      });
      return;
    }

    setWorking(true);
    try {
      const now = Timestamp.now();
      const result = await generateImsAuditReportAction({
        auditId,
        scope: scope.trim(),
        period: period.trim(),
        sites: parsedSites,
        processes: parsedProcesses,
        leadAuditor: leadAuditor.trim(),
        auditDate,
        status,
        evidenceSources: evidenceSources.trim(),
        brief: brief.trim(),
      });

      const report = result.report as IMSAuditReport;
      const resolvedAuditId = report.metadata?.auditId || auditId;
      const payload: Omit<IMSAuditReport, "id"> = {
        ...report,
        prompt: brief.trim(),
        source: "agent",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
        updatedAt: now,
      };

      await setDoc(
        doc(db, COLLECTIONS.IMS_AUDITS, resolvedAuditId),
        pruneUndefined(payload) as IMSAuditReport
      );

      setLatestAuditId(resolvedAuditId);
      setLatestPrompt(brief.trim());
      setLatestReport({ id: resolvedAuditId, ...payload });
      toast({
        title: "Audit generated",
        description: `Saved to ${resolvedAuditId}.`,
      });
    } catch (error) {
      console.error("Audit generation failed:", error);
      const message = error instanceof Error ? error.message : "Unable to generate audit.";
      toast({
        title: "Audit failed",
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
          IMS Auditor access is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-emerald-500/20 backdrop-blur-sm">
          <Bot className="h-8 w-8 text-emerald-300" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">IMS Auditor</h1>
          <p className="text-muted-foreground">
            Draft audit plans, checklists, and findings aligned to ISO 9001:2015.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Audit workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Audit metadata</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAuditId(buildAuditId())}
                  className="gap-1"
                >
                  <RefreshCcw className="h-4 w-4" />
                  Regenerate ID
                </Button>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Audit ID</Label>
                  <Input value={auditId} onChange={(event) => setAuditId(event.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label>Audit date</Label>
                  <Input
                    type="date"
                    value={auditDate}
                    onChange={(event) => setAuditDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Status</Label>
                  <Select
                    value={status}
                    onValueChange={(value) =>
                      setStatus(value as "planned" | "in_progress" | "completed")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="in_progress">In progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label>Lead auditor</Label>
                  <Input
                    value={leadAuditor}
                    onChange={(event) => setLeadAuditor(event.target.value)}
                    placeholder="e.g., Joshua Hyde"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Audit scope</Label>
                <Textarea
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  rows={3}
                  placeholder="Processes, locations, and boundaries."
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Audit period</Label>
                  <Input
                    value={period}
                    onChange={(event) => setPeriod(event.target.value)}
                    placeholder="e.g., Q1 2026 or 2026-01-01 to 2026-03-31"
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Sites (comma-separated)</Label>
                  <Input
                    value={sites}
                    onChange={(event) => setSites(event.target.value)}
                    placeholder="Melbourne HQ, Brisbane Depot"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Processes (comma-separated)</Label>
                <Input
                  value={processes}
                  onChange={(event) => setProcesses(event.target.value)}
                  placeholder="Document Control, Internal Audit, Corrective Action"
                />
              </div>
            </div>

            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Evidence sources</div>
              <Textarea
                value={evidenceSources}
                onChange={(event) => setEvidenceSources(event.target.value)}
                rows={4}
                placeholder="Available records, interviews, observations, and system evidence."
              />
            </div>

            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Additional instruction</div>
              <Textarea
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
                rows={6}
                placeholder="Anything else the auditor should consider."
              />
            </div>

            <div className="flex justify-end">
              <Button onClick={handleGenerate} disabled={working}>
                {working ? "Generating..." : "Generate audit package"}
              </Button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Agent response</div>
                {latestAuditId ? (
                  <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
                    {latestAuditId}
                  </Badge>
                ) : null}
              </div>
              {latestReport ? (
                <>
                  {latestPrompt ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase text-muted-foreground">You</div>
                      <Textarea readOnly rows={6} value={latestPrompt} />
                    </div>
                  ) : null}
                  {latestReport.questions?.length ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      {latestReport.questions.map((question) => (
                        <div key={question}>- {question}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground">Audit JSON</div>
                    <Textarea readOnly rows={16} value={JSON.stringify(latestReport, null, 2)} />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No audit output yet. Fill the inputs and generate.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
