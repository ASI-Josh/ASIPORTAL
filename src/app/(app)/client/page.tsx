"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { format, startOfDay } from "date-fns";
import { AlertTriangle, Leaf, LineChart, CalendarClock, CheckCircle2 } from "lucide-react";
import { collection, doc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { Booking, ContactOrganization, Inspection } from "@/lib/types";
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

  const getBookingDateTime = (booking: Booking) => {
    const date = booking.scheduledDate.toDate();
    const [hours, minutes] = booking.scheduledTime.split(":").map((part) => Number(part));
    if (Number.isFinite(hours)) date.setHours(hours);
    if (Number.isFinite(minutes)) date.setMinutes(minutes);
    date.setSeconds(0, 0);
    return date;
  };

  const upcomingBookings = useMemo(() => {
    return bookings
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => ({ booking, dateTime: getBookingDateTime(booking) }))
      .filter(({ dateTime }) => dateTime >= today)
      .sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime())
      .slice(0, 3);
  }, [bookings, today]);

  const completedBookings = useMemo(() => {
    return bookings
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => ({ booking, dateTime: getBookingDateTime(booking) }))
      .filter(({ dateTime }) => dateTime < today)
      .sort((a, b) => b.dateTime.getTime() - a.dateTime.getTime())
      .slice(0, 3);
  }, [bookings, today]);

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
              upcomingBookings.map(({ booking, dateTime }) => (
                <div key={booking.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{booking.bookingNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {booking.organizationName} • {booking.contactName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(dateTime, "PPP")} at {booking.scheduledTime}
                    </div>
                  </div>
                  <Badge variant="secondary">{booking.status.replace("_", " ")}</Badge>
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
              completedBookings.map(({ booking, dateTime }) => (
                <div key={booking.id} className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium">{booking.bookingNumber}</div>
                    <div className="text-xs text-muted-foreground">
                      {booking.organizationName} • {booking.contactName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {format(dateTime, "PPP")} at {booking.scheduledTime}
                    </div>
                  </div>
                  <Badge variant="secondary">{booking.status.replace("_", " ")}</Badge>
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
