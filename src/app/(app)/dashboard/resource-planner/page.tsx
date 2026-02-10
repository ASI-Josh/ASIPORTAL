"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  query,
  updateDoc,
  where,
  deleteField,
} from "firebase/firestore";
import {
  addDays,
  addMonths,
  endOfDay,
  format,
  getDaysInMonth,
  isBefore,
  startOfMonth,
  startOfDay,
  startOfWeek,
} from "date-fns";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  GripVertical,
  TriangleAlert,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/firestore";
import type { Booking, Job, ResourceDurationTemplate } from "@/lib/types";
import { BOOKING_TYPE_LABELS, RESOURCE_DURATION_LABELS } from "@/lib/types";

type StaffMember = {
  id: string;
  name: string;
  type: "asi_staff" | "subcontractor";
};

type AllocationWindow = {
  start: Date;
  end: Date;
  unit: "hours" | "days";
  value: number;
};

type AllocationEvent = {
  id: string;
  booking: Booking;
  staff: StaffMember;
  job: Job | null;
  window: AllocationWindow;
};

type PlannerViewMode = "day" | "week" | "month";

const DEFAULT_DURATION: Record<ResourceDurationTemplate, { unit: AllocationWindow["unit"]; value: number }> = {
  na: { unit: "hours", value: 1 },
  short: { unit: "days", value: 1 },
  medium: { unit: "days", value: 3 },
  long: { unit: "days", value: 5 },
};

function getBookingStartDateTime(booking: Booking): Date | null {
  const date = booking.scheduledDate?.toDate ? booking.scheduledDate.toDate() : null;
  if (!date) return null;
  const safe = new Date(date);
  const [hours, minutes] = (booking.scheduledTime || "07:00")
    .split(":")
    .map((part) => Number(part));
  if (Number.isFinite(hours)) safe.setHours(hours);
  if (Number.isFinite(minutes)) safe.setMinutes(minutes);
  safe.setSeconds(0, 0);
  return safe;
}

function resolveAllocationWindow(booking: Booking): AllocationWindow | null {
  const startAt = getBookingStartDateTime(booking);
  if (!startAt) return null;

  const template: ResourceDurationTemplate = booking.resourceDurationTemplate ?? "na";
  const defaults = DEFAULT_DURATION[template];

  if (defaults.unit === "hours") {
    const hours =
      typeof booking.resourceDurationOverrideHours === "number" && booking.resourceDurationOverrideHours > 0
        ? booking.resourceDurationOverrideHours
        : defaults.value;
    const end = new Date(startAt);
    end.setHours(end.getHours() + hours);
    return { start: startAt, end, unit: "hours", value: hours };
  }

  const startDay = startOfDay(startAt);
  const days =
    typeof booking.resourceDurationOverrideDays === "number" && booking.resourceDurationOverrideDays > 0
      ? booking.resourceDurationOverrideDays
      : defaults.value;
  const end = addDays(startDay, days);
  return { start: startDay, end, unit: "days", value: days };
}

function formatWindowLabel(window: AllocationWindow) {
  return window.unit === "hours" ? `${window.value}h` : `${window.value}d`;
}

function intersectsWeek(window: AllocationWindow, weekStart: Date) {
  const weekStartDay = startOfDay(weekStart);
  const weekEnd = addDays(weekStartDay, 7);
  return isBefore(window.start, weekEnd) && isBefore(weekStartDay, window.end);
}

function midpoint(window: AllocationWindow): Date {
  const midMs = window.start.getTime() + (window.end.getTime() - window.start.getTime()) / 2;
  return new Date(midMs);
}

function jobStatusClass(job: Job | null) {
  const status = job?.status;
  if (status === "in_progress") return "bg-amber-500/20 text-amber-200 border-amber-500/30";
  if (status === "completed" || status === "closed") return "bg-emerald-500/20 text-emerald-200 border-emerald-500/30";
  if (status === "cancelled") return "bg-muted text-muted-foreground border-border/40";
  return "bg-primary/15 text-primary-foreground border-primary/30";
}

