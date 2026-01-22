"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Timestamp, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { ArrowLeft, ClipboardCheck, Save } from "lucide-react";

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
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { PrestartCheck, PrestartIssue } from "@/lib/types";

const ISSUE_STATUS_OPTIONS: Array<PrestartIssue["status"]> = [
  "open",
  "in_progress",
  "closed",
];

const formatDate = (value?: Timestamp | string) => {
  if (!value) return "-";
  const date =
    typeof value === "string"
      ? new Date(value)
      : value?.toDate
        ? value.toDate()
        : new Date(value as unknown as string);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

const formatDateTime = (value?: Timestamp | string) => {
  if (!value) return "-";
  const date =
    typeof value === "string"
      ? new Date(value)
      : value?.toDate
        ? value.toDate()
        : new Date(value as unknown as string);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
};

const formatDateInput = (value?: Timestamp) =>
  value?.toDate?.().toISOString().split("T")[0] || "";

const statusBadge = (value: boolean) =>
  value
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

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

export default function PrestartRegisterDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const checkId = params.id as string;

  const [check, setCheck] = useState<PrestartCheck | null>(null);
  const [issues, setIssues] = useState<PrestartIssue[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const checkRef = doc(db, COLLECTIONS.PRESTART_CHECKS, checkId);
    const unsubscribe = onSnapshot(
      checkRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setCheck(null);
          return;
        }
        const data = snapshot.data() as Omit<PrestartCheck, "id">;
        setCheck({ id: snapshot.id, ...data });
      },
      (error) => {
        console.warn("Failed to load prestart:", error);
        setCheck(null);
      }
    );
    return () => unsubscribe();
  }, [checkId]);

  useEffect(() => {
    if (!check) return;
    setIssues(check.issues || []);
  }, [check]);

  const issueSummary = useMemo(() => {
    const total = issues.length;
    const open = issues.filter((issue) => issue.status !== "closed").length;
    return { total, open };
  }, [issues]);

  const updateIssue = (id: string, updates: Partial<PrestartIssue>) => {
    setIssues((prev) => prev.map((issue) => (issue.id === id ? { ...issue, ...updates } : issue)));
  };

  const handleSave = async () => {
    if (!check) return;
    if (!user) {
      toast({
        title: "Not signed in",
        description: "Please sign in again and retry.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const now = Timestamp.now();
    const changedBy = user.name || user.email || user.uid;

    const nextIssues = issues.map((issue) => {
      if (issue.status === "closed") {
        return pruneUndefined({
          ...issue,
          closedAt: issue.closedAt || now,
          closedBy: issue.closedBy || changedBy,
        }) as PrestartIssue;
      }
      return pruneUndefined({
        ...issue,
        closedAt: undefined,
        closedBy: undefined,
      }) as PrestartIssue;
    });

    try {
      await updateDoc(doc(db, COLLECTIONS.PRESTART_CHECKS, check.id), {
        issues: nextIssues,
        updatedAt: now,
      });
      toast({
        title: "Corrective actions updated",
        description: "Prestart record updated successfully.",
      });
    } catch (error) {
      console.error("Failed to update prestart:", error);
      toast({
        title: "Update failed",
        description: "Unable to save changes.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (!check) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/prestart-register")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to register
        </Button>
        <div className="text-muted-foreground">Prestart record not found.</div>
      </div>
    );
  }

  const checklist = check.checklist;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-emerald-500/20 backdrop-blur-sm">
            <ClipboardCheck className="h-8 w-8 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Prestart Record</h1>
            <p className="text-muted-foreground">
              {check.prestartDate} - {check.createdByName}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => router.push("/dashboard/ims/prestart-register")}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to register
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving..." : "Save updates"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Submitted</div>
            <div className="text-lg font-semibold">{formatDateTime(check.createdAt)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Updated</div>
            <div className="text-lg font-semibold">{formatDateTime(check.updatedAt)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-xs text-muted-foreground">Corrective actions</div>
            <div className="text-lg font-semibold">
              {issueSummary.open} open / {issueSummary.total} total
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Checklist summary</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center justify-between">
            <span>Tools and equipment on board</span>
            <Badge variant="outline" className={statusBadge(checklist.toolsReady)}>
              {checklist.toolsReady ? "OK" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Consumables ready</span>
            <Badge variant="outline" className={statusBadge(checklist.consumablesReady)}>
              {checklist.consumablesReady ? "OK" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Devices charged</span>
            <Badge variant="outline" className={statusBadge(checklist.devicesCharged)}>
              {checklist.devicesCharged ? "OK" : "Missing"}
            </Badge>
          </div>
          {checklist.toolsNotes ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">
              Tools notes: {checklist.toolsNotes}
            </div>
          ) : null}
          {checklist.consumablesNotes ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">
              Consumables notes: {checklist.consumablesNotes}
            </div>
          ) : null}
          {checklist.devicesNotes ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">
              Devices notes: {checklist.devicesNotes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Required kits</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between">
            <span>Crack Repair Kit</span>
            <Badge variant="outline" className={statusBadge(checklist.kits.crackRepairKit)}>
              {checklist.kits.crackRepairKit ? "OK" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Scratch Removal Kit</span>
            <Badge variant="outline" className={statusBadge(checklist.kits.scratchRemovalKit)}>
              {checklist.kits.scratchRemovalKit ? "OK" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Trim Repair Kit</span>
            <Badge variant="outline" className={statusBadge(checklist.kits.trimRepairKit)}>
              {checklist.kits.trimRepairKit ? "OK" : "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Film Installation Kit</span>
            <Badge variant="outline" className={statusBadge(checklist.kits.filmInstallationKit)}>
              {checklist.kits.filmInstallationKit ? "OK" : "Missing"}
            </Badge>
          </div>
          {checklist.kitNotes ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">
              {checklist.kitNotes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Vehicle safety inspection</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <div className="flex items-center justify-between">
            <span>Tyres & pressure</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.tyresOk)}>
              {checklist.vehicleSafety.tyresOk ? "OK" : "Check"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Lights & indicators</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.lightsOk)}>
              {checklist.vehicleSafety.lightsOk ? "OK" : "Check"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Fluids & leaks</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.fluidsOk)}>
              {checklist.vehicleSafety.fluidsOk ? "OK" : "Check"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Safety equipment & first aid</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.safetyEquipmentOk)}>
              {checklist.vehicleSafety.safetyEquipmentOk ? "OK" : "Check"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Registration & compliance stickers</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.registrationOk)}>
              {checklist.vehicleSafety.registrationOk ? "OK" : "Check"}
            </Badge>
          </div>
          <div className="flex items-center justify-between">
            <span>Cab clean & secure load</span>
            <Badge variant="outline" className={statusBadge(checklist.vehicleSafety.cabCleanOk)}>
              {checklist.vehicleSafety.cabCleanOk ? "OK" : "Check"}
            </Badge>
          </div>
          {checklist.vehicleNotes ? (
            <div className="md:col-span-2 text-sm text-muted-foreground">
              {checklist.vehicleNotes}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Corrective actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {issues.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No corrective actions logged for this prestart.
            </div>
          ) : (
            issues.map((issue) => (
              <Card key={issue.id} className="bg-background/60 border-border/40">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-semibold">{issue.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {issue.category || "Uncategorised"} - Logged by {issue.createdByName}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        issue.status === "closed"
                          ? "bg-green-500/20 text-green-400 border-green-500/30"
                          : "bg-amber-500/20 text-amber-400 border-amber-500/30"
                      }
                    >
                      {issue.status.replace("_", " ")}
                    </Badge>
                  </div>

                  {issue.description ? (
                    <div className="text-sm text-muted-foreground">{issue.description}</div>
                  ) : null}

                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="grid gap-2">
                      <Label>Status</Label>
                      <Select
                        value={issue.status}
                        onValueChange={(value) =>
                          updateIssue(issue.id, { status: value as PrestartIssue["status"] })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ISSUE_STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {status.replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid gap-2">
                      <Label>Target close-out date</Label>
                      <Input
                        type="date"
                        value={formatDateInput(issue.dueDate)}
                        onChange={(event) =>
                          updateIssue(issue.id, {
                            dueDate: event.target.value
                              ? Timestamp.fromDate(new Date(event.target.value))
                              : undefined,
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label>Closed at</Label>
                      <Input value={formatDate(issue.closedAt)} readOnly />
                    </div>
                  </div>

                  <div className="grid gap-2">
                    <Label>Closure notes</Label>
                    <Textarea
                      value={issue.closureNotes || ""}
                      onChange={(event) =>
                        updateIssue(issue.id, { closureNotes: event.target.value })
                      }
                      placeholder="Record closure notes or verification."
                    />
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </CardContent>
      </Card>

      {check.notes ? (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>Additional notes</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {check.notes}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
