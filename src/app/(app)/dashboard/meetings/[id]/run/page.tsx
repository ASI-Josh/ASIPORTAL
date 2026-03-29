"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { doc, onSnapshot, updateDoc, Timestamp, collection, addDoc } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/collections";
import type { Meeting, MeetingAction, AgendaItem, MeetingDecision } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Clock,
  Plus,
  X,
  Users,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ============================================
// HELPERS
// ============================================

function formatTime(totalSeconds: number): string {
  const abs = Math.abs(totalSeconds);
  const m = Math.floor(abs / 60);
  const s = abs % 60;
  const sign = totalSeconds < 0 ? "-" : "";
  return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function generateId(): string {
  return crypto.randomUUID?.() ?? Math.random().toString(36).slice(2, 15);
}

// ============================================
// STEP LABELS
// ============================================

function buildStepLabels(agendaItems: AgendaItem[]): string[] {
  const labels: string[] = ["Roll Call", "Previous Actions"];
  agendaItems.forEach((item) => labels.push(item.title));
  labels.push("Other Business");
  labels.push("Summary & Close");
  return labels;
}

// ============================================
// PROGRESS BAR
// ============================================

function ProgressBar({
  steps,
  currentStep,
  onStepClick,
}: {
  steps: string[];
  currentStep: number;
  onStepClick: (idx: number) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {steps.map((label, idx) => {
        const isCompleted = idx < currentStep;
        const isCurrent = idx === currentStep;
        return (
          <button
            key={idx}
            onClick={() => {
              if (isCompleted) onStepClick(idx);
            }}
            disabled={!isCompleted && !isCurrent}
            className={cn(
              "flex flex-col items-center gap-1 min-w-[80px] px-2 py-1 rounded-lg transition-colors",
              isCompleted && "cursor-pointer hover:bg-white/5",
              !isCompleted && !isCurrent && "cursor-default opacity-40"
            )}
          >
            <div
              className={cn(
                "w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors",
                isCurrent && "border-[#8000FF] bg-[#8000FF]",
                isCompleted && "border-[#00C853] bg-[#00C853]",
                !isCompleted && !isCurrent && "border-muted-foreground/40 bg-transparent"
              )}
            >
              {isCompleted && <Check className="w-3 h-3 text-white" />}
            </div>
            <span
              className={cn(
                "text-xs text-center leading-tight max-w-[100px] truncate",
                isCurrent && "text-[#8000FF] font-semibold",
                isCompleted && "text-[#00C853]",
                !isCompleted && !isCurrent && "text-muted-foreground/60"
              )}
            >
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================
// ROLL CALL STEP
// ============================================

function RollCallStep({
  meeting,
  meetingId,
}: {
  meeting: Meeting;
  meetingId: string;
}) {
  const toggleAttendance = async (attendeeId: string, currentValue: boolean) => {
    const updated = meeting.attendees.map((a) =>
      a.id === attendeeId ? { ...a, attended: !currentValue } : a
    );
    await updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
      attendees: updated,
      updatedAt: Timestamp.now(),
    });
  };

  return (
    <Card className="bg-[#1e1e2e] border-white/10">
      <CardHeader className="p-8">
        <CardTitle className="text-2xl flex items-center gap-3">
          <Users className="w-7 h-7 text-[#8000FF]" />
          Roll Call
        </CardTitle>
        <p className="text-muted-foreground text-lg mt-1">
          Mark attendees as present or absent
        </p>
      </CardHeader>
      <CardContent className="p-8 pt-0">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {meeting.attendees.map((attendee) => (
            <button
              key={attendee.id}
              onClick={() => toggleAttendance(attendee.id, attendee.attended)}
              className={cn(
                "flex items-center justify-between p-5 rounded-xl border transition-all",
                attendee.attended
                  ? "border-[#00C853]/40 bg-[#00C853]/10"
                  : "border-white/10 bg-white/5"
              )}
            >
              <div className="text-left">
                <p className="text-lg font-medium">{attendee.name}</p>
                <p className="text-sm text-muted-foreground capitalize">
                  {attendee.role}
                  {attendee.department ? ` — ${attendee.department}` : ""}
                </p>
              </div>
              <div
                className={cn(
                  "w-10 h-6 rounded-full relative transition-colors",
                  attendee.attended ? "bg-[#00C853]" : "bg-white/20"
                )}
              >
                <div
                  className={cn(
                    "absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform",
                    attendee.attended ? "translate-x-4" : "translate-x-0.5"
                  )}
                />
              </div>
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// PREVIOUS ACTIONS STEP
// ============================================

function PreviousActionsStep() {
  return (
    <Card className="bg-[#1e1e2e] border-white/10">
      <CardHeader className="p-8">
        <CardTitle className="text-2xl flex items-center gap-3">
          <Clock className="w-7 h-7 text-[#0080FF]" />
          Previous Actions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8 pt-0">
        <div className="text-center py-12 text-muted-foreground text-lg">
          No previous actions to review
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// AGENDA ITEM TIMER
// ============================================

function AgendaTimer({ durationMinutes }: { durationMinutes: number }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed((prev) => prev + 1);
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const totalSeconds = durationMinutes * 60;
  const remaining = totalSeconds - elapsed;
  const isWarning = remaining <= 120 && remaining > 0;
  const isOvertime = remaining <= 0;

  return (
    <div
      className={cn(
        "font-mono text-2xl font-bold tabular-nums",
        isOvertime && "text-red-500",
        isWarning && !isOvertime && "text-amber-400",
        !isWarning && !isOvertime && "text-muted-foreground"
      )}
    >
      <Clock className="inline w-5 h-5 mr-2 -mt-1" />
      {formatTime(remaining)}
      {isOvertime && (
        <span className="text-sm ml-2 font-normal text-red-400">OVERTIME</span>
      )}
    </div>
  );
}

// ============================================
// AGENDA ITEM STEP
// ============================================

const AGENDA_TYPE_COLORS: Record<string, string> = {
  discussion: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  decision: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  information: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  agent_report: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  action_review: "bg-amber-500/20 text-amber-400 border-amber-500/30",
};

function AgendaItemStep({
  item,
  itemIndex,
  meeting,
  meetingId,
}: {
  item: AgendaItem;
  itemIndex: number;
  meeting: Meeting;
  meetingId: string;
}) {
  const { toast } = useToast();
  const [notes, setNotes] = useState(item.notes ?? "");
  const [showDecisionForm, setShowDecisionForm] = useState(false);
  const [showActionForm, setShowActionForm] = useState(false);

  // Decision form state
  const [decisionDesc, setDecisionDesc] = useState("");
  const [decisionRationale, setDecisionRationale] = useState("");

  // Action form state
  const [actionTitle, setActionTitle] = useState("");
  const [actionAssignee, setActionAssignee] = useState("");
  const [actionDueDate, setActionDueDate] = useState("");
  const [actionPriority, setActionPriority] = useState<"low" | "medium" | "high" | "critical">("medium");

  // Sync notes from prop if it changes externally
  useEffect(() => {
    setNotes(item.notes ?? "");
  }, [item.notes]);

  const saveNotes = async () => {
    const updatedItems = [...meeting.agendaItems];
    updatedItems[itemIndex] = { ...updatedItems[itemIndex], notes };
    await updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
      agendaItems: updatedItems,
      updatedAt: Timestamp.now(),
    });
  };

  const saveDecision = async () => {
    if (!decisionDesc.trim()) return;
    const decision: MeetingDecision = {
      id: generateId(),
      agendaItemId: item.id,
      description: decisionDesc.trim(),
      decidedBy: meeting.chair.name,
      rationale: decisionRationale.trim() || undefined,
      createdAt: Timestamp.now(),
    };
    const updatedDecisions = [...(meeting.decisions || []), decision];
    await updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
      decisions: updatedDecisions,
      updatedAt: Timestamp.now(),
    });
    setDecisionDesc("");
    setDecisionRationale("");
    setShowDecisionForm(false);
    toast({ title: "Decision recorded" });
  };

  const saveAction = async () => {
    if (!actionTitle.trim() || !actionAssignee.trim() || !actionDueDate) return;
    const now = Timestamp.now();
    const actionData = {
      meetingId,
      meetingNumber: meeting.meetingNumber,
      agendaItemId: item.id,
      title: actionTitle.trim(),
      assignedTo: { id: "", name: actionAssignee.trim(), email: "" },
      dueDate: Timestamp.fromDate(new Date(actionDueDate)),
      status: "open",
      priority: actionPriority,
      createdAt: now,
      updatedAt: now,
    };
    await addDoc(collection(db, COLLECTIONS.MEETING_ACTIONS), actionData);
    setActionTitle("");
    setActionAssignee("");
    setActionDueDate("");
    setActionPriority("medium");
    setShowActionForm(false);
    toast({ title: "Action created" });
  };

  // Decisions for this agenda item
  const itemDecisions = (meeting.decisions || []).filter(
    (d) => d.agendaItemId === item.id
  );

  return (
    <Card className="bg-[#1e1e2e] border-white/10">
      <CardHeader className="p-8">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <Badge
                variant="outline"
                className={cn(
                  "capitalize text-sm",
                  AGENDA_TYPE_COLORS[item.type] || ""
                )}
              >
                {item.type.replace("_", " ")}
              </Badge>
              {item.presenter && (
                <span className="text-sm text-muted-foreground">
                  Presenter: <span className="text-white">{item.presenter}</span>
                </span>
              )}
            </div>
            <CardTitle className="text-2xl">{item.title}</CardTitle>
            {item.description && (
              <p className="text-muted-foreground text-lg mt-2">{item.description}</p>
            )}
          </div>
          {item.duration && <AgendaTimer durationMinutes={item.duration} />}
        </div>
      </CardHeader>

      <CardContent className="p-8 pt-0 space-y-6">
        {/* Notes */}
        <div>
          <Label className="text-lg font-medium mb-2 block">Notes</Label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={saveNotes}
            placeholder="Capture discussion notes..."
            className="min-h-[120px] bg-white/5 border-white/10 text-lg"
          />
        </div>

        {/* Existing decisions */}
        {itemDecisions.length > 0 && (
          <div>
            <Label className="text-lg font-medium mb-2 block">Decisions</Label>
            <div className="space-y-2">
              {itemDecisions.map((d) => (
                <div
                  key={d.id}
                  className="p-4 rounded-lg bg-purple-500/10 border border-purple-500/20"
                >
                  <p className="text-lg">{d.description}</p>
                  {d.rationale && (
                    <p className="text-sm text-muted-foreground mt-1">
                      Rationale: {d.rationale}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Decision form */}
        {showDecisionForm && (
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold">Record Decision</Label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDecisionForm(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div>
              <Label className="mb-1 block">Description</Label>
              <Textarea
                value={decisionDesc}
                onChange={(e) => setDecisionDesc(e.target.value)}
                placeholder="What was decided?"
                className="bg-white/5 border-white/10"
              />
            </div>
            <div>
              <Label className="mb-1 block">Rationale</Label>
              <Textarea
                value={decisionRationale}
                onChange={(e) => setDecisionRationale(e.target.value)}
                placeholder="Why was this decided?"
                className="bg-white/5 border-white/10"
              />
            </div>
            <Button onClick={saveDecision} className="bg-[#8000FF] hover:bg-[#6b00d6]">
              Save Decision
            </Button>
          </div>
        )}

        {/* Action form */}
        {showActionForm && (
          <div className="p-6 rounded-xl bg-white/5 border border-white/10 space-y-4">
            <div className="flex items-center justify-between">
              <Label className="text-lg font-semibold">Create Action</Label>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowActionForm(false)}
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div>
              <Label className="mb-1 block">Title</Label>
              <Input
                value={actionTitle}
                onChange={(e) => setActionTitle(e.target.value)}
                placeholder="Action item title"
                className="bg-white/5 border-white/10"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <Label className="mb-1 block">Assignee</Label>
                <Input
                  value={actionAssignee}
                  onChange={(e) => setActionAssignee(e.target.value)}
                  placeholder="Name"
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div>
                <Label className="mb-1 block">Due Date</Label>
                <Input
                  type="date"
                  value={actionDueDate}
                  onChange={(e) => setActionDueDate(e.target.value)}
                  className="bg-white/5 border-white/10"
                />
              </div>
              <div>
                <Label className="mb-1 block">Priority</Label>
                <Select
                  value={actionPriority}
                  onValueChange={(v) =>
                    setActionPriority(v as "low" | "medium" | "high" | "critical")
                  }
                >
                  <SelectTrigger className="bg-white/5 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={saveAction} className="bg-[#8000FF] hover:bg-[#6b00d6]">
              Save Action
            </Button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-3">
          {!showDecisionForm && (
            <Button
              variant="outline"
              onClick={() => setShowDecisionForm(true)}
              className="border-white/10"
            >
              <Plus className="w-4 h-4 mr-2" />
              Record Decision
            </Button>
          )}
          {!showActionForm && (
            <Button
              variant="outline"
              onClick={() => setShowActionForm(true)}
              className="border-white/10"
            >
              <Plus className="w-4 h-4 mr-2" />
              Create Action
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================
// OTHER BUSINESS STEP
// ============================================

function OtherBusinessStep({
  meeting,
  meetingId,
}: {
  meeting: Meeting;
  meetingId: string;
}) {
  const [notes, setNotes] = useState((meeting as any).otherBusinessNotes ?? "");

  const saveNotes = async () => {
    await updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
      otherBusinessNotes: notes,
      updatedAt: Timestamp.now(),
    });
  };

  return (
    <Card className="bg-[#1e1e2e] border-white/10">
      <CardHeader className="p-8">
        <CardTitle className="text-2xl flex items-center gap-3">
          <AlertTriangle className="w-7 h-7 text-amber-400" />
          Other Business
        </CardTitle>
        <p className="text-muted-foreground text-lg mt-1">
          Raise any items not covered in the agenda
        </p>
      </CardHeader>
      <CardContent className="p-8 pt-0">
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
          placeholder="Free-form notes for other business items..."
          className="min-h-[200px] bg-white/5 border-white/10 text-lg"
        />
      </CardContent>
    </Card>
  );
}

// ============================================
// SUMMARY & CLOSE STEP
// ============================================

function SummaryStep({
  meeting,
  meetingId,
  actionsCreatedCount,
}: {
  meeting: Meeting;
  meetingId: string;
  actionsCreatedCount: number;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const attendedCount = meeting.attendees.filter((a) => a.attended).length;
  const totalAttendees = meeting.attendees.length;
  const decisionsCount = (meeting.decisions || []).length;
  const itemsCount = meeting.agendaItems.length;

  // Calculate duration
  let durationText = "N/A";
  if (meeting.startedAt) {
    const startMs = meeting.startedAt.toMillis();
    const nowMs = Date.now();
    const mins = Math.round((nowMs - startMs) / 60000);
    durationText = `${mins} minutes`;
  }

  const autoSummary = [
    `Attendance: ${attendedCount}/${totalAttendees}`,
    `Duration: ${durationText}`,
    `Agenda items: ${itemsCount}`,
    `Decisions recorded: ${decisionsCount}`,
    `Actions created: ${actionsCreatedCount}`,
  ].join("\n");

  const [summary, setSummary] = useState(meeting.summary || autoSummary);
  const [closing, setClosing] = useState(false);

  const closeMeeting = async () => {
    setClosing(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
        status: "completed",
        completedAt: Timestamp.now(),
        summary,
        updatedAt: Timestamp.now(),
      });
      toast({ title: "Meeting closed", description: "Meeting has been completed." });
      router.push(`/dashboard/meetings/${meetingId}`);
    } catch {
      toast({ title: "Error", description: "Failed to close meeting", variant: "destructive" });
      setClosing(false);
    }
  };

  return (
    <Card className="bg-[#1e1e2e] border-white/10">
      <CardHeader className="p-8">
        <CardTitle className="text-2xl flex items-center gap-3">
          <Check className="w-7 h-7 text-[#00C853]" />
          Summary &amp; Close
        </CardTitle>
      </CardHeader>
      <CardContent className="p-8 pt-0 space-y-6">
        {/* Auto-generated stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-3xl font-bold text-[#8000FF]">
              {attendedCount}/{totalAttendees}
            </p>
            <p className="text-sm text-muted-foreground mt-1">Attendance</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-3xl font-bold text-[#0080FF]">{durationText}</p>
            <p className="text-sm text-muted-foreground mt-1">Duration</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-3xl font-bold text-purple-400">{decisionsCount}</p>
            <p className="text-sm text-muted-foreground mt-1">Decisions</p>
          </div>
          <div className="p-4 rounded-xl bg-white/5 border border-white/10 text-center">
            <p className="text-3xl font-bold text-amber-400">{actionsCreatedCount}</p>
            <p className="text-sm text-muted-foreground mt-1">Actions</p>
          </div>
        </div>

        {/* Decisions list */}
        {(meeting.decisions || []).length > 0 && (
          <div>
            <Label className="text-lg font-medium mb-2 block">Decisions Made</Label>
            <div className="space-y-2">
              {meeting.decisions.map((d, i) => (
                <div
                  key={d.id}
                  className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20"
                >
                  <p className="text-base">
                    {i + 1}. {d.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Editable summary */}
        <div>
          <Label className="text-lg font-medium mb-2 block">Meeting Summary</Label>
          <Textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="min-h-[160px] bg-white/5 border-white/10 text-lg"
          />
        </div>

        {/* Close meeting */}
        <Button
          onClick={closeMeeting}
          disabled={closing}
          size="lg"
          className="w-full bg-[#00C853] hover:bg-[#00a844] text-white text-lg h-14"
        >
          {closing ? "Closing..." : "Close Meeting"}
        </Button>
      </CardContent>
    </Card>
  );
}

// ============================================
// MAIN PAGE COMPONENT
// ============================================

export default function MeetingRunPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const meetingId = params.id as string;

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(0);
  const [actionsCreatedCount, setActionsCreatedCount] = useState(0);
  const startedRef = useRef(false);

  // ---- Real-time meeting listener ----
  useEffect(() => {
    if (!meetingId) return;
    const unsub = onSnapshot(
      doc(db, COLLECTIONS.MEETINGS, meetingId),
      (snap) => {
        if (snap.exists()) {
          setMeeting({ id: snap.id, ...snap.data() } as Meeting);
        }
        setLoading(false);
      },
      (err) => {
        console.error("Meeting snapshot error:", err);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [meetingId]);

  // ---- Track actions created count (real-time) ----
  useEffect(() => {
    if (!meetingId) return;
    const q = collection(db, COLLECTIONS.MEETING_ACTIONS);
    // Simple approach: listen to full collection and filter client-side
    // For production, use a query with where clause
    const unsub = onSnapshot(q, (snap) => {
      const count = snap.docs.filter(
        (d) => d.data().meetingId === meetingId
      ).length;
      setActionsCreatedCount(count);
    });
    return () => unsub();
  }, [meetingId]);

  // ---- Auto-start meeting on mount ----
  useEffect(() => {
    if (!meeting || startedRef.current) return;
    if (meeting.status === "scheduled") {
      startedRef.current = true;
      updateDoc(doc(db, COLLECTIONS.MEETINGS, meetingId), {
        status: "in_progress",
        startedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      }).catch((err) => console.error("Failed to start meeting:", err));
    } else {
      startedRef.current = true;
    }
  }, [meeting, meetingId]);

  // ---- Loading state ----
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-4 border-[#8000FF] border-t-transparent animate-spin mx-auto" />
          <p className="text-lg text-muted-foreground">Loading meeting...</p>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto" />
          <p className="text-lg">Meeting not found</p>
          <Button
            variant="outline"
            onClick={() => router.push("/dashboard/meetings")}
          >
            Back to Meetings
          </Button>
        </div>
      </div>
    );
  }

  // ---- Build steps ----
  const agendaItems = meeting.agendaItems || [];
  const stepLabels = buildStepLabels(agendaItems);
  const totalSteps = stepLabels.length;

  // Step indices
  const ROLL_CALL = 0;
  const PREV_ACTIONS = 1;
  const FIRST_AGENDA = 2;
  const OTHER_BUSINESS = FIRST_AGENDA + agendaItems.length;
  const SUMMARY = OTHER_BUSINESS + 1;

  // ---- Render step content ----
  const renderStep = () => {
    if (currentStep === ROLL_CALL) {
      return <RollCallStep meeting={meeting} meetingId={meetingId} />;
    }
    if (currentStep === PREV_ACTIONS) {
      return <PreviousActionsStep />;
    }
    if (currentStep >= FIRST_AGENDA && currentStep < OTHER_BUSINESS) {
      const idx = currentStep - FIRST_AGENDA;
      return (
        <AgendaItemStep
          key={agendaItems[idx].id}
          item={agendaItems[idx]}
          itemIndex={idx}
          meeting={meeting}
          meetingId={meetingId}
        />
      );
    }
    if (currentStep === OTHER_BUSINESS) {
      return <OtherBusinessStep meeting={meeting} meetingId={meetingId} />;
    }
    if (currentStep === SUMMARY) {
      return (
        <SummaryStep
          meeting={meeting}
          meetingId={meetingId}
          actionsCreatedCount={actionsCreatedCount}
        />
      );
    }
    return null;
  };

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
      {/* ---- Header ---- */}
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.push(`/dashboard/meetings/${meetingId}`)}
          className="shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{meeting.title}</h1>
          <p className="text-sm text-muted-foreground">
            {meeting.meetingNumber} &middot;{" "}
            <Badge variant="outline" className="text-[#00C853] border-[#00C853]/30">
              In Progress
            </Badge>
          </p>
        </div>
      </div>

      {/* ---- Progress Bar ---- */}
      <ProgressBar
        steps={stepLabels}
        currentStep={currentStep}
        onStepClick={(idx) => setCurrentStep(idx)}
      />

      {/* ---- Step Content ---- */}
      {renderStep()}

      {/* ---- Navigation ---- */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
          disabled={currentStep === 0}
          className="border-white/10"
        >
          <ChevronLeft className="w-4 h-4 mr-2" />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Step {currentStep + 1} of {totalSteps}
        </span>
        {currentStep < totalSteps - 1 ? (
          <Button
            onClick={() => setCurrentStep((s) => Math.min(totalSteps - 1, s + 1))}
            className="bg-[#8000FF] hover:bg-[#6b00d6]"
          >
            Next
            <ChevronRight className="w-4 h-4 ml-2" />
          </Button>
        ) : (
          <div className="w-[100px]" /> // Spacer — close button is in the summary card
        )}
      </div>
    </div>
  );
}
