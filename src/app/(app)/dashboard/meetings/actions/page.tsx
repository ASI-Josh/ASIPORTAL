"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  updateDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/collections";
import type { MeetingAction } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import Link from "next/link";
import {
  Loader2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  ListChecks,
  Save,
  Clock,
  Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATUS_OPTIONS = ["open", "in_progress", "completed", "overdue", "cancelled"] as const;
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"] as const;

const STATUS_COLORS: Record<string, string> = {
  open: "bg-[#0080FF]/15 text-[#0080FF] border-[#0080FF]/30",
  in_progress: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  completed: "bg-[#00C853]/15 text-[#00C853] border-[#00C853]/30",
  overdue: "bg-red-500/15 text-red-400 border-red-500/30",
  cancelled: "bg-gray-600/30 text-gray-300 border-gray-500/40",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  overdue: "Overdue",
  cancelled: "Cancelled",
};

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-600/30 text-gray-300 border-gray-500/40",
  medium: "bg-[#0080FF]/15 text-[#0080FF] border-[#0080FF]/30",
  high: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
};

const PRIORITY_LABELS: Record<string, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  critical: "Critical",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(ts: Timestamp | undefined): string {
  if (!ts) return "\u2014";
  return ts.toDate().toLocaleDateString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(action: MeetingAction): boolean {
  if (action.status === "completed" || action.status === "cancelled") return false;
  if (!action.dueDate) return false;
  return action.dueDate.toMillis() < Date.now();
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function ActionsRegisterPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [actions, setActions] = useState<MeetingAction[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Inline edit state
  const [editStatus, setEditStatus] = useState<string>("");
  const [closureNotes, setClosureNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------------------------
  // Real-time subscription
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MEETING_ACTIONS),
      orderBy("dueDate", "asc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setActions(
        snap.docs.map((d) => ({
          id: d.id,
          ...(d.data() as Omit<MeetingAction, "id">),
        }))
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  // ---------------------------------------------------------------------------
  // Filtered list
  // ---------------------------------------------------------------------------

  const filtered = useMemo(() => {
    let list = [...actions];

    if (statusFilter !== "all") {
      list = list.filter((a) => a.status === statusFilter);
    }
    if (priorityFilter !== "all") {
      list = list.filter((a) => a.priority === priorityFilter);
    }
    if (overdueOnly) {
      list = list.filter(isOverdue);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (a) =>
          a.title.toLowerCase().includes(q) ||
          a.assignedTo?.name?.toLowerCase().includes(q) ||
          a.meetingNumber?.toLowerCase().includes(q)
      );
    }
    return list;
  }, [actions, statusFilter, priorityFilter, overdueOnly, searchQuery]);

  // ---------------------------------------------------------------------------
  // KPIs
  // ---------------------------------------------------------------------------

  const kpis = useMemo(() => {
    const total = actions.length;
    const open = actions.filter(
      (a) => a.status === "open" || a.status === "in_progress"
    ).length;
    const overdue = actions.filter(isOverdue).length;
    const completed = actions.filter((a) => a.status === "completed").length;
    return { total, open, overdue, completed };
  }, [actions]);

  // ---------------------------------------------------------------------------
  // Expand / collapse
  // ---------------------------------------------------------------------------

  function toggleExpand(action: MeetingAction) {
    if (expandedId === action.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(action.id);
    setEditStatus(action.status);
    setClosureNotes(action.closureNotes || "");
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  async function handleSave(action: MeetingAction) {
    const isAdmin = user?.role === "admin";
    const isOwner = user?.uid === action.assignedTo?.id;
    if (!isAdmin && !isOwner) {
      toast({
        title: "Permission denied",
        description: "You can only update actions assigned to you.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const updates: Record<string, Timestamp | string> = {
        status: editStatus,
        updatedAt: Timestamp.now(),
      };
      if (editStatus === "completed") {
        updates.completedAt = Timestamp.now();
        updates.completedBy = user?.uid || "";
        updates.closureNotes = closureNotes;
      }
      await updateDoc(doc(db, COLLECTIONS.MEETING_ACTIONS, action.id), updates);
      toast({ title: "Action updated", description: `"${action.title}" status saved.` });
      setExpandedId(null);
    } catch (err) {
      console.error(err);
      toast({
        title: "Error",
        description: "Failed to update action.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[#8000FF]" />
        <span className="ml-3 text-gray-400">Loading actions...</span>
      </div>
    );
  }

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white font-['Space_Grotesk']">
          Actions Register
        </h1>
        <p className="text-sm text-gray-400 mt-1">
          All meeting action items across the organisation
        </p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Total Actions
            </CardTitle>
            <ListChecks className="h-5 w-5 text-[#8000FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{kpis.total}</div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Open / In Progress
            </CardTitle>
            <Clock className="h-5 w-5 text-[#0080FF]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-white">{kpis.open}</div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Overdue
            </CardTitle>
            <AlertTriangle className="h-5 w-5 text-red-400" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-red-400">{kpis.overdue}</div>
          </CardContent>
        </Card>

        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-400">
              Completed
            </CardTitle>
            <ListChecks className="h-5 w-5 text-[#00C853]" />
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-[#00C853]">{kpis.completed}</div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="bg-card/60 border-border/40 backdrop-blur">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-500" />
              <Input
                placeholder="Search title, assignee, meeting..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-[#262633] border-white/10 text-white placeholder:text-gray-500"
              />
            </div>

            {/* Status filter */}
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[160px] bg-[#262633] border-white/10 text-white">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Priority filter */}
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger className="w-[160px] bg-[#262633] border-white/10 text-white">
                <SelectValue placeholder="Priority" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Priorities</SelectItem>
                {PRIORITY_OPTIONS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Overdue toggle */}
            <Button
              variant={overdueOnly ? "default" : "outline"}
              size="sm"
              onClick={() => setOverdueOnly((v) => !v)}
              className={
                overdueOnly
                  ? "bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30"
                  : "border-white/10 text-gray-400 hover:text-white hover:bg-white/5"
              }
            >
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              Overdue Only
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Actions List */}
      {filtered.length === 0 ? (
        <Card className="bg-card/60 border-border/40 backdrop-blur">
          <CardContent className="py-12 text-center text-gray-500">
            No actions match the current filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((action) => {
            const expanded = expandedId === action.id;
            const overdue = isOverdue(action);
            const canEdit = isAdmin || user?.uid === action.assignedTo?.id;

            return (
              <Card
                key={action.id}
                className="bg-card/60 border-border/40 backdrop-blur transition-colors hover:border-[#8000FF]/30"
              >
                {/* Row */}
                <button
                  type="button"
                  onClick={() => toggleExpand(action)}
                  className="w-full text-left px-4 py-3 flex items-center gap-3"
                >
                  {expanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-500 shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-500 shrink-0" />
                  )}

                  {/* Title */}
                  <span className="flex-1 font-medium text-white truncate">
                    {action.title}
                  </span>

                  {/* Meeting number */}
                  <Link
                    href={`/dashboard/meetings/${action.meetingId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="text-xs text-[#0080FF] hover:underline shrink-0"
                  >
                    {action.meetingNumber || "Meeting"}
                  </Link>

                  {/* Assignee */}
                  <span className="hidden sm:inline text-sm text-gray-400 w-[140px] truncate text-right">
                    {action.assignedTo?.name || "\u2014"}
                  </span>

                  {/* Due date */}
                  <span
                    className={`text-sm w-[100px] text-right shrink-0 ${
                      overdue ? "text-red-400 font-semibold" : "text-gray-400"
                    }`}
                  >
                    {formatDate(action.dueDate)}
                  </span>

                  {/* Priority */}
                  <Badge
                    variant="outline"
                    className={`${PRIORITY_COLORS[action.priority]} text-xs shrink-0`}
                  >
                    {PRIORITY_LABELS[action.priority]}
                  </Badge>

                  {/* Status */}
                  <Badge
                    variant="outline"
                    className={`${
                      overdue && action.status !== "completed" && action.status !== "cancelled"
                        ? STATUS_COLORS.overdue
                        : STATUS_COLORS[action.status]
                    } text-xs shrink-0`}
                  >
                    {overdue && action.status !== "completed" && action.status !== "cancelled"
                      ? "Overdue"
                      : STATUS_LABELS[action.status]}
                  </Badge>
                </button>

                {/* Expanded detail */}
                {expanded && (
                  <div className="px-4 pb-4 pt-1 border-t border-white/5 space-y-4">
                    {/* Description */}
                    {action.description && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Description</p>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">
                          {action.description}
                        </p>
                      </div>
                    )}

                    {/* Assignee (mobile) */}
                    <div className="sm:hidden">
                      <p className="text-xs text-gray-500 mb-1">Assigned To</p>
                      <p className="text-sm text-gray-300">
                        {action.assignedTo?.name || "\u2014"}
                      </p>
                    </div>

                    {/* Edit controls */}
                    {canEdit && (
                      <div className="space-y-3 pt-2 border-t border-white/5">
                        <div className="flex flex-wrap items-end gap-3">
                          <div className="w-[200px]">
                            <label className="text-xs text-gray-500 block mb-1">
                              Update Status
                            </label>
                            <Select value={editStatus} onValueChange={setEditStatus}>
                              <SelectTrigger className="bg-[#262633] border-white/10 text-white">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {STATUS_OPTIONS.map((s) => (
                                  <SelectItem key={s} value={s}>
                                    {STATUS_LABELS[s]}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <Button
                            size="sm"
                            disabled={saving}
                            onClick={() => handleSave(action)}
                            className="bg-[#8000FF] hover:bg-[#8000FF]/80 text-white"
                          >
                            {saving ? (
                              <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                            ) : (
                              <Save className="h-4 w-4 mr-1.5" />
                            )}
                            Save
                          </Button>
                        </div>

                        {editStatus === "completed" && (
                          <div>
                            <label className="text-xs text-gray-500 block mb-1">
                              Closure Notes
                            </label>
                            <Textarea
                              value={closureNotes}
                              onChange={(e) => setClosureNotes(e.target.value)}
                              placeholder="Describe how this action was resolved..."
                              className="bg-[#262633] border-white/10 text-white placeholder:text-gray-500 min-h-[80px]"
                            />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Existing closure notes if completed */}
                    {action.status === "completed" && action.closureNotes && !canEdit && (
                      <div>
                        <p className="text-xs text-gray-500 mb-1">Closure Notes</p>
                        <p className="text-sm text-gray-300 whitespace-pre-wrap">
                          {action.closureNotes}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
