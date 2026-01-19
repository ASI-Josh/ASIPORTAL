"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, Leaf, AlertTriangle, LineChart, Users, Wrench } from "lucide-react";
import { collection, doc, onSnapshot, orderBy, query } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { ContactOrganization, GoodsReceivedInspection, Inspection, Job } from "@/lib/types";
import { calculateDashboardMetrics } from "@/lib/dashboard-analytics";

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

function formatHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  return `${value.toFixed(1)}h`;
}

function toLocalDateString(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString("en-AU");
}

function formatShortDate(date?: Date | null) {
  if (!date) return "-";
  return date.toLocaleDateString("en-AU");
}

function toDateValue(value?: { toDate?: () => Date }) {
  return value?.toDate?.() ?? null;
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function DashboardPage() {
  const { user, firebaseUser } = useAuth();
  const { jobs, worksRegister } = useJobs();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [goodsReceived, setGoodsReceived] = useState<GoodsReceivedInspection[]>([]);
  const [insightDoc, setInsightDoc] = useState<InsightPayload | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  useEffect(() => {
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.INSPECTIONS),
      orderBy("createdAt", "desc")
    );
    const orgsQuery = query(
      collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS),
      orderBy("name")
    );
    const goodsQuery = query(
      collection(db, COLLECTIONS.GOODS_RECEIVED),
      orderBy("createdAt", "desc")
    );

    const unsubscribeInspections = onSnapshot(
      inspectionsQuery,
      (snapshot) => {
        setInspections(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Inspection, "id">),
          }))
        );
      },
      () => setInspections([])
    );

    const unsubscribeOrgs = onSnapshot(
      orgsQuery,
      (snapshot) => {
        setOrganizations(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<ContactOrganization, "id">),
          }))
        );
      },
      () => setOrganizations([])
    );

    const unsubscribeGoods = onSnapshot(
      goodsQuery,
      (snapshot) => {
        setGoodsReceived(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<GoodsReceivedInspection, "id">),
          }))
        );
      },
      () => setGoodsReceived([])
    );

    return () => {
      unsubscribeInspections();
      unsubscribeOrgs();
      unsubscribeGoods();
    };
  }, []);

  const metrics = useMemo(
    () =>
      calculateDashboardMetrics({
        jobs,
        inspections,
        worksRegister,
        organizations,
      }),
    [jobs, inspections, worksRegister, organizations]
  );

  const scheduleFallback = useMemo(() => {
    const today = new Date();
    return jobs
      .filter((job) => job.scheduledDate?.toDate && isSameDay(job.scheduledDate.toDate(), today))
      .map((job) => ({
        id: job.id,
        summary: `${job.jobNumber} - ${job.clientName}`,
        time: job.booking?.preferredTime || job.booking?.preferredTime || "Scheduled",
      }));
  }, [jobs]);

  const goodsMetrics = useMemo(() => {
    const now = new Date();
    const pendingCount = goodsReceived.filter((item) => item.status === "submitted").length;
    const draftCount = goodsReceived.filter((item) => item.status === "draft").length;

    const upcoming = goodsReceived
      .filter((item) => item.status !== "closed")
      .map((item) => ({
        item,
        date: toDateValue(item.receivedDate) ?? toDateValue(item.updatedAt) ?? null,
      }))
      .filter((entry) => entry.date && entry.date >= now)
      .sort((a, b) => (a.date?.valueOf() || 0) - (b.date?.valueOf() || 0))[0]?.item;

    const latestClosed = goodsReceived
      .filter((item) => item.status === "closed")
      .map((item) => ({
        item,
        date: toDateValue(item.closedAt) ?? toDateValue(item.updatedAt) ?? null,
      }))
      .sort((a, b) => (b.date?.valueOf() || 0) - (a.date?.valueOf() || 0))
      .slice(0, 3)
      .map((entry) => entry.item);

    return { pendingCount, draftCount, upcoming, latestClosed };
  }, [goodsReceived]);

  useEffect(() => {
    const loadCalendarStatus = async () => {
      if (!firebaseUser) return;
      try {
        const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/google/calendar/status", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Status failed");
        const data = (await response.json()) as { connected?: boolean };
        setCalendarConnected(Boolean(data.connected));
      } catch {
        setCalendarConnected(false);
      }
    };
    loadCalendarStatus();
  }, [firebaseUser]);

  useEffect(() => {
    const loadCalendarEvents = async () => {
      if (!firebaseUser || !calendarConnected) return;
      setCalendarLoading(true);
      try {
        const token = await firebaseUser.getIdToken();
        const params = new URLSearchParams({ rangeDays: "1" });
        const response = await fetch(`/api/google/calendar/events?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!response.ok) throw new Error("Events failed");
        const data = (await response.json()) as { events?: CalendarEvent[] };
        const today = new Date();
        const filtered = (data.events || []).filter((event) => {
          const start = event.start?.dateTime || event.start?.date;
          if (!start) return false;
          return isSameDay(new Date(start), today);
        });
        setCalendarEvents(filtered);
      } catch {
        setCalendarEvents([]);
      } finally {
        setCalendarLoading(false);
      }
    };
    loadCalendarEvents();
  }, [firebaseUser, calendarConnected]);

  useEffect(() => {
    if (!metrics.dateKey) return;
    const insightRef = doc(db, COLLECTIONS.AI_INSIGHTS, metrics.dateKey);
    const unsubscribe = onSnapshot(
      insightRef,
      (snapshot) => {
        setInsightDoc(snapshot.exists() ? (snapshot.data() as InsightPayload) : null);
      },
      () => setInsightDoc(null)
    );
    return () => unsubscribe();
  }, [metrics.dateKey]);

  const handleGenerateInsights = async () => {
    if (!firebaseUser) return;
    setInsightLoading(true);
    setInsightError(null);
    try {
      const token = await firebaseUser.getIdToken();
        const response = await fetch("/api/dashboard/insights", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "AI insights failed.");
      }
      const payload = (await response.json()) as { insights?: InsightPayload };
      setInsightDoc(payload.insights || null);
    } catch (error: any) {
      setInsightError(error.message || "AI insights failed.");
    } finally {
      setInsightLoading(false);
    }
  };

  const lastInsightAt = insightDoc?.generatedAt?.toDate?.().toLocaleString("en-AU");

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Welcome back, {user?.name || "User"}!
        </h2>
        <p className="text-muted-foreground">
          Live operational and sustainability intelligence for ASI.
        </p>
      </div>

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

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Leaf className="h-4 w-4 text-emerald-400" />
              Sustainability Impact
            </CardTitle>
            <CardDescription>Glass diverted from landfill and value saved.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-2xl font-bold">
              {metrics.glassSavedKg.toFixed(1)} kg saved
            </div>
            <div className="text-sm text-muted-foreground">
              Replacement value avoided: {formatCurrency(metrics.replacementValueSaved)}
            </div>
            <div className="text-sm text-muted-foreground">
              Downtime avoided: {formatHours(metrics.downtimeSavedHours)}
            </div>
            <div className="text-xs text-muted-foreground">
              Weight formula: area × thickness × 2.5 kg/m2 per mm (PVB 1.07 kg/m2/mm).
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-blue-400" />
              Operations Snapshot
            </CardTitle>
            <CardDescription>ISO-focused operational signals.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span>Jobs completed</span>
              <span className="font-medium">{metrics.operations.jobsCompleted}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>In progress</span>
              <span className="font-medium">{metrics.operations.jobsInProgress}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Scheduled</span>
              <span className="font-medium">{metrics.operations.jobsScheduled}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Avg completion time</span>
              <span className="font-medium">{formatHours(metrics.operations.avgCompletionHours)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Compliance rate</span>
              <span className="font-medium">{metrics.operations.complianceRate.toFixed(0)}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-amber-400" />
              Sales Snapshot
            </CardTitle>
            <CardDescription>Top accounts and inactivity watchlist.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-2">Top clients</p>
              {metrics.topClients.length === 0 ? (
                <p className="text-sm text-muted-foreground">No client revenue yet.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.topClients.map((client) => (
                    <div key={client.name} className="flex items-center justify-between text-sm">
                      <span>{client.name}</span>
                      <span className="font-medium">{formatCurrency(client.revenue)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Inactive 4+ weeks</p>
              {metrics.inactiveClients.length === 0 ? (
                <p className="text-sm text-muted-foreground">All clients are active.</p>
              ) : (
                <div className="space-y-2">
                  {metrics.inactiveClients.map((client) => (
                    <div key={client.name} className="flex items-center justify-between text-sm">
                      <span>{client.name}</span>
                      <span className="text-muted-foreground">{client.daysInactive} days</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Alerts
            </CardTitle>
            <CardDescription>Immediate risks and operational issues.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Overdue jobs</span>
              <Badge variant="outline">{metrics.operations.overdueJobs}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Jobs on hold</span>
              <Badge variant="outline">{metrics.operations.onHoldJobs}</Badge>
            </div>
            <div className="flex items-center justify-between">
              <span>Unassigned jobs</span>
              <Badge variant="outline">{metrics.operations.unassignedJobs}</Badge>
            </div>
            {insightDoc?.alerts?.length ? (
              <div className="pt-2 space-y-2">
                {insightDoc.alerts.map((alert) => (
                  <p key={alert} className="text-xs text-muted-foreground">
                    • {alert}
                  </p>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Wrench className="h-4 w-4 text-emerald-400" />
              Goods Inwards
            </CardTitle>
            <CardDescription>Incoming procurement and QA outcomes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <p className="text-sm font-medium mb-2">Next incoming procurement</p>
              {goodsMetrics.upcoming ? (
                <div className="space-y-1">
                  <p className="font-medium">
                    {goodsMetrics.upcoming.supplierName || "Supplier"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    PO {goodsMetrics.upcoming.poNumber || "TBC"} •{" "}
                    {formatShortDate(
                      toDateValue(goodsMetrics.upcoming.receivedDate) ??
                        toDateValue(goodsMetrics.upcoming.updatedAt)
                    )}{" "}
                    • {goodsMetrics.upcoming.status.replace("_", " ")}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No incoming procurement scheduled.
                </p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Submitted</span>
                <span className="font-medium text-foreground">
                  {goodsMetrics.pendingCount}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Drafts</span>
                <span className="font-medium text-foreground">
                  {goodsMetrics.draftCount}
                </span>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium mb-2">Latest closed</p>
              {goodsMetrics.latestClosed.length === 0 ? (
                <p className="text-xs text-muted-foreground">No closed inspections yet.</p>
              ) : (
                <div className="space-y-2">
                  {goodsMetrics.latestClosed.map((entry) => (
                    <div key={entry.id} className="text-xs">
                      <p className="font-medium text-foreground">
                        {entry.supplierName || "Supplier"} • PO {entry.poNumber || "N/A"}
                      </p>
                      <p className="text-muted-foreground">
                        {entry.decision ? entry.decision.replace("_", " ") : "Decision pending"} •{" "}
                        {formatShortDate(
                          toDateValue(entry.closedAt) ?? toDateValue(entry.updatedAt)
                        )}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

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
            {insightDoc?.summary ? (
              <p className="text-sm text-muted-foreground">{insightDoc.summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No AI insights generated yet.
              </p>
            )}
            {insightDoc?.risks?.length ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Risks</p>
                {insightDoc.risks.map((item) => (
                  <p key={item} className="text-xs text-muted-foreground">• {item}</p>
                ))}
              </div>
            ) : null}
            {insightDoc?.opportunities?.length ? (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Opportunities</p>
                {insightDoc.opportunities.map((item) => (
                  <p key={item} className="text-xs text-muted-foreground">• {item}</p>
                ))}
              </div>
            ) : null}
            {insightError ? (
              <p className="text-xs text-destructive">{insightError}</p>
            ) : null}
            <Button onClick={handleGenerateInsights} disabled={insightLoading}>
              {insightLoading ? "Generating..." : "Generate AI insights"}
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
            {calendarLoading ? <p className="text-muted-foreground">Loading...</p> : null}
            {calendarConnected && calendarEvents.length > 0 ? (
              calendarEvents.map((event) => (
                <div key={event.id}>
                  <p className="font-medium">{event.summary || "Calendar event"}</p>
                  <p className="text-xs text-muted-foreground">
                    {toLocalDateString(event.start?.dateTime || event.start?.date)}{" "}
                    {event.location ? `• ${event.location}` : ""}
                  </p>
                </div>
              ))
            ) : (
              <>
                {scheduleFallback.length === 0 ? (
                  <p className="text-muted-foreground">No scheduled jobs today.</p>
                ) : (
                  scheduleFallback.map((job) => (
                    <div key={job.id}>
                      <p className="font-medium">{job.summary}</p>
                      <p className="text-xs text-muted-foreground">{job.time}</p>
                    </div>
                  ))
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
