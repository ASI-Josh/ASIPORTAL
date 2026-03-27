"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarCheck,
  LineChart,
  AlertTriangle,
  Wrench,
} from "lucide-react";
import { OpsAssistantPanel } from "@/components/dashboard/ops-assistant-panel";
import { WeatherCard } from "@/components/dashboard/weather-card";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  ContactOrganization,
  GoodsReceivedInspection,
  Inspection,
  PrestartCheck,
  StockItem,
  PurchaseOrder,
} from "@/lib/types";
import { calculateDashboardMetrics } from "@/lib/dashboard-analytics";

import { AgentOverview } from "./agent-overview";
import { OperationsStrip } from "./operations-strip";
import { HSEQCompliance } from "./hseq-compliance";
import { ProcurementSupply } from "./procurement-supply";
import { SalesIntel } from "./sales-intel";
import { OSINTFeed } from "./osint-feed";
import { EnvironmentalImpact } from "./environmental";

type InsightPayload = {
  summary?: string;
  risks?: string[];
  opportunities?: string[];
  alerts?: string[];
  generatedAt?: { toDate?: () => Date };
};

type CalendarEvent = {
  id: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function toLocalDateString(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-AU");
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function CommandCenterPage() {
  const { user, firebaseUser } = useAuth();
  const { jobs, worksRegister } = useJobs();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [goodsReceived, setGoodsReceived] = useState<GoodsReceivedInspection[]>([]);
  const [prestarts, setPrestarts] = useState<PrestartCheck[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("all");
  const [insightDoc, setInsightDoc] = useState<InsightPayload | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  // Data subscriptions
  useEffect(() => {
    const subs: (() => void)[] = [];

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.INSPECTIONS), orderBy("createdAt", "desc")),
      (snap) => setInspections(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Inspection, "id">) }))),
      () => setInspections([])
    ));

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS), orderBy("name")),
      (snap) => setOrganizations(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ContactOrganization, "id">) }))),
      () => setOrganizations([])
    ));

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.GOODS_RECEIVED), orderBy("createdAt", "desc")),
      (snap) => setGoodsReceived(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<GoodsReceivedInspection, "id">) }))),
      () => setGoodsReceived([])
    ));

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.PRESTART_CHECKS), orderBy("createdAt", "desc")),
      (snap) => setPrestarts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PrestartCheck, "id">) }))),
      () => setPrestarts([])
    ));

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.STOCK_ITEMS), orderBy("supplierName", "asc")),
      (snap) => setStockItems(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StockItem, "id">) }))),
      () => setStockItems([])
    ));

    subs.push(onSnapshot(
      query(collection(db, COLLECTIONS.PURCHASE_ORDERS), orderBy("createdAt", "desc")),
      (snap) => setPurchaseOrders(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PurchaseOrder, "id">) }))),
      () => setPurchaseOrders([])
    ));

    return () => subs.forEach((fn) => fn());
  }, []);

  // Filtered data
  const filteredJobs = useMemo(() => {
    if (selectedOrgId === "all") return jobs;
    return jobs.filter((j) => j.organizationId === selectedOrgId || j.clientName === selectedOrgId);
  }, [jobs, selectedOrgId]);

  const filteredInspections = useMemo(() => {
    if (selectedOrgId === "all") return inspections;
    return inspections.filter((i) => i.organizationId === selectedOrgId);
  }, [inspections, selectedOrgId]);

  const metrics = useMemo(
    () => calculateDashboardMetrics({ jobs: filteredJobs, inspections: filteredInspections, worksRegister, organizations }),
    [filteredJobs, filteredInspections, worksRegister, organizations]
  );

  const ohsMetrics = useMemo(() => {
    const completedPrestarts = prestarts.filter((p) => p.status === "completed");
    const vehicleSafetyPassed = completedPrestarts.filter((p) => {
      const vs = p.checklist?.vehicleSafety;
      if (!vs) return false;
      return vs.tyresOk && vs.lightsOk && vs.fluidsOk && vs.safetyEquipmentOk && vs.registrationOk && vs.cabCleanOk;
    }).length;
    const activeJobs = filteredJobs.filter((j) => !j.isDeleted && j.status !== "cancelled");
    const jobsWithCompletedRA = activeJobs.filter((j) => j.riskAssessment?.completedAt).length;
    let highCriticalHazards = 0;
    let residualHighCritical = 0;
    activeJobs.forEach((j) => {
      (j.riskAssessment?.hazards || []).forEach((h) => {
        if (!h.present) return;
        if (h.riskLevel === "high" || h.riskLevel === "critical") highCriticalHazards += 1;
        if (h.residualRiskLevel === "high" || h.residualRiskLevel === "critical") residualHighCritical += 1;
      });
    });
    const openPrestartIssues = prestarts.reduce(
      (sum, p) => sum + (p.issues?.filter((i) => i.status === "open" || i.status === "in_progress").length || 0),
      0
    );

    return {
      completedPrestarts: completedPrestarts.length,
      totalPrestarts: prestarts.length,
      prestartComplianceRate: prestarts.length ? Math.round((completedPrestarts.length / prestarts.length) * 100) : 0,
      vehicleSafetyPassRate: completedPrestarts.length ? Math.round((vehicleSafetyPassed / completedPrestarts.length) * 100) : 0,
      openPrestartIssues,
      jobsWithCompletedRA,
      totalActiveJobs: activeJobs.length,
      raComplianceRate: activeJobs.length ? Math.round((jobsWithCompletedRA / activeJobs.length) * 100) : 0,
      highCriticalHazards,
      residualHighCritical,
    };
  }, [prestarts, filteredJobs]);

  // Calendar
  useEffect(() => {
    if (!firebaseUser) return;
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/google/calendar/status", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        setCalendarConnected(Boolean(data.connected));
      } catch { setCalendarConnected(false); }
    })();
  }, [firebaseUser]);

  useEffect(() => {
    if (!firebaseUser || !calendarConnected) return;
    setCalendarLoading(true);
    (async () => {
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch(`/api/google/calendar/events?rangeDays=1`, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return;
        const data = await res.json();
        const today = new Date();
        setCalendarEvents((data.events || []).filter((e: CalendarEvent) => {
          const start = e.start?.dateTime || e.start?.date;
          return start && isSameDay(new Date(start), today);
        }));
      } catch { setCalendarEvents([]); }
      finally { setCalendarLoading(false); }
    })();
  }, [firebaseUser, calendarConnected]);

  // AI Insights
  useEffect(() => {
    if (!metrics.dateKey) return;
    return onSnapshot(
      doc(db, COLLECTIONS.AI_INSIGHTS, metrics.dateKey),
      (snap) => setInsightDoc(snap.exists() ? (snap.data() as InsightPayload) : null),
      () => setInsightDoc(null)
    );
  }, [metrics.dateKey]);

  const handleGenerateInsights = async () => {
    if (!firebaseUser) return;
    setInsightLoading(true);
    setInsightError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/dashboard/insights", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("AI insights failed.");
      const data = await res.json();
      setInsightDoc(data.insights || null);
    } catch (err: unknown) {
      setInsightError(err instanceof Error ? err.message : "AI insights failed.");
    } finally {
      setInsightLoading(false);
    }
  };

  const scheduleFallback = useMemo(() => {
    const today = new Date();
    return filteredJobs
      .filter((job) => job.scheduledDate?.toDate && isSameDay(job.scheduledDate.toDate(), today))
      .map((job) => ({ id: job.id, summary: `${job.jobNumber} - ${job.clientName}`, time: job.booking?.preferredTime || "Scheduled" }));
  }, [filteredJobs]);

  const selectedOrgName = selectedOrgId !== "all" ? organizations.find((o) => o.id === selectedOrgId)?.name : undefined;
  const lastInsightAt = insightDoc?.generatedAt?.toDate?.().toLocaleString("en-AU");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            ASI Command Center
          </h2>
          <p className="text-muted-foreground">
            Central operations overview — {user?.name || "Director"}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
            <SelectTrigger className="w-56 bg-card/50 border-border/30">
              <SelectValue placeholder="All organisations" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All organisations</SelectItem>
              {organizations.map((org) => (
                <SelectItem key={org.id} value={org.id}>{org.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedOrgId !== "all" && (
            <Button variant="ghost" size="sm" onClick={() => setSelectedOrgId("all")}>Clear</Button>
          )}
        </div>
      </div>

      {/* Revenue Pipeline */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Works Quoted</CardTitle>
            <CardDescription>{metrics.revenue.quoted.count} jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(metrics.revenue.quoted.total)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Works Confirmed</CardTitle>
            <CardDescription>{metrics.revenue.confirmed.count} jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(metrics.revenue.confirmed.total)}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Works Completed</CardTitle>
            <CardDescription>{metrics.revenue.completed.count} jobs</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(metrics.revenue.completed.total)}</div>
          </CardContent>
        </Card>
      </div>

      {/* Agent Division Overview */}
      <AgentOverview />

      {/* Live Operations Strip */}
      <OperationsStrip
        jobsInProgress={metrics.operations.jobsInProgress}
        jobsScheduled={metrics.operations.jobsScheduled}
        overdueJobs={metrics.operations.overdueJobs}
        onHoldJobs={metrics.operations.onHoldJobs}
        unassignedJobs={metrics.operations.unassignedJobs}
        jobsCompleted={metrics.operations.jobsCompleted}
        avgCompletionHours={metrics.operations.avgCompletionHours}
        complianceRate={metrics.operations.complianceRate}
      />

      {/* HSEQ Compliance (full width) */}
      <HSEQCompliance
        ohsMetrics={ohsMetrics}
        operations={{ complianceRate: metrics.operations.complianceRate, jobsCompleted: metrics.operations.jobsCompleted }}
        selectedOrgName={selectedOrgName}
      />

      {/* Two-column: Procurement + Sales */}
      <div className="grid gap-6 lg:grid-cols-2">
        <ProcurementSupply
          stockItems={stockItems}
          purchaseOrders={purchaseOrders}
          goodsReceived={goodsReceived}
        />
        <SalesIntel
          topClients={metrics.topClients}
          inactiveClients={metrics.inactiveClients}
        />
      </div>

      {/* Two-column: OSINT + Schedule/Insights */}
      <div className="grid gap-6 lg:grid-cols-2">
        <OSINTFeed />

        <div className="space-y-6">
          {/* Ops Command Deck */}
          <Card className="relative overflow-hidden border-border/30 bg-card/50 backdrop-blur-lg">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.12),_transparent_55%)]" />
            <CardHeader className="relative z-10 pb-3">
              <CardTitle className="text-base">Operations Command Deck</CardTitle>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
                <OpsAssistantPanel variant="embedded" layout="compact" className="rounded-2xl border border-border/30 bg-background/40 p-4" />
                <WeatherCard variant="embedded" layout="compact" className="rounded-2xl border border-border/30 bg-background/40 p-4" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Environmental Impact */}
      <EnvironmentalImpact
        glassSavedKg={metrics.glassSavedKg}
        replacementValueSaved={metrics.replacementValueSaved}
        downtimeSavedHours={metrics.downtimeSavedHours}
      />

      {/* Bottom strip: AI Insights + Schedule */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <LineChart className="h-4 w-4 text-primary" />
              AI Insights
            </CardTitle>
            <CardDescription>
              {lastInsightAt ? `Last updated ${lastInsightAt}` : "Run insights for today."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightDoc?.summary && <p className="text-sm text-muted-foreground">{insightDoc.summary}</p>}
            {insightDoc?.risks?.length ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Risks</p>
                {insightDoc.risks.map((item) => <p key={item} className="text-xs text-muted-foreground">• {item}</p>)}
              </div>
            ) : null}
            {insightDoc?.opportunities?.length ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Opportunities</p>
                {insightDoc.opportunities.map((item) => <p key={item} className="text-xs text-muted-foreground">• {item}</p>)}
              </div>
            ) : null}
            {insightDoc?.alerts?.length ? (
              <div>
                <p className="text-xs font-medium text-red-400 mb-1">Alerts</p>
                {insightDoc.alerts.map((item) => <p key={item} className="text-xs text-muted-foreground">• {item}</p>)}
              </div>
            ) : null}
            {insightError && <p className="text-xs text-destructive">{insightError}</p>}
            <Button onClick={handleGenerateInsights} disabled={insightLoading}>
              {insightLoading ? "Generating..." : "Generate AI Insights"}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarCheck className="h-4 w-4 text-emerald-400" />
              Today&apos;s Schedule
            </CardTitle>
            <CardDescription>Calendar-linked jobs for today.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {calendarLoading && <p className="text-muted-foreground">Loading...</p>}
            <div className="max-h-44 space-y-3 overflow-y-auto pr-2">
              {calendarConnected && calendarEvents.length > 0 ? (
                calendarEvents.map((event) => (
                  <div key={event.id}>
                    <p className="font-medium">{event.summary || "Calendar event"}</p>
                    <p className="text-xs text-muted-foreground">
                      {toLocalDateString(event.start?.dateTime || event.start?.date)}
                      {event.location ? ` • ${event.location}` : ""}
                    </p>
                  </div>
                ))
              ) : scheduleFallback.length === 0 ? (
                <p className="text-muted-foreground">No scheduled jobs today.</p>
              ) : (
                scheduleFallback.map((job) => (
                  <div key={job.id}>
                    <p className="font-medium">{job.summary}</p>
                    <p className="text-xs text-muted-foreground">{job.time}</p>
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