export default function ResourcePlannerPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { bookings, jobs } = useJobs();

  const [viewMode, setViewMode] = useState<PlannerViewMode>("week");
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [editing, setEditing] = useState<AllocationEvent | null>(null);
  const [editTemplate, setEditTemplate] = useState<ResourceDurationTemplate>("na");
  const [editOverrideDays, setEditOverrideDays] = useState<string>("");
  const [editOverrideHours, setEditOverrideHours] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const canPlan = user?.role === "admin";

  useEffect(() => {
    if (!canPlan) return;
    const staffQuery = query(
      collection(db, COLLECTIONS.USERS),
      where("role", "in", ["technician", "contractor", "admin"])
    );

    return onSnapshot(
      staffQuery,
      (snapshot) => {
        const loaded = snapshot.docs
          .map((docSnap) => {
            const data = docSnap.data() as { name?: string; role?: string; email?: string };
            const staffType: StaffMember["type"] = data.role === "contractor" ? "subcontractor" : "asi_staff";
            return {
              id: docSnap.id,
              name: data.name || data.email || "Staff",
              type: staffType,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));
        setStaff(loaded);
      },
      (error) => {
        console.warn("Failed to load staff list:", error);
        setStaff([]);
      }
    );
  }, [canPlan]);

  const jobsById = useMemo(() => {
    const map = new Map<string, Job>();
    jobs.forEach((job) => map.set(job.id, job));
    return map;
  }, [jobs]);

  const rangeStart = useMemo(() => {
    if (viewMode === "day") return startOfDay(cursorDate);
    if (viewMode === "month") return startOfMonth(cursorDate);
    return startOfWeek(cursorDate, { weekStartsOn: 1 });
  }, [cursorDate, viewMode]);

  const visibleDays = useMemo(() => {
    const count = viewMode === "day" ? 1 : viewMode === "month" ? getDaysInMonth(rangeStart) : 7;
    return Array.from({ length: count }).map((_, idx) => addDays(rangeStart, idx));
  }, [rangeStart, viewMode]);

  const rangeEnd = useMemo(
    () => addDays(startOfDay(rangeStart), visibleDays.length),
    [rangeStart, visibleDays.length]
  );

  const rangeLabel = useMemo(() => {
    if (viewMode === "day") return format(rangeStart, "EEE d MMM yyyy");
    if (viewMode === "month") return format(rangeStart, "MMMM yyyy");
    return `Week of ${format(rangeStart, "EEE d MMM yyyy")}`;
  }, [rangeStart, viewMode]);

  const gridColumnsStyle = useMemo(() => {
    const count = Math.max(1, visibleDays.length);
    const template =
      viewMode === "month"
        ? `repeat(${count}, minmax(90px, 1fr))`
        : `repeat(${count}, minmax(0, 1fr))`;
    return { gridTemplateColumns: template } as const;
  }, [viewMode, visibleDays.length]);

  const events = useMemo((): AllocationEvent[] => {
    const result: AllocationEvent[] = [];
    const rangeStartDay = startOfDay(rangeStart);

    const addEvent = (booking: Booking, staffMember: StaffMember) => {
      const window = resolveAllocationWindow(booking);
      if (!window) return;
      if (!(isBefore(window.start, rangeEnd) && isBefore(rangeStartDay, window.end))) return;
      const job = booking.convertedJobId ? jobsById.get(booking.convertedJobId) ?? null : null;
      result.push({
        id: `${booking.id}:${staffMember.id}`,
        booking,
        staff: staffMember,
        job,
        window,
      });
    };

    bookings
      .filter((booking) => booking.status !== "cancelled")
      .forEach((booking) => {
        const allocated = booking.allocatedStaff || [];
        if (allocated.length === 0) {
          addEvent(booking, { id: "unassigned", name: "Unassigned", type: "asi_staff" });
          return;
        }
        allocated.forEach((member) => addEvent(booking, { id: member.id, name: member.name, type: member.type }));
      });

    return result;
  }, [bookings, jobsById, rangeEnd, rangeStart]);

  const staffRows = useMemo(() => {
    const staffMap = new Map<string, StaffMember>();
    staff.forEach((member) => staffMap.set(member.id, member));
    events.forEach((event) => {
      if (!staffMap.has(event.staff.id)) staffMap.set(event.staff.id, event.staff);
    });
    const list = Array.from(staffMap.values());
    const unassigned = list.find((member) => member.id === "unassigned");
    const rest = list.filter((member) => member.id !== "unassigned").sort((a, b) => a.name.localeCompare(b.name));
    return unassigned ? [...rest, unassigned] : rest;
  }, [events, staff]);

  const eventsByStaff = useMemo(() => {
    const map = new Map<string, AllocationEvent[]>();
    staffRows.forEach((member) => map.set(member.id, []));
    events.forEach((event) => {
      const list = map.get(event.staff.id);
      if (list) list.push(event);
    });
    map.forEach((list) => list.sort((a, b) => a.window.start.getTime() - b.window.start.getTime()));
    return map;
  }, [events, staffRows]);

  const eotCandidates = useMemo(() => {
    const now = new Date();
    return bookings
      .filter((booking) => booking.status !== "cancelled")
      .map((booking) => {
        const window = resolveAllocationWindow(booking);
        const job = booking.convertedJobId ? jobsById.get(booking.convertedJobId) ?? null : null;
        return { booking, window, job };
      })
      .filter(({ window, job, booking }) => {
        if (!window) return false;
        if (!job) return false;
        if (job.status === "completed" || job.status === "closed" || job.status === "cancelled") return false;
        const check = booking.eotCheck;
        if (check?.status && check.status !== "pending") return false;
        const mid = midpoint(window);
        return now >= mid && now <= endOfDay(window.end);
      });
  }, [bookings, jobsById]);

  useEffect(() => {
    if (!canPlan) return;
    if (eotCandidates.length === 0) return;
    const now = Timestamp.now();
    eotCandidates.forEach(({ booking }) => {
      if (booking.eotCheck?.promptedAt) return;
      updateDoc(doc(db, COLLECTIONS.BOOKINGS, booking.id), {
        eotCheck: {
          status: "pending",
          promptedAt: now,
        },
      }).catch((error) => console.warn("EOT prompt update failed:", error));
    });
  }, [canPlan, eotCandidates]);

  const openEdit = (event: AllocationEvent) => {
    setEditing(event);
    const template: ResourceDurationTemplate = event.booking.resourceDurationTemplate ?? "na";
    setEditTemplate(template);
    setEditOverrideDays(
      typeof event.booking.resourceDurationOverrideDays === "number"
        ? String(event.booking.resourceDurationOverrideDays)
        : ""
    );
    setEditOverrideHours(
      typeof event.booking.resourceDurationOverrideHours === "number"
        ? String(event.booking.resourceDurationOverrideHours)
        : ""
    );
  };

  const handleSaveAllocation = async () => {
    if (!editing) return;
    if (!canPlan) return;
    if (saving) return;
    setSaving(true);

    try {
      const bookingRef = doc(db, COLLECTIONS.BOOKINGS, editing.booking.id);

      const updates: Record<string, any> = {
        resourceDurationTemplate: editTemplate,
        updatedAt: Timestamp.now(),
      };

      const defaults = DEFAULT_DURATION[editTemplate];
      if (defaults.unit === "hours") {
        const parsed = editOverrideHours.trim() ? Number(editOverrideHours) : NaN;
        if (editOverrideHours.trim() && (!Number.isFinite(parsed) || parsed <= 0)) {
          throw new Error("Override hours must be a positive number.");
        }
        if (editOverrideHours.trim()) {
          updates.resourceDurationOverrideHours = parsed;
        } else {
          updates.resourceDurationOverrideHours = deleteField();
        }
        updates.resourceDurationOverrideDays = deleteField();
      } else {
        const parsed = editOverrideDays.trim() ? Number(editOverrideDays) : NaN;
        if (editOverrideDays.trim() && (!Number.isFinite(parsed) || parsed <= 0)) {
          throw new Error("Override days must be a positive number.");
        }
        if (editOverrideDays.trim()) {
          updates.resourceDurationOverrideDays = parsed;
        } else {
          updates.resourceDurationOverrideDays = deleteField();
        }
        updates.resourceDurationOverrideHours = deleteField();
      }

      await updateDoc(bookingRef, updates);
      toast({ title: "Allocation updated", description: "Resource Planner window has been updated." });
      setEditing(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update allocation.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const setEotDecision = async (booking: Booking, status: "not_required" | "requested") => {
    if (!canPlan) return;
    try {
      await updateDoc(doc(db, COLLECTIONS.BOOKINGS, booking.id), {
        eotCheck: {
          status,
          decidedAt: Timestamp.now(),
          decidedBy: user?.uid || "system",
          note: booking.eotCheck?.note || "",
          promptedAt: booking.eotCheck?.promptedAt || Timestamp.now(),
        },
        updatedAt: Timestamp.now(),
      });
      toast({
        title: status === "requested" ? "EOT flagged" : "EOT cleared",
        description:
          status === "requested"
            ? "Marked as needing an Extension of Time request."
            : "Marked as not requiring an Extension of Time.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update EOT status.";
      toast({ title: "EOT update failed", description: message, variant: "destructive" });
    }
  };

  if (!canPlan) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="text-xl">Resource Planner</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Resource planning is available for admin users only.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-6">
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <CardTitle className="text-2xl font-headline flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" />
              Resource Planner
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Capacity view based on booking allocations and duration windows.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select value={viewMode} onValueChange={(value) => setViewMode(value as PlannerViewMode)}>
              <SelectTrigger className="w-[150px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day view</SelectItem>
                <SelectItem value="week">Week view</SelectItem>
                <SelectItem value="month">Month view</SelectItem>
              </SelectContent>
            </Select>

            <Button variant="outline" onClick={() => setCursorDate(new Date())}>
              Today
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setCursorDate((prev) =>
                  viewMode === "day"
                    ? addDays(prev, -1)
                    : viewMode === "month"
                      ? addMonths(prev, -1)
                      : addDays(prev, -7)
                )
              }
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={() =>
                setCursorDate((prev) =>
                  viewMode === "day"
                    ? addDays(prev, 1)
                    : viewMode === "month"
                      ? addMonths(prev, 1)
                      : addDays(prev, 7)
                )
              }
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <span className="text-foreground font-medium">{rangeLabel}</span>
          </div>

          {eotCandidates.length > 0 ? (
            <Card className="border-amber-500/30 bg-amber-500/10">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <TriangleAlert className="h-4 w-4 text-amber-300" />
                  Extension of Time (EOT) checks
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {eotCandidates.map(({ booking, window, job }) => {
                  if (!window || !job) return null;
                  return (
                    <div
                      key={booking.id}
                      className="flex flex-col gap-2 rounded-lg border border-amber-500/20 bg-background/30 p-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{booking.bookingNumber}</span>
                          <Badge variant="outline" className="text-xs">
                            {BOOKING_TYPE_LABELS[booking.bookingType]}
                          </Badge>
                          <Badge variant="outline" className={cn("text-xs", jobStatusClass(job))}>
                            {job.status.replace("_", " ")}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {booking.organizationName} • Midpoint{" "}
                          {format(midpoint(window), "EEE d MMM, HH:mm")}
                        </p>
                        {booking.convertedJobId ? (
                          <Link
                            href={`/dashboard/jobs/${booking.convertedJobId}`}
                            className="text-xs text-primary underline underline-offset-4"
                          >
                            View job
                          </Link>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2 md:flex-row md:items-center">
                        <Button
                          variant="outline"
                          onClick={() => setEotDecision(booking, "not_required")}
                        >
                          No EOT needed
                        </Button>
                        <Button onClick={() => setEotDecision(booking, "requested")}>Request EOT</Button>
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}

          <div className="rounded-xl border border-border/40 overflow-x-auto overflow-y-hidden">
            <div className="grid grid-cols-[220px,1fr] bg-muted/30">
              <div className="p-3 text-xs font-medium text-muted-foreground">Staff</div>
              <div className="grid" style={gridColumnsStyle}>
                {visibleDays.map((day) => (
                  <div key={day.toISOString()} className="p-3 text-xs font-medium text-muted-foreground">
                    {viewMode === "month" ? (
                      <>
                        <div className="text-sm font-semibold text-foreground">{format(day, "d")}</div>
                        <div className="text-[11px] opacity-80">{format(day, "EEE")}</div>
                      </>
                    ) : (
                      <>
                        <div>{format(day, "EEE")}</div>
                        <div className="text-[11px] opacity-80">{format(day, "d MMM")}</div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="divide-y divide-border/40">
              {staffRows.map((member) => {
                const staffEvents = eventsByStaff.get(member.id) ?? [];
                const lanes = staffEvents.reduce<AllocationEvent[][]>((acc, event) => {
                  const placedLane = acc.find((lane) => {
                    const last = lane[lane.length - 1];
                    return last ? last.window.end.getTime() <= event.window.start.getTime() : true;
                  });
                  if (placedLane) {
                    placedLane.push(event);
                  } else {
                    acc.push([event]);
                  }
                  return acc;
                }, []);

                const laneCount = Math.max(1, lanes.length);
                const rowHeight = 44;

                return (
                  <div key={member.id} className="grid grid-cols-[220px,1fr]">
                    <div className="p-3">
                      <div className="text-sm font-medium">{member.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {member.type === "subcontractor" ? "Subcontractor" : "ASI staff"}
                      </div>
                    </div>
                    <div className="relative">
                      <div
                        className="grid auto-rows-[44px] gap-px bg-border/40"
                        style={{ ...gridColumnsStyle, height: `${laneCount * rowHeight}px` }}
                      >
                        {Array.from({ length: laneCount * visibleDays.length }).map((_, idx) => (
                          <div key={idx} className="bg-background/40" />
                        ))}
                      </div>

                      <div className="absolute inset-0 grid auto-rows-[44px] gap-px p-1" style={gridColumnsStyle}>
                        {lanes.flatMap((lane, laneIndex) =>
                          lane.map((event) => {
                            const dayIndexStart = Math.max(
                              0,
                              Math.floor(
                                (startOfDay(event.window.start).getTime() -
                                  startOfDay(rangeStart).getTime()) /
                                  (1000 * 60 * 60 * 24)
                              )
                            );
                            const dayIndexEnd = Math.min(
                              visibleDays.length,
                              Math.ceil(
                                (startOfDay(event.window.end).getTime() -
                                  startOfDay(rangeStart).getTime()) /
                                  (1000 * 60 * 60 * 24)
                              )
                            );

                            const columnStart = dayIndexStart + 1;
                            const columnEnd = Math.max(columnStart + 1, dayIndexEnd + 1);

                            const durationLabel = formatWindowLabel(event.window);
                            const serviceLabel = BOOKING_TYPE_LABELS[event.booking.bookingType];

                            return (
                              <button
                                key={event.id}
                                type="button"
                                onClick={() => openEdit(event)}
                                className={cn(
                                  "group flex items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition hover:border-primary/60 hover:bg-primary/10",
                                  jobStatusClass(event.job)
                                )}
                                style={{
                                  gridRowStart: laneIndex + 1,
                                  gridColumnStart: columnStart,
                                  gridColumnEnd: columnEnd,
                                }}
                              >
                                <GripVertical className="h-3 w-3 opacity-50 group-hover:opacity-80" />
                                <div className="min-w-0 flex-1">
                                  <div className="truncate font-medium">
                                    {event.booking.bookingNumber} • {event.booking.organizationName}
                                  </div>
                                  <div className="truncate text-[11px] opacity-80">{serviceLabel}</div>
                                </div>
                                <div className="flex items-center gap-1 text-[11px] opacity-80">
                                  <Clock className="h-3 w-3" />
                                  {durationLabel}
                                </div>
                              </button>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Duration windows come from the booking wizard (N/A / Short / Medium / Long) and can be fine-tuned per booking here.
          </p>
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(open) => (!open ? setEditing(null) : null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Adjust allocation window</DialogTitle>
            <DialogDescription>
              Update how long this job reserves staff capacity in the Resource Planner.
            </DialogDescription>
          </DialogHeader>

          {editing ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-3 text-sm">
                <div className="font-medium">
                  {editing.booking.bookingNumber} • {editing.booking.organizationName}
                </div>
                <div className="text-xs text-muted-foreground">
                  {BOOKING_TYPE_LABELS[editing.booking.bookingType]}
                  {editing.booking.convertedJobId ? (
                    <>
                      {" "}
                      •{" "}
                      <Link
                        href={`/dashboard/jobs/${editing.booking.convertedJobId}`}
                        className="text-primary underline underline-offset-4"
                      >
                        View job
                      </Link>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Duration template</Label>
                <Select value={editTemplate} onValueChange={(value) => setEditTemplate(value as ResourceDurationTemplate)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(RESOURCE_DURATION_LABELS) as [ResourceDurationTemplate, string][]).map(
                      ([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      )
                    )}
                  </SelectContent>
                </Select>
              </div>

              {DEFAULT_DURATION[editTemplate].unit === "hours" ? (
                <div className="space-y-2">
                  <Label>Override hours (optional)</Label>
                  <Input
                    value={editOverrideHours}
                    onChange={(e) => setEditOverrideHours(e.target.value)}
                    placeholder="e.g. 2"
                    inputMode="numeric"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the template default ({DEFAULT_DURATION[editTemplate].value} hour).
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Override days (optional)</Label>
                  <Input
                    value={editOverrideDays}
                    onChange={(e) => setEditOverrideDays(e.target.value)}
                    placeholder="e.g. 2"
                    inputMode="numeric"
                  />
                  <p className="text-xs text-muted-foreground">
                    Leave blank to use the template default ({DEFAULT_DURATION[editTemplate].value} days).
                  </p>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSaveAllocation} disabled={!editing || saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
