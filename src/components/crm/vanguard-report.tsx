"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  AlertTriangle, Clock, Shield, TrendingUp, Users,
  Mail, Linkedin, Phone, Calendar,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebaseClient";
import { doc, onSnapshot, collection, query, orderBy, limit as fbLimit } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/collections";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StreamSnapshot {
  total: number;
  gradeA: number;
  gradeB: number;
  gradeC: number;
  newToday: number;
  outreachSent: number;
  overdueActions: number;
}

interface NewLead {
  leadId: string;
  companyName: string;
  sector: string;
  streamType: "sales" | "supply_chain";
  bantScore: number;
  leadGrade: string;
  recommendedAction: string;
}

interface OutreachEvent {
  leadId: string;
  companyName: string;
  channel: string;
  status: string;
  subject: string;
  nextStep: string;
}

interface StageMovement {
  leadId: string;
  companyName: string;
  fromStage: string;
  toStage: string;
  reason: string;
}

interface PriorityAction {
  priority: number;
  action: string;
  leadId: string | null;
  companyName: string | null;
  urgency: "immediate" | "today" | "this_week";
}

interface OverdueFollowUp {
  leadId: string;
  companyName: string;
  nextActionDate: string;
  daysOverdue: number;
  nextAction: string;
}

interface VanguardReport {
  date: string;
  generatedAt: string;
  snapshot: { sales: StreamSnapshot; supplyChain: StreamSnapshot };
  newLeads: NewLead[];
  outreachEvents: OutreachEvent[];
  stageMovements: StageMovement[];
  priorityActions: PriorityAction[];
  overdueFollowUps: OverdueFollowUp[];
  executiveSummary: string;
  weekToDate: {
    leadsCreated: number;
    outreachSent: number;
    responsesReceived: number;
    stageProgressions: number;
  } | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const URGENCY_STYLES = {
  immediate: "bg-red-500/15 text-red-400 border-red-500/20",
  today: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  this_week: "bg-blue-500/15 text-blue-400 border-blue-500/20",
};

const CHANNEL_ICONS: Record<string, typeof Mail> = {
  email: Mail, linkedin: Linkedin, phone: Phone, meeting: Calendar,
};

function formatDate(d: string) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

function addDays(d: string, n: number) {
  const date = new Date(d + "T00:00:00");
  date.setDate(date.getDate() + n);
  return date.toISOString().split("T")[0];
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, icon: Icon, badge, defaultOpen = false, children }: {
  title: string;
  icon: typeof TrendingUp;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-t border-border/30">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-3 hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">{title}</span>
          {badge !== undefined && (
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{badge}</Badge>
          )}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-4">{children}</div>}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function VanguardReport() {
  const [report, setReport] = useState<VanguardReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split("T")[0]);

