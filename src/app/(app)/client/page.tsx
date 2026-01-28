"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { AlertTriangle, Leaf, LineChart, CalendarClock, CheckCircle2, FileText } from "lucide-react";
import { collection, doc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { Booking, ContactOrganization, Inspection, Job } from "@/lib/types";
import { calculateDashboardMetrics } from "@/lib/dashboard-analytics";

type InsightPayload = {
  summary?: string;
  risks?: string[];
  opportunities?: string[];
  alerts?: string[];
  generatedAt?: { toDate?: () => Date };
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

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    pending: "Pending",
    confirmed: "Scheduled",
    converted_to_job: "Scheduled",
    scheduled: "Scheduled",
    in_progress: "In progress",
    completed: "Completed",
    closed: "Closed",
    cancelled: "Cancelled",
  };
  return labels[status] || status.replace("_", " ");
}

function startOfYear(date: Date) {
  return new Date(date.getFullYear(), 0, 1);
}

export default function ClientPage() {
  const { user, firebaseUser } = useAuth();
  const { jobs, worksRegister, bookings } = useJobs();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [organization, setOrganization] = useState<ContactOrganization | null>(null);
  const [insightDoc, setInsightDoc] = useState<InsightPayload | null>(null);
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState<string | null>(null);
  const [insightRequested, setInsightRequested] = useState(false);

  useEffect(() => {
    if (!user?.organizationId) return;
    const orgRef = doc(db, COLLECTIONS.CONTACT_ORGANIZATIONS, user.organizationId);
    const unsubscribe = onSnapshot(
      orgRef,
      (snapshot) => {
        setOrganization(
          snapshot.exists()
            ? { id: snapshot.id, ...(snapshot.data() as Omit<ContactOrganization, "id">) }
            : null
        );
      },
      () => setOrganization(null)
    );
    return () => unsubscribe();
  }, [user?.organizationId]);

  useEffect(() => {
    if (!user?.organizationId) return;
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.INSPECTIONS),
      where("organizationId", "==", user.organizationId),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(
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
    return () => unsubscribe();
  }, [user?.organizationId]);

  const metrics = useMemo(
    () =>
      calculateDashboardMetrics({
        jobs,
        inspections,
        worksRegister,
        organizations: organization ? [organization] : [],
      }),
    [jobs, inspections, worksRegister, organization]
  );

  useEffect(() => {
    if (!user?.organizationId) return;
    const insightRef = doc(
      db,
      COLLECTIONS.CLIENT_INSIGHTS,
      `${user.organizationId}-${metrics.dateKey}`
    );
    const unsubscribe = onSnapshot(
      insightRef,
      (snapshot) => {
        setInsightDoc(snapshot.exists() ? (snapshot.data() as InsightPayload) : null);
      },
      () => setInsightDoc(null)
    );
    return () => unsubscribe();
  }, [metrics.dateKey, user?.organizationId]);

  const handleGenerateInsights = async () => {
    if (!firebaseUser) return;
    setInsightLoading(true);
    setInsightError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/client/insights", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "AI insights failed.");
      }
    } catch (error: any) {
      setInsightError(error.message || "AI insights failed.");
    } finally {
      setInsightLoading(false);
    }
  };

  useEffect(() => {
    if (!firebaseUser) return;
    setInsightRequested(false);
  }, [firebaseUser, metrics.dateKey, user?.organizationId]);

  useEffect(() => {
    if (!firebaseUser || insightDoc || insightRequested) return;
    setInsightRequested(true);
    handleGenerateInsights();
  }, [firebaseUser, insightDoc, insightRequested]);

  const lastInsightAt = insightDoc?.generatedAt?.toDate?.().toLocaleString("en-AU");
  const orgName = organization?.name || user?.organizationName || "your organisation";
  const today = startOfDay(new Date());
  const yearStart = startOfYear(new Date());

  const orgJobs = useMemo(() => {
    if (!user?.organizationId) return jobs;
    return jobs.filter((job) => job.organizationId === user.organizationId || job.clientId === user.organizationId);
  }, [jobs, user?.organizationId]);

  const getBookingDateTime = (booking: Booking) => {
    const date = booking.scheduledDate.toDate();
    const [hours, minutes] = booking.scheduledTime.split(":").map((part) => Number(part));
    if (Number.isFinite(hours)) date.setHours(hours);
    if (Number.isFinite(minutes)) date.setMinutes(minutes);
    date.setSeconds(0, 0);
    return date;
  };

  const getJobDateTime = (job: Job) => {
    const date = job.scheduledDate?.toDate?.() || job.booking?.preferredDate?.toDate?.();
    if (!date) return null;
    const time = job.booking?.preferredTime;
    if (time) {
      const [hours, minutes] = time.split(":").map((part) => Number(part));
      if (Number.isFinite(hours)) date.setHours(hours);
      if (Number.isFinite(minutes)) date.setMinutes(minutes);
    }
    date.setSeconds(0, 0);
    return date;
  };

  const upcomingBookings = useMemo(() => {
    return orgJobs
      .filter((job) => job.status !== "cancelled")
      .map((job) => ({ job, dateTime: getJobDateTime(job) }))
      .filter((entry): entry is { job: Job; dateTime: Date } => Boolean(entry.dateTime))
      .filter(({ dateTime }) => dateTime >= today)
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
      .slice(0, 3);
  }, [orgJobs, today]);

  const completedBookings = useMemo(() => {
    return orgJobs
      .filter((job) => job.status === "completed" || job.status === "closed")
      .map((job) => ({
        job,
        dateTime: job.completedDate?.toDate?.() || job.updatedAt?.toDate?.() || getJobDateTime(job),
      }))
      .filter((entry): entry is { job: Job; dateTime: Date } => Boolean(entry.dateTime))
      .sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime())
      .slice(0, 3);
  }, [orgJobs]);

  const pendingInspectionApprovals = useMemo(() => {
    return inspections.filter(
      (inspection) =>
        inspection.status === "submitted" ||
        inspection.clientApprovalStatus === "pending" ||
        inspection.clientApprovalStatus === "partial"
    );
  }, [inspections]);

  const scheduledWorksCount = useMemo(() => {
    const scheduledJobs = orgJobs.filter((job) =>
      ["scheduled", "pending", "in_progress"].includes(job.status)
    );
    const count = scheduledJobs.reduce((total, job) => total + (job.jobVehicles?.length || 0), 0);
    return count || scheduledJobs.length;
  }, [orgJobs]);

  const completedWorksYtd = useMemo(() => {
    const completedJobs = orgJobs.filter((job) => job.status === "completed" || job.status === "closed");
    const inYear = completedJobs.filter((job) => {
      const completedAt = job.completedDate?.toDate?.() || job.updatedAt?.toDate?.();
      return completedAt ? completedAt >= yearStart : false;
    });
    const repairsCount = inYear.reduce((total, job) => {
      const jobVehicleCount = job.jobVehicles?.length || 0;
      const repairCount = job.jobVehicles?.reduce(
        (count, vehicle) =>
          count + (vehicle.repairSites?.filter((repair) => repair.isCompleted).length || 0),
        0
      );
      return total + (repairCount || jobVehicleCount || 0);
    }, 0);
    return repairsCount;
  }, [orgJobs, yearStart]);

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Welcome back, {user?.name || "there"}!
        </h2>
        <p className="text-muted-foreground">
          {orgName} service performance, sustainability, and insights.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Inspections</CardTitle>
            <CardDescription>
              {pendingInspectionApprovals.length} awaiting your approval
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="text-2xl font-bold">{pendingInspectionApprovals.length}</div>
              {pendingInspectionApprovals.length > 0 ? (
                <Badge variant="secondary">Action required</Badge>
              ) : (
                <Badge variant="outline">All clear</Badge>
              )}
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Review quotes and approve vehicle repairs.
            </div>
            <Button variant="ghost" size="sm" className="mt-3 px-0" asChild>
              <Link href="/client/inspections">Review inspections</Link>
            </Button>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Current Works Scheduled</CardTitle>
            <CardDescription>Vehicles scheduled and in progress</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{scheduledWorksCount}</div>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Works Completed (YTD)</CardTitle>
            <CardDescription>Completed vehicle works this calendar year</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedWorksYtd}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Leaf className="h-4 w-4 text-emerald-400" />
              Sustainability & Value
            </CardTitle>
            <CardDescription>Environmental and downtime benefits.</CardDescription>
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
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-base">Operations Snapshot</CardTitle>
            <CardDescription>Live service performance.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Jobs completed</span>
              <span className="font-medium">{metrics.operations.jobsCompleted}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>In progress</span>
              <span className="font-medium">{metrics.operations.jobsInProgress}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Scheduled</span>
              <span className="font-medium">{metrics.operations.jobsScheduled}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Avg completion time</span>
              <span className="font-medium">{formatHours(metrics.operations.avgCompletionHours)}</span>
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
              {lastInsightAt ? `Last updated ${lastInsightAt}` : "Generating insights..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {insightDoc?.summary ? (
              <p className="text-sm text-muted-foreground">{insightDoc.summary}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Insights will appear once the analysis completes.
              </p>
            )}
            {insightDoc?.alerts?.length ? (
              <div className="space-y-1">
                {insightDoc.alerts.map((alert) => (
                  <p key={alert} className="text-xs text-muted-foreground">
                    {alert}
                  </p>
                ))}
              </div>
            ) : null}
            {insightError ? (
              <div className="flex items-center gap-2 text-xs text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {insightError}
              </div>
            ) : null}
            <Button onClick={handleGenerateInsights} disabled={insightLoading}>
              {insightLoading ? "Generating..." : "Refresh AI insights"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="h-4 w-4 text-primary" />
              Upcoming bookings
            </CardTitle>
            <CardDescription>Next 3 scheduled visits.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {upcomingBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming bookings.</p>
            ) : (
              upcomingBookings.map(({ job, dateTime }) => (
                <div key={job.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{job.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {job.clientName}
                    </div>
                    {dateTime && (
                      <div className="text-xs text-muted-foreground">
                        {format(dateTime, "PPP")} at {job.booking?.preferredTime || "Scheduled"}
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary">{statusLabel(job.status)}</Badge>
                </div>
              ))
            )}
            <Button variant="ghost" size="sm" className="self-start" asChild>
              <Link href="/client/bookings">View all bookings</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              Completed bookings
            </CardTitle>
            <CardDescription>Past 3 bookings on record.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {completedBookings.length === 0 ? (
              <p className="text-sm text-muted-foreground">No completed bookings yet.</p>
            ) : (
              completedBookings.map(({ job, dateTime }) => (
                <div key={job.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{job.jobNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {job.clientName}
                    </div>
                    {dateTime && (
                      <div className="text-xs text-muted-foreground">
                        {format(dateTime, "PPP")}
                      </div>
                    )}
                  </div>
                  <Badge variant="secondary">{statusLabel(job.status)}</Badge>
                </div>
              ))
            )}
            <Button variant="ghost" size="sm" className="self-start" asChild>
              <Link href="/client/bookings">View all bookings</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
