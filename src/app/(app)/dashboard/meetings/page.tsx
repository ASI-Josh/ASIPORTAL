"use client";

import { useEffect, useState, useMemo } from "react";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import {
  CalendarClock,
  ListChecks,
  AlertTriangle,
  CalendarCheck,
  Plus,
  Loader2,
  Users,
  ChevronRight,
} from "lucide-react";
import type { Meeting, MeetingAction } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-600/30 text-gray-300 border-gray-500/40",
  scheduled: "bg-[#0080FF]/15 text-[#0080FF] border-[#0080FF]/30",
  in_progress: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  completed: "bg-[#00C853]/15 text-[#00C853] border-[#00C853]/30",
  cancelled: "bg-red-500/15 text-red-400 border-red-500/30",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  in_progress: "In Progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

const TYPE_LABELS: Record<string, string> = {
  management_review: "Management Review",
  startup: "Startup",
  whs_committee: "WHS Committee",
  department: "Department",
  project: "Project",
  incident_review: "Incident Review",
  custom: "Custom",
};

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return "—";
  return ts.toDate().toLocaleDateString("en-AU");
}

export default function MeetingsPage() {
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [actions, setActions] = useState<MeetingAction[]>([]);
  const [loading, setLoading] = useState(true);

  // Subscribe to meetings
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MEETINGS),
      orderBy("scheduledDate", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setMeetings(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Meeting, "id">) }))
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  // Subscribe to meeting actions
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MEETING_ACTIONS),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setActions(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MeetingAction, "id">) }))
      );
    });
  }, []);

  // KPI calculations
  const now = Timestamp.now();
  const kpis = useMemo(() => {
    const upcoming = meetings.filter(
      (m) => m.status === "scheduled" && m.scheduledDate?.toMillis() > now.toMillis()
    ).length;

    const openActions = actions.filter(
      (a) => a.status === "open" || a.status === "in_progress"
    ).length;

    const overdueActions = actions.filter(
      (a) =>
        a.dueDate?.toMillis() < now.toMillis() &&
        a.status !== "completed" &&
        a.status !== "cancelled"
    ).length;

    const currentMonth = new Date().getMonth();
    const currentYear = new Date().getFullYear();
    const thisMonth = meetings.filter((m) => {
      if (m.status !== "completed" || !m.completedAt) return false;
      const d = m.completedAt.toDate();
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }).length;

    return { upcoming, openActions, overdueActions, thisMonth };
  }, [meetings, actions, now]);

  const isAdmin = user?.role === "admin";

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[#8000FF]" />
        <span className="ml-3 text-gray-400">Loading meetings...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            Meetings
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Manage meetings, agendas, and action items
          </p>
        </div>
        {isAdmin && (
          <Link href="/dashboard/meetings/new">
            <Button className="bg-[#8000FF] hover:bg-[#8000FF]/80 text-white">
              <Plus className="h-4 w-4 mr-2" />
              New Meeting
            </Button>
          </Link>
        )}
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Upcoming Meetings
            </CardTitle>
            <CalendarClock className="h-5 w-5 text-[#0080FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{kpis.upcoming}</div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Open Actions
            </CardTitle>
            <ListChecks className="h-5 w-5 text-[#8000FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{kpis.openActions}</div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Overdue Actions
            </CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </CardHeader>
          <CardContent>
            <div
              className={`text-3xl font-bold ${
                kpis.overdueActions > 0 ? "text-red-400" : "text-white"
              }`}
            >
              {kpis.overdueActions}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Meetings This Month
            </CardTitle>
            <CalendarCheck className="h-5 w-5 text-[#00C853]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{kpis.thisMonth}</div>
          </CardContent>
        </Card>
      </div>

      {/* Meeting List */}
      <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
        <CardHeader>
          <CardTitle className="text-white font-['Space_Grotesk']">
            All Meetings
          </CardTitle>
        </CardHeader>
        <CardContent>
          {meetings.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-40" />
              <p>No meetings yet.</p>
              {isAdmin && (
                <Link href="/dashboard/meetings/new">
                  <Button
                    variant="outline"
                    className="mt-4 border-[#8000FF]/40 text-[#8000FF] hover:bg-[#8000FF]/10"
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    Create First Meeting
                  </Button>
                </Link>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {/* Table header */}
              <div className="hidden md:grid md:grid-cols-[100px_1fr_140px_110px_110px_140px_60px_40px] gap-3 px-4 py-2 text-xs text-gray-500 uppercase tracking-wider border-b border-white/5">
                <span>Number</span>
                <span>Title</span>
                <span>Type</span>
                <span>Date</span>
                <span>Status</span>
                <span>Chair</span>
                <span>Decisions</span>
                <span></span>
              </div>

              {/* Rows */}
              {meetings.map((meeting) => (
                <Link
                  key={meeting.id}
                  href={`/dashboard/meetings/${meeting.id}`}
                  className="block"
                >
                  <div className="grid grid-cols-1 md:grid-cols-[100px_1fr_140px_110px_110px_140px_60px_40px] gap-3 px-4 py-3 rounded-lg hover:bg-white/5 transition-colors items-center group">
                    <span className="text-sm font-mono text-[#0080FF]">
                      {meeting.meetingNumber}
                    </span>

                    <span className="text-sm text-white font-medium truncate">
                      {meeting.title}
                    </span>

                    <div>
                      <Badge
                        variant="outline"
                        className="bg-[#8000FF]/10 text-[#8000FF]/80 border-[#8000FF]/25 text-xs"
                      >
                        {TYPE_LABELS[meeting.meetingType] || meeting.meetingType}
                      </Badge>
                    </div>

                    <span className="text-sm text-gray-300">
                      {formatDate(meeting.scheduledDate)}
                    </span>

                    <div>
                      <Badge
                        variant="outline"
                        className={`text-xs ${STATUS_COLORS[meeting.status] || ""}`}
                      >
                        {STATUS_LABELS[meeting.status] || meeting.status}
                      </Badge>
                    </div>

                    <span className="text-sm text-gray-400 truncate">
                      {meeting.chair?.name || "—"}
                    </span>

                    <span className="text-sm text-gray-400 text-center">
                      {meeting.decisions?.length || 0}
                    </span>

                    <ChevronRight className="h-4 w-4 text-gray-600 group-hover:text-gray-400 transition-colors ml-auto" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
