"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { doc, onSnapshot, Timestamp } from "firebase/firestore";
import {
  ArrowLeft,
  Play,
  Clock,
  Users,
  FileText,
  CheckCircle2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COLLECTIONS } from "@/lib/collections";
import { db } from "@/lib/firebaseClient";
import type { Meeting, MeetingStatus, MeetingType } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<MeetingStatus, string> = {
  draft: "bg-gray-600/30 text-gray-300 border-gray-500/40",
  scheduled: "bg-blue-600/30 text-blue-300 border-blue-500/40",
  in_progress: "bg-amber-600/30 text-amber-300 border-amber-500/40",
  completed: "bg-green-600/30 text-green-300 border-green-500/40",
  cancelled: "bg-red-600/30 text-red-300 border-red-500/40",
};

const TYPE_LABELS: Record<MeetingType, string> = {
  management_review: "Management Review",
  startup: "Startup Meeting",
  whs_committee: "WHS Committee",
  department: "Department",
  project: "Project",
  incident_review: "Incident Review",
  custom: "Custom",
};

function formatTimestamp(ts?: Timestamp | null): string {
  if (!ts) return "—";
  const d = ts.toDate();
  return d.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Page Component                                                    */
/* ------------------------------------------------------------------ */

export default function MeetingDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const meetingId = params.id as string;
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  /* ---- real-time listener ---- */
  useEffect(() => {
    const ref = doc(db, COLLECTIONS.MEETINGS, meetingId);
    const unsubscribe = onSnapshot(
      ref,
      (snap) => {
        if (!snap.exists()) {
          setNotFound(true);
          setMeeting(null);
        } else {
          setMeeting({ id: snap.id, ...(snap.data() as Omit<Meeting, "id">) });
          setNotFound(false);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Meeting snapshot error", err);
        toast({ title: "Error", description: "Failed to load meeting.", variant: "destructive" });
        setLoading(false);
      },
    );
    return () => unsubscribe();
  }, [meetingId, toast]);

  /* ---- guards ---- */
  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Clock className="mr-2 h-5 w-5 animate-spin text-muted-foreground" />
        <span className="text-muted-foreground">Loading meeting...</span>
      </div>
    );
  }

  if (notFound || !meeting) {
    return (
      <div className="space-y-4 py-12 text-center">
        <p className="text-muted-foreground">Meeting not found.</p>
        <Button variant="outline" asChild>
          <Link href="/dashboard/meetings">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Meetings
          </Link>
        </Button>
      </div>
    );
  }

  const isChair = user?.uid === meeting.chair?.id;
  const attendeeRoleBadge = (role: string) => {
    const map: Record<string, string> = {
      chair: "bg-violet-600/30 text-violet-300 border-violet-500/40",
      attendee: "bg-blue-600/30 text-blue-300 border-blue-500/40",
      observer: "bg-gray-600/30 text-gray-300 border-gray-500/40",
      agent: "bg-cyan-600/30 text-cyan-300 border-cyan-500/40",
    };
    return map[role] ?? map.attendee;
  };

  const agendaTypeBadge = (type: string) => {
    const map: Record<string, string> = {
      discussion: "bg-blue-600/30 text-blue-300 border-blue-500/40",
      decision: "bg-amber-600/30 text-amber-300 border-amber-500/40",
      information: "bg-gray-600/30 text-gray-300 border-gray-500/40",
      agent_report: "bg-cyan-600/30 text-cyan-300 border-cyan-500/40",
      action_review: "bg-violet-600/30 text-violet-300 border-violet-500/40",
    };
    return map[type] ?? map.information;
  };

  return (
    <div className="space-y-6">
      {/* Back button */}
      <Button variant="ghost" size="sm" asChild>
        <Link href="/dashboard/meetings">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Meetings
        </Link>
      </Button>

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight font-heading">
            {meeting.meetingNumber} &mdash; {meeting.title}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_COLORS[meeting.status]}>
              {meeting.status.replace("_", " ").toUpperCase()}
            </Badge>
            <Badge variant="outline">{TYPE_LABELS[meeting.meetingType] ?? meeting.meetingType}</Badge>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {meeting.status === "scheduled" && isChair && (
            <Button asChild>
              <Link href={`/dashboard/meetings/${meeting.id}/run`}>
                <Play className="mr-2 h-4 w-4" />
                Start Meeting
              </Link>
            </Button>
          )}
          {meeting.status === "completed" && meeting.completedAt && (
            <div className="flex items-center gap-1.5 text-sm text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              Completed {formatTimestamp(meeting.completedAt)}
            </div>
          )}
        </div>
      </div>

      {/* Details card */}
      <Card className="border-border/40 bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs text-muted-foreground">Scheduled Date</dt>
              <dd className="mt-0.5 text-sm">{formatTimestamp(meeting.scheduledDate)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Duration</dt>
              <dd className="mt-0.5 text-sm">{meeting.scheduledDuration} min</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Location</dt>
              <dd className="mt-0.5 text-sm">{meeting.location || "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Chair</dt>
              <dd className="mt-0.5 text-sm">{meeting.chair?.name ?? "—"}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* Attendees card */}
      <Card className="border-border/40 bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4 text-muted-foreground" />
            Attendees ({meeting.attendees?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {meeting.attendees?.length ? (
            <ul className="divide-y divide-border/30">
              {meeting.attendees.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">{a.name}</span>
                    <Badge className={attendeeRoleBadge(a.role)} variant="outline">
                      {a.role}
                    </Badge>
                    {a.department && (
                      <span className="text-xs text-muted-foreground">{a.department}</span>
                    )}
                  </div>
                  <span className="text-xs">
                    {a.attended ? (
                      <span className="flex items-center gap-1 text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Present
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No attendees listed.</p>
          )}
        </CardContent>
      </Card>

      {/* Agenda card */}
      <Card className="border-border/40 bg-card/60 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-muted-foreground" />
            Agenda ({meeting.agendaItems?.length ?? 0})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {meeting.agendaItems?.length ? (
            <ol className="space-y-3">
              {[...meeting.agendaItems]
                .sort((a, b) => a.order - b.order)
                .map((item, idx) => (
                  <li key={item.id} className="rounded-md border border-border/30 bg-background/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                          {idx + 1}
                        </span>
                        <div className="space-y-0.5">
                          <p className="text-sm font-medium">{item.title}</p>
                          {item.description && (
                            <p className="text-xs text-muted-foreground">{item.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <Badge className={agendaTypeBadge(item.type)} variant="outline">
                              {item.type.replace("_", " ")}
                            </Badge>
                            {item.presenter && (
                              <span className="text-xs text-muted-foreground">
                                Presenter: {item.presenter}
                              </span>
                            )}
                            {item.duration != null && (
                              <span className="text-xs text-muted-foreground">
                                {item.duration} min
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">No agenda items.</p>
          )}
        </CardContent>
      </Card>

      {/* Decisions card */}
      {meeting.decisions?.length > 0 && (
        <Card className="border-border/40 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              Decisions ({meeting.decisions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {meeting.decisions.map((d) => (
                <li key={d.id} className="rounded-md border border-border/30 bg-background/40 p-3">
                  <p className="text-sm">{d.description}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span>Decided by: {d.decidedBy}</span>
                    {d.rationale && <span>Rationale: {d.rationale}</span>}
                    {d.createdAt && <span>{formatTimestamp(d.createdAt)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Summary card */}
      {meeting.summary && (
        <Card className="border-border/40 bg-card/60 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-muted-foreground" />
              Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{meeting.summary}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
