"use client";

/**
 * IMS Auditor — internal audit management and CAPA tracking.
 *
 * Rebuilt 2026-04-10 to replace the fake "audit report draft form" a
 * previous GPT-driven build dropped in. That version was a fill-out-a-form
 * page that called OpenAI to generate an audit pack, stored it once, and
 * did nothing else. It had no schedule view, no audit list, no CAPA
 * closeout tracking, and no calendar integration.
 *
 * This rebuild gives GUARDIAN and the Director a real audit management
 * dashboard:
 *
 *   1. 12-month audit schedule — visual month-by-month grid for the next
 *      12 months, showing every scheduled/planned audit by standard.
 *      Click a month to schedule a new audit on that month.
 *
 *   2. Audit list — every audit in imsAudits via live onSnapshot, grouped
 *      by status (scheduled → planned → in_progress → completed → cancelled).
 *      Each audit has inline transitions: Mark In Progress, Mark Complete,
 *      Cancel, Add Calendar Event.
 *
 *   3. CAPA tracker — all open/in-progress corrective actions via live
 *      onSnapshot against imsCorrectiveActions, with owner, due date,
 *      status, and one-click human closeout with closure notes.
 *
 *   4. Summary stats — open audits, overdue CAPAs, ISO coverage, etc.
 *
 * The audit pack (plan, checklist, findings) generation still happens via
 * GUARDIAN chat on the IMS Filing hub page. This page is for management
 * and tracking, not drafting.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import {
  AlertTriangle,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ClipboardCheck,
  Clock,
  Eye,
  Loader2,
  PlayCircle,
  Plus,
  ShieldAlert,
  ShieldCheck,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { ScheduleAuditModal } from "@/components/ims/ScheduleAuditModal";
import { cn } from "@/lib/utils";

// ─── Types — local shapes mirror the Firestore documents ─────────────────────

type AuditStatus = "scheduled" | "planned" | "in_progress" | "completed" | "cancelled";

interface AuditMetadata {
  auditId: string;
  standard: string;
  auditType?: string;
  scope: string;
  period?: string;
  sites?: string[];
  processes?: string[];
  leadAuditor: string;
  auditDate: string;
  plannedDate?: string;
  status: AuditStatus;
  scheduledBy?: string;
  scheduledAt?: string;
  calendarEventId?: string | null;
}

interface AuditFinding {
  id: string;
  type: string;
  clause: string;
  description: string;
  owner?: string;
  dueDate?: string;
  status?: string;
}

interface AuditRecord {
  id: string;
  metadata: AuditMetadata;
  findings?: AuditFinding[];
  summary?: { overallConclusion?: string; strengths?: string[]; risks?: string[] };
}

type CapaStatus = "open" | "in_progress" | "closed";

interface CapaRecord {
  id: string;
  title: string;
  description?: string;
  domain?: "quality" | "environmental" | "whs";
  priority?: "low" | "medium" | "high" | "critical";
  status: CapaStatus;
  ownerName?: string;
  dueDate?: string;
  sourceType?: string;
  sourceId?: string;
  sourceLabel?: string;
  isoClauses?: string[];
  progressNotes?: string;
  closureNotes?: string;
  closedByName?: string;
  closedAt?: Timestamp | null;
  createdAt?: Timestamp;
}

// ─── Style helpers ──────────────────────────────────────────────────────────

const AUDIT_STATUS_STYLE: Record<AuditStatus, string> = {
  scheduled: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  planned: "bg-violet-500/15 text-violet-300 border-violet-500/30",
  in_progress: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  completed: "bg-green-500/15 text-green-300 border-green-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
};

const CAPA_STATUS_STYLE: Record<CapaStatus, string> = {
  open: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  in_progress: "bg-sky-500/15 text-sky-300 border-sky-500/30",
  closed: "bg-green-500/15 text-green-300 border-green-500/30",
};

const CAPA_PRIORITY_STYLE: Record<string, string> = {
  low: "bg-zinc-500/15 text-zinc-300 border-zinc-500/30",
  medium: "bg-blue-500/15 text-blue-300 border-blue-500/30",
  high: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  critical: "bg-red-500/15 text-red-300 border-red-500/30",
};

function formatDate(v: string | Timestamp | undefined | null): string {
  if (!v) return "—";
  if (typeof v === "string") return v;
  try {
    return v.toDate().toISOString().split("T")[0];
  } catch {
    return "—";
  }
}

function daysUntil(dateStr: string | undefined | null): number | null {
  if (!dateStr) return null;
  try {
    const target = new Date(dateStr).getTime();
    const now = Date.now();
    return Math.floor((target - now) / (1000 * 60 * 60 * 24));
  } catch {
    return null;
  }
}

// ─── 12-month schedule view ─────────────────────────────────────────────────

interface MonthSlot {
  year: number;
  month: number; // 0-indexed
  label: string;
  audits: AuditRecord[];
}

function buildNext12MonthsSchedule(audits: AuditRecord[]): MonthSlot[] {
  const now = new Date();
  const slots: MonthSlot[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    slots.push({
      year: d.getFullYear(),
      month: d.getMonth(),
      label: d.toLocaleDateString("en-AU", { month: "short", year: "numeric" }),
      audits: [],
    });
  }
  for (const audit of audits) {
    const plannedDate = audit.metadata.plannedDate || audit.metadata.auditDate;
    if (!plannedDate) continue;
    try {
      const d = new Date(plannedDate);
      const slot = slots.find((s) => s.year === d.getFullYear() && s.month === d.getMonth());
      if (slot) slot.audits.push(audit);
    } catch {
      // invalid date — skip
    }
  }
  return slots;
}

function firstOfMonth(slot: MonthSlot): string {
  return `${slot.year}-${String(slot.month + 1).padStart(2, "0")}-01`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ImsAuditorPage() {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();

  // ── Live audits ───────────────────────────────────────────────────────────
  const [audits, setAudits] = useState<AuditRecord[]>([]);
  const [auditsLoading, setAuditsLoading] = useState(true);
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.IMS_AUDITS),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => {
          const data = d.data() as Partial<AuditRecord>;
          return {
            id: d.id,
            metadata: (data.metadata as AuditMetadata) || {
              auditId: d.id,
              standard: "Integrated",
              scope: "(no scope set)",
              leadAuditor: "Unknown",
              auditDate: "",
              status: "scheduled" as AuditStatus,
            },
            findings: (data.findings as AuditFinding[]) || [],
            summary: data.summary,
          } as AuditRecord;
        });
        setAudits(items);
        setAuditsLoading(false);
      },
      () => setAuditsLoading(false)
    );
    return () => unsub();
  }, []);

  // ── Live CAPAs ────────────────────────────────────────────────────────────
  const [capas, setCapas] = useState<CapaRecord[]>([]);
  const [capasLoading, setCapasLoading] = useState(true);
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        const items = snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<CapaRecord, "id">),
        }));
        setCapas(items);
        setCapasLoading(false);
      },
      () => setCapasLoading(false)
    );
    return () => unsub();
  }, []);

  // ── Schedule modal state ──────────────────────────────────────────────────
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleDefault, setScheduleDefault] = useState<string | undefined>(undefined);

  // ── CAPA closeout state ───────────────────────────────────────────────────
  const [closureNotes, setClosureNotes] = useState<Record<string, string>>({});
  const [capaSaving, setCapaSaving] = useState<string | null>(null);
  const [auditSaving, setAuditSaving] = useState<string | null>(null);

  // ── Derived views ─────────────────────────────────────────────────────────
  const schedule = useMemo(() => buildNext12MonthsSchedule(audits), [audits]);

  const auditsByStatus = useMemo(() => {
    const out: Record<AuditStatus, AuditRecord[]> = {
      scheduled: [],
      planned: [],
      in_progress: [],
      completed: [],
      cancelled: [],
    };
    for (const a of audits) {
      const status = a.metadata.status || "scheduled";
      if (out[status]) out[status].push(a);
    }
    return out;
  }, [audits]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().split("T")[0];
    const openAudits = audits.filter((a) => ["scheduled", "planned", "in_progress"].includes(a.metadata.status)).length;
    const dueThisMonth = audits.filter((a) => {
      const d = a.metadata.plannedDate || a.metadata.auditDate;
      if (!d) return false;
      const audit = new Date(d);
      const now = new Date();
      return (
        audit.getFullYear() === now.getFullYear() &&
        audit.getMonth() === now.getMonth() &&
        a.metadata.status !== "completed" &&
        a.metadata.status !== "cancelled"
      );
    }).length;
    const completedYtd = audits.filter((a) => {
      if (a.metadata.status !== "completed") return false;
      const d = a.metadata.auditDate;
      if (!d) return false;
      return new Date(d).getFullYear() === new Date().getFullYear();
    }).length;
    const openCapas = capas.filter((c) => c.status === "open" || c.status === "in_progress").length;
    const overdueCapas = capas.filter((c) => {
      if (c.status === "closed") return false;
      if (!c.dueDate) return false;
      return c.dueDate < today;
    }).length;
    return { openAudits, dueThisMonth, completedYtd, openCapas, overdueCapas };
  }, [audits, capas]);

  // ── Audit state transitions ───────────────────────────────────────────────
  const transitionAudit = async (auditId: string, nextStatus: AuditStatus) => {
    setAuditSaving(auditId);
    try {
      const audit = audits.find((a) => a.id === auditId);
      if (!audit) throw new Error("Audit not found.");
      await updateDoc(doc(db, COLLECTIONS.IMS_AUDITS, auditId), {
        metadata: {
          ...audit.metadata,
          status: nextStatus,
        },
        updatedAt: Timestamp.now(),
      });
      toast({
        title: "Audit updated",
        description: `${audit.metadata.auditId} → ${nextStatus.replace("_", " ")}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Update failed.";
      toast({ title: "Transition failed", description: message, variant: "destructive" });
    } finally {
      setAuditSaving(null);
    }
  };

  // ── Calendar event creation ──────────────────────────────────────────────
  // Uses the existing /api/google/calendar/create-event route which expects
  // { summary, description, start, end } as ISO datetime strings with
  // Australia/Sydney timezone. Requires Bearer auth via firebaseUser ID token.
  const addCalendarEvent = async (audit: AuditRecord) => {
    if (!firebaseUser) {
      toast({
        title: "Not signed in",
        description: "Sign in to create calendar events.",
        variant: "destructive",
      });
      return;
    }
    const plannedDate = audit.metadata.plannedDate || audit.metadata.auditDate;
    if (!plannedDate) {
      toast({
        title: "No audit date",
        description: "Set a planned date on the audit before creating a calendar event.",
        variant: "destructive",
      });
      return;
    }
    setAuditSaving(audit.id);
    try {
      const token = await firebaseUser.getIdToken();
      // Block out 9am–5pm on the audit date. Google Calendar API interprets
      // the local time + Australia/Sydney timezone the route injects.
      const start = `${plannedDate}T09:00:00`;
      const end = `${plannedDate}T17:00:00`;
      const res = await fetch("/api/google/calendar/create-event", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          summary: `IMS Audit: ${audit.metadata.auditId} (${audit.metadata.standard})`,
          description: [
            `Audit: ${audit.metadata.auditId}`,
            `Standard: ${audit.metadata.standard}`,
            `Scope: ${audit.metadata.scope}`,
            `Lead auditor: ${audit.metadata.leadAuditor}`,
            audit.metadata.processes && audit.metadata.processes.length > 0
              ? `Processes: ${audit.metadata.processes.join(", ")}`
              : "",
            `View in portal: https://asiportal.live/dashboard/ims/ims-auditor`,
          ]
            .filter(Boolean)
            .join("\n"),
          start,
          end,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Calendar event creation failed.");
      // Save the event ID back to the audit
      await updateDoc(doc(db, COLLECTIONS.IMS_AUDITS, audit.id), {
        metadata: {
          ...audit.metadata,
          calendarEventId: data.eventId || null,
        },
        updatedAt: Timestamp.now(),
      });
      toast({
        title: "Calendar event created",
        description: `${audit.metadata.auditId} added to Google Calendar for ${plannedDate}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar creation failed.";
      toast({
        title: "Calendar event failed",
        description: `${message}. The audit is still scheduled in the portal.`,
        variant: "destructive",
      });
    } finally {
      setAuditSaving(null);
    }
  };

  // ── CAPA transitions ──────────────────────────────────────────────────────
  const setCapaStatus = async (capaId: string, nextStatus: CapaStatus) => {
    setCapaSaving(capaId);
    try {
      const capaRef = doc(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS, capaId);
      if (nextStatus === "closed") {
        await updateDoc(capaRef, {
          status: nextStatus,
          updatedAt: Timestamp.now(),
          closedAt: Timestamp.now(),
          closedByName: user?.name || user?.email || "Director",
          closureNotes: closureNotes[capaId] || "Closed via IMS Auditor dashboard.",
        });
      } else {
        await updateDoc(capaRef, {
          status: nextStatus,
          updatedAt: Timestamp.now(),
        });
      }
      toast({
        title: "CAPA updated",
        description: `Marked ${nextStatus.replace("_", " ")}.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "CAPA update failed.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setCapaSaving(null);
    }
  };

  // ── Gates ─────────────────────────────────────────────────────────────────
  if (!user) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Sign in to view the IMS Auditor.
        </CardContent>
      </Card>
    );
  }

  const isAdmin = user.role === "admin";
  const isAuditor = (user.role as string) === "auditor";
  const canManage = isAdmin;
  const canView = isAdmin || isAuditor;

  if (!canView) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          IMS Auditor is restricted to administrators and external auditors.
        </CardContent>
      </Card>
    );
  }

  const actor = {
    uid: user.uid,
    email: user.email || "",
    name: user.name || user.email || "User",
  };

  return (
    <div className="space-y-6">
      {/* Header + stats */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-orange-500/20 backdrop-blur-sm">
            <ShieldCheck className="h-8 w-8 text-orange-400" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-bold">IMS Auditor</h1>
            <p className="text-muted-foreground">
              Internal audit scheduling, execution tracking, and corrective action closeout.
            </p>
          </div>
        </div>
        {canManage && (
          <Button
            onClick={() => {
              setScheduleDefault(undefined);
              setScheduleOpen(true);
            }}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            <CalendarPlus className="h-4 w-4 mr-2" />
            Schedule Audit
          </Button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-bold">{stats.openAudits}</div>
            <p className="text-xs text-muted-foreground">Open Audits</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-bold text-amber-400">{stats.dueThisMonth}</div>
            <p className="text-xs text-muted-foreground">Due This Month</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-bold text-green-400">{stats.completedYtd}</div>
            <p className="text-xs text-muted-foreground">Completed YTD</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-5 pb-4">
            <div className="text-2xl font-bold text-sky-400">{stats.openCapas}</div>
            <p className="text-xs text-muted-foreground">Open CAPAs</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-5 pb-4">
            <div className={cn("text-2xl font-bold", stats.overdueCapas > 0 ? "text-red-400" : "text-zinc-500")}>
              {stats.overdueCapas}
            </div>
            <p className="text-xs text-muted-foreground">Overdue CAPAs</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="schedule" className="space-y-4">
        <TabsList className="bg-card/50 backdrop-blur">
          <TabsTrigger value="schedule">12-Month Schedule</TabsTrigger>
          <TabsTrigger value="audits">All Audits</TabsTrigger>
          <TabsTrigger value="capas">
            Corrective Actions
            {stats.overdueCapas > 0 && (
              <Badge variant="outline" className="ml-2 text-[10px] bg-red-500/20 text-red-300 border-red-500/30">
                {stats.overdueCapas} overdue
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ═══ 12-MONTH SCHEDULE ═══════════════════════════════════════════ */}
        <TabsContent value="schedule" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-primary" />
                Next 12 Months
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                ISO 9001/14001/45001 requires an annual internal audit of every clause.
                Click any month to schedule a new audit on that month.
              </p>
            </CardHeader>
            <CardContent>
              {auditsLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : (
                <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                  {schedule.map((slot) => {
                    const isCurrentMonth =
                      slot.year === new Date().getFullYear() && slot.month === new Date().getMonth();
                    return (
                      <button
                        key={`${slot.year}-${slot.month}`}
                        type="button"
                        onClick={() => {
                          if (!canManage) return;
                          setScheduleDefault(firstOfMonth(slot));
                          setScheduleOpen(true);
                        }}
                        disabled={!canManage}
                        className={cn(
                          "text-left rounded-lg border p-3 transition-colors min-h-[110px] flex flex-col",
                          isCurrentMonth
                            ? "border-primary/60 bg-primary/5"
                            : "border-border/40 bg-background/60",
                          canManage && "hover:border-primary/60 hover:bg-primary/5 cursor-pointer"
                        )}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className={cn("text-sm font-semibold", isCurrentMonth && "text-primary")}>
                            {slot.label}
                          </span>
                          {slot.audits.length > 0 ? (
                            <Badge variant="outline" className="text-[10px]">
                              {slot.audits.length}
                            </Badge>
                          ) : canManage ? (
                            <Plus className="h-3.5 w-3.5 text-muted-foreground/60" />
                          ) : null}
                        </div>
                        <div className="space-y-1 flex-1">
                          {slot.audits.length === 0 ? (
                            <p className="text-xs text-muted-foreground/60 italic">
                              {canManage ? "Click to schedule" : "No audits"}
                            </p>
                          ) : (
                            slot.audits.slice(0, 3).map((audit) => (
                              <div
                                key={audit.id}
                                className="text-xs rounded border border-border/30 bg-background/40 p-1.5 truncate"
                              >
                                <div className="font-mono text-[10px] text-primary truncate">
                                  {audit.metadata.auditId}
                                </div>
                                <div className="text-[10px] text-muted-foreground truncate">
                                  {audit.metadata.standard.replace("ISO", "ISO ").replace(":", " ")}
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn("text-[9px] mt-0.5", AUDIT_STATUS_STYLE[audit.metadata.status])}
                                >
                                  {audit.metadata.status.replace("_", " ")}
                                </Badge>
                              </div>
                            ))
                          )}
                          {slot.audits.length > 3 && (
                            <p className="text-[10px] text-muted-foreground italic">
                              +{slot.audits.length - 3} more
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ ALL AUDITS ═══════════════════════════════════════════════════ */}
        <TabsContent value="audits" className="space-y-4">
          {(["scheduled", "planned", "in_progress", "completed", "cancelled"] as AuditStatus[]).map((status) => {
            const items = auditsByStatus[status];
            if (items.length === 0) return null;
            return (
              <Card key={status} className="bg-card/50 backdrop-blur">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Badge variant="outline" className={cn("uppercase tracking-wide", AUDIT_STATUS_STYLE[status])}>
                      {status.replace("_", " ")}
                    </Badge>
                    <span className="text-muted-foreground text-sm font-normal">({items.length})</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {items.map((audit) => {
                    const plannedDate = audit.metadata.plannedDate || audit.metadata.auditDate;
                    const days = daysUntil(plannedDate);
                    const isOverdue = days !== null && days < 0 && status !== "completed" && status !== "cancelled";
                    return (
                      <div
                        key={audit.id}
                        className={cn(
                          "rounded-lg border p-3 space-y-2",
                          isOverdue ? "border-red-500/40 bg-red-500/5" : "border-border/40 bg-background/60"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-primary">
                                {audit.metadata.auditId}
                              </span>
                              <Badge variant="outline" className="text-[10px]">
                                {audit.metadata.standard}
                              </Badge>
                              {audit.metadata.auditType && (
                                <Badge variant="outline" className="text-[10px] capitalize">
                                  {audit.metadata.auditType.replace("_", " ")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-sm mt-1 text-foreground">{audit.metadata.scope}</p>
                            <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {plannedDate || "No date"}
                                {days !== null && (
                                  <span className={cn("ml-1", isOverdue && "text-red-400 font-semibold")}>
                                    ({days > 0 ? `in ${days}d` : days === 0 ? "today" : `${Math.abs(days)}d overdue`})
                                  </span>
                                )}
                              </span>
                              <span className="flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3" />
                                {audit.metadata.leadAuditor}
                              </span>
                              {audit.metadata.calendarEventId && (
                                <Badge variant="outline" className="text-[9px] border-green-500/40 text-green-400">
                                  <Calendar className="h-2.5 w-2.5 mr-1" />
                                  Calendar
                                </Badge>
                              )}
                            </div>
                          </div>
                          {canManage && (
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {(status === "scheduled" || status === "planned") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => transitionAudit(audit.id, "in_progress")}
                                  disabled={auditSaving === audit.id}
                                  className="h-7 text-xs"
                                >
                                  <PlayCircle className="h-3.5 w-3.5 mr-1" />
                                  Start
                                </Button>
                              )}
                              {status === "in_progress" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => transitionAudit(audit.id, "completed")}
                                  disabled={auditSaving === audit.id}
                                  className="h-7 text-xs"
                                >
                                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                  Complete
                                </Button>
                              )}
                              {(status === "scheduled" || status === "planned" || status === "in_progress") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => transitionAudit(audit.id, "cancelled")}
                                  disabled={auditSaving === audit.id}
                                  className="h-7 text-xs"
                                >
                                  <X className="h-3.5 w-3.5 mr-1" />
                                  Cancel
                                </Button>
                              )}
                              {(status === "scheduled" || status === "planned") && !audit.metadata.calendarEventId && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => addCalendarEvent(audit)}
                                  disabled={auditSaving === audit.id}
                                  className="h-7 text-xs"
                                >
                                  <CalendarPlus className="h-3.5 w-3.5 mr-1" />
                                  Calendar
                                </Button>
                              )}
                            </div>
                          )}
                        </div>

                        {audit.findings && audit.findings.length > 0 && (
                          <div className="text-xs text-muted-foreground pt-2 border-t border-border/30">
                            <span className="font-semibold">{audit.findings.length}</span> finding
                            {audit.findings.length === 1 ? "" : "s"} recorded
                            {audit.findings.filter((f) => f.type === "minor_nc" || f.type === "major_nc").length > 0 && (
                              <span className="ml-2 text-amber-400">
                                ({audit.findings.filter((f) => f.type === "minor_nc" || f.type === "major_nc").length} NCs)
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}

          {audits.length === 0 && !auditsLoading && (
            <Card className="bg-card/50 backdrop-blur">
              <CardContent className="p-12 text-center">
                <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No audits scheduled yet</h3>
                <p className="text-muted-foreground mb-4">
                  ISO 9001/14001/45001 requires an annual internal audit of every clause.
                </p>
                {canManage && (
                  <Button onClick={() => setScheduleOpen(true)}>
                    <CalendarPlus className="h-4 w-4 mr-2" />
                    Schedule First Audit
                  </Button>
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ═══ CAPA TRACKER ════════════════════════════════════════════════ */}
        <TabsContent value="capas" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-400" />
                Corrective & Preventive Actions
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Human-tracked closeout of corrective actions raised from audits, incidents,
                and continual improvement. CAPAs can also be raised via the standalone
                <Link href="/dashboard/ims/corrective-actions" className="text-primary hover:underline ml-1">
                  Corrective Action Register
                </Link>
                .
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {capasLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </div>
              ) : capas.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ClipboardCheck className="h-10 w-10 mx-auto mb-3" />
                  <p>No corrective actions logged yet.</p>
                  <p className="text-xs mt-1">
                    GUARDIAN will raise CAPAs during audits, from incidents, and when ISO
                    nonconformances are identified.
                  </p>
                </div>
              ) : (
                capas.map((capa) => {
                  const today = new Date().toISOString().split("T")[0];
                  const isOverdue =
                    capa.status !== "closed" &&
                    capa.dueDate !== undefined &&
                    capa.dueDate !== null &&
                    capa.dueDate < today;
                  return (
                    <div
                      key={capa.id}
                      className={cn(
                        "rounded-lg border p-3 space-y-2",
                        isOverdue
                          ? "border-red-500/40 bg-red-500/5"
                          : capa.status === "closed"
                          ? "border-green-500/20 bg-green-500/5 opacity-70"
                          : "border-border/40 bg-background/60"
                      )}
                    >
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Badge variant="outline" className={cn("text-[10px]", CAPA_STATUS_STYLE[capa.status])}>
                              {capa.status.replace("_", " ")}
                            </Badge>
                            {capa.priority && (
                              <Badge
                                variant="outline"
                                className={cn("text-[10px]", CAPA_PRIORITY_STYLE[capa.priority])}
                              >
                                {capa.priority}
                              </Badge>
                            )}
                            {capa.domain && (
                              <Badge variant="outline" className="text-[10px] capitalize">
                                {capa.domain}
                              </Badge>
                            )}
                            {capa.isoClauses && capa.isoClauses.length > 0 && (
                              <Badge variant="outline" className="text-[10px] font-mono">
                                {capa.isoClauses.slice(0, 3).join(", ")}
                                {capa.isoClauses.length > 3 && "…"}
                              </Badge>
                            )}
                          </div>
                          <h4 className="text-sm font-semibold mt-1.5">{capa.title}</h4>
                          {capa.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {capa.description}
                            </p>
                          )}
                          <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground flex-wrap">
                            {capa.ownerName && (
                              <span>
                                <strong>Owner:</strong> {capa.ownerName}
                              </span>
                            )}
                            {capa.dueDate && (
                              <span className={cn("flex items-center gap-1", isOverdue && "text-red-400 font-semibold")}>
                                <Clock className="h-3 w-3" />
                                Due {capa.dueDate}
                                {isOverdue && " (OVERDUE)"}
                              </span>
                            )}
                            {capa.sourceType && (
                              <span className="capitalize">
                                from {capa.sourceType.replace("_", " ")}
                                {capa.sourceLabel && `: ${capa.sourceLabel}`}
                              </span>
                            )}
                          </div>
                        </div>
                        {canManage && capa.status !== "closed" && (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {capa.status === "open" && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setCapaStatus(capa.id, "in_progress")}
                                disabled={capaSaving === capa.id}
                                className="h-7 text-xs"
                              >
                                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                                Start
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setCapaStatus(capa.id, "closed")}
                              disabled={capaSaving === capa.id || !(closureNotes[capa.id] || "").trim()}
                              className="h-7 text-xs bg-green-500/10 hover:bg-green-500/20 border-green-500/30"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Close Out
                            </Button>
                          </div>
                        )}
                      </div>

                      {capa.status !== "closed" && canManage && (
                        <Textarea
                          placeholder="Closure notes — evidence of correction, root cause analysis, effectiveness verification (required to close)"
                          value={closureNotes[capa.id] || ""}
                          onChange={(e) =>
                            setClosureNotes((prev) => ({ ...prev, [capa.id]: e.target.value }))
                          }
                          className="text-xs min-h-[60px]"
                        />
                      )}

                      {capa.status === "closed" && capa.closureNotes && (
                        <div className="text-xs border-t border-border/30 pt-2 mt-2">
                          <div className="flex items-center gap-1.5 text-green-400 mb-1">
                            <CheckCircle2 className="h-3 w-3" />
                            <span className="font-semibold">Closed</span>
                            {capa.closedByName && <span>by {capa.closedByName}</span>}
                            {capa.closedAt && (
                              <span className="text-muted-foreground">
                                on {formatDate(capa.closedAt)}
                              </span>
                            )}
                          </div>
                          <p className="text-muted-foreground whitespace-pre-wrap">{capa.closureNotes}</p>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Schedule modal */}
      {canManage && (
        <ScheduleAuditModal
          open={scheduleOpen}
          onClose={() => setScheduleOpen(false)}
          actor={actor}
          defaultDate={scheduleDefault}
        />
      )}
    </div>
  );
}