  useEffect(() => {
    if (!db) { setLoading(false); return; }
    setLoading(true);
    const unsubscribe = onSnapshot(
      doc(db, COLLECTIONS.VANGUARD_REPORTS, selectedDate),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          // Convert Firestore timestamps
          const generatedAt = data.generatedAt?.toDate?.()?.toISOString?.() || data.generatedAt || "";
          setReport({ ...data, generatedAt } as VanguardReport);
        } else {
          setReport(null);
        }
        setLoading(false);
      },
      () => setLoading(false)
    );
    return () => unsubscribe();
  }, [selectedDate]);

  if (loading) {
    return (
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="p-5 animate-pulse space-y-4">
          <div className="h-6 bg-muted rounded w-72" />
          <div className="h-4 bg-muted rounded w-full" />
          <div className="h-4 bg-muted rounded w-3/4" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-muted rounded" />
            <div className="h-24 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              <h2 className="text-base font-bold">VANGUARD Daily Intelligence Report</h2>
            </div>
            <DateNav date={selectedDate} onChange={setSelectedDate} />
          </div>
          <p className="text-sm text-muted-foreground">
            {selectedDate === new Date().toISOString().split("T")[0]
              ? "VANGUARD daily report generates at 5:00 PM. Check back after the end-of-day scan."
              : `No report available for ${formatDate(selectedDate)}.`}
          </p>
        </div>
      </div>
    );
  }

  const genTime = report.generatedAt
    ? new Date(report.generatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
    : "";

  return (
    <div className="bg-card border border-border/40 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-border/30 bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <div>
              <h2 className="text-base font-bold">VANGUARD Daily Intelligence Report</h2>
              <p className="text-xs text-muted-foreground">
                {formatDate(report.date)}{genTime && ` · Generated at ${genTime}`}
              </p>
            </div>
          </div>
          <DateNav date={selectedDate} onChange={setSelectedDate} />
        </div>
      </div>

      {/* Executive Summary */}
      <Section title="Executive Summary" icon={TrendingUp} defaultOpen>
        <p className="text-sm text-muted-foreground leading-relaxed">{report.executiveSummary}</p>
        {report.weekToDate && (
          <div className="flex gap-4 mt-3 flex-wrap">
            {[
              { label: "Leads this week", value: report.weekToDate.leadsCreated },
              { label: "Outreach sent", value: report.weekToDate.outreachSent },
              { label: "Responses", value: report.weekToDate.responsesReceived },
              { label: "Stage moves", value: report.weekToDate.stageProgressions },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <p className="text-lg font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Pipeline Snapshot + Activity side by side */}
      <Section title="Pipeline Snapshot" icon={Users} badge={
        (report.snapshot?.sales?.total || 0) + (report.snapshot?.supplyChain?.total || 0)
      } defaultOpen>
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Snapshot table */}
          <div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  <th className="text-left py-1"></th>
                  <th className="text-center py-1">Sales</th>
                  <th className="text-center py-1">Supply</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/20">
                {[
                  { label: "Total", k: "total" },
                  { label: "Grade A", k: "gradeA" },
                  { label: "Grade B", k: "gradeB" },
                  { label: "New today", k: "newToday" },
                  { label: "Outreach", k: "outreachSent" },
                  { label: "Overdue", k: "overdueActions" },
                ].map(({ label, k }) => (
                  <tr key={k}>
                    <td className="py-1.5 text-muted-foreground">{label}</td>
                    <td className="py-1.5 text-center font-medium">
                      {(report.snapshot?.sales as unknown as Record<string, number>)?.[k] ?? 0}
                    </td>
                    <td className="py-1.5 text-center font-medium">
                      {(report.snapshot?.supplyChain as unknown as Record<string, number>)?.[k] ?? 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Today's activity */}
          <div className="space-y-3">
            {report.newLeads?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  New Leads ({report.newLeads.length})
                </p>
                {report.newLeads.slice(0, 5).map((l) => (
                  <Link key={l.leadId} href={`/dashboard/crm/${l.leadId}`}
                    className="flex items-center gap-2 py-1 text-sm hover:text-primary transition-colors">
                    <span className={`text-[10px] font-bold px-1 rounded ${
                      l.leadGrade === "A" ? "bg-green-500/20 text-green-400" :
                      l.leadGrade === "B" ? "bg-blue-500/20 text-blue-400" : "bg-amber-500/20 text-amber-400"
                    }`}>{l.leadGrade}</span>
                    <span className="truncate">{l.companyName}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto">{l.bantScore}</span>
                  </Link>
                ))}
              </div>
            )}
            {report.outreachEvents?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
                  Outreach ({report.outreachEvents.length})
                </p>
                {report.outreachEvents.slice(0, 5).map((e, i) => {
                  const Icon = CHANNEL_ICONS[e.channel] || Mail;
                  return (
                    <div key={i} className="flex items-center gap-2 py-1 text-sm">
                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="truncate">{e.companyName}</span>
                      <Badge variant="outline" className="text-[10px] h-4 px-1 ml-auto">{e.status}</Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* Priority Actions */}
      <Section title="Priority Actions" icon={AlertTriangle} badge={report.priorityActions?.length} defaultOpen>
        <div className="space-y-2">
          {(report.priorityActions || []).map((a, i) => (
            <div key={i} className="flex items-start gap-3 py-1.5">
              <span className="text-xs font-bold text-muted-foreground w-5 flex-shrink-0">{a.priority}.</span>
              <div className="flex-1 text-sm">
                <span>{a.action}</span>
                {a.companyName && (
                  <Link href={`/dashboard/crm/${a.leadId}`} className="text-primary hover:underline ml-1">
                    — {a.companyName}
                  </Link>
                )}
              </div>
              <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border flex-shrink-0 capitalize ${URGENCY_STYLES[a.urgency]}`}>
                {a.urgency.replace("_", " ")}
              </span>
            </div>
          ))}
          {(!report.priorityActions || report.priorityActions.length === 0) && (
            <p className="text-sm text-muted-foreground">No priority actions for today.</p>
          )}
        </div>
      </Section>

      {/* Stage Movements */}
      {report.stageMovements?.length > 0 && (
        <Section title="Stage Movements" icon={TrendingUp} badge={report.stageMovements.length}>
          <div className="space-y-1.5">
            {report.stageMovements.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Link href={`/dashboard/crm/${m.leadId}`} className="text-primary hover:underline truncate">
                  {m.companyName}
                </Link>
                <span className="text-muted-foreground text-xs">{m.fromStage} → {m.toStage}</span>
                {m.reason && <span className="text-[10px] text-muted-foreground ml-auto truncate max-w-32">{m.reason}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Overdue Follow-Ups */}
      <Section title="Overdue Follow-Ups" icon={Clock} badge={report.overdueFollowUps?.length}>
        <div className="space-y-1.5">
          {(report.overdueFollowUps || []).map((o, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 flex-shrink-0">
                {o.daysOverdue}d
              </span>
              <Link href={`/dashboard/crm/${o.leadId}`} className="text-primary hover:underline truncate">
                {o.companyName}
              </Link>
              <span className="text-xs text-muted-foreground ml-auto truncate max-w-48">{o.nextAction}</span>
            </div>
          ))}
          {(!report.overdueFollowUps || report.overdueFollowUps.length === 0) && (
            <p className="text-sm text-muted-foreground">No overdue follow-ups.</p>
          )}
        </div>
      </Section>
    </div>
  );
}

// ─── Date navigation ──────────────────────────────────────────────────────────

function DateNav({ date, onChange }: { date: string; onChange: (d: string) => void }) {
  const today = new Date().toISOString().split("T")[0];
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onChange(addDays(date, -1))}>
        <ChevronLeft className="h-4 w-4" />
      </Button>
      <span className="text-xs text-muted-foreground min-w-16 text-center">{date}</span>
      <Button variant="ghost" size="icon" className="h-7 w-7" disabled={date >= today} onClick={() => onChange(addDays(date, 1))}>
        <ChevronRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
