"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import {
  Target, TrendingUp, AlertTriangle, Clock, Search,
  Filter, ChevronDown, ChevronUp, ExternalLink, ArrowRight,
  CheckCircle2, PauseCircle, XCircle, Eye, Zap, Calendar, Package,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { StreamType } from "@/lib/types";

// ─── Types (client-side) ────────────────────────────────────────────────────

interface RegisterEntry {
  id: string;
  streamType: StreamType;
  status: string;
  source: { type: string; scanDate?: string; notes?: string };
  company: { name: string; website?: string; sector: string; description?: string; location?: string; size?: string };
  contact: { name?: string; role?: string; email?: string; phone?: string; linkedin?: string };
  opportunity: { description?: string; category: string; potentialValue?: number; potentialValueNotes?: string; urgencyFlag?: boolean; urgencyReason?: string };
  roeScore?: { strategicFit: number; effortEstimate: number; revenueImpact: number; conversionProbability: number; resourceRisk: number; total: number; grade: string; assessedBy: string; assessedAt: string };
  stockdaleAssessment?: { resourceAvailability: string; gunpowderCheck?: string; growthRisk?: string; flywheelImpact?: string; verdict: string; assessedAt: string };
  weeklyDecision?: { weekEnding: string; decision: string; reasoning: string; decidedBy: string };
  promotedToPipeline: boolean;
  promotedDate?: string;
  pipelineLeadId?: string;
  notes?: string;
  tags: string[];
  createdAt: { toDate?: () => Date } | string;
  updatedAt: { toDate?: () => Date } | string;
  createdBy: string;
}

// ─── Config ─────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle2 }> = {
  identified:  { label: "Identified",  color: "text-zinc-400",   bg: "bg-zinc-500/15",   icon: Eye },
  assessed:    { label: "Assessed",    color: "text-blue-400",   bg: "bg-blue-500/15",   icon: Target },
  shortlisted: { label: "Shortlisted", color: "text-violet-400", bg: "bg-violet-500/15", icon: Zap },
  promoted:    { label: "Promoted",    color: "text-green-400",  bg: "bg-green-500/15",  icon: CheckCircle2 },
  parked:      { label: "Parked",      color: "text-amber-400",  bg: "bg-amber-500/15",  icon: PauseCircle },
  rejected:    { label: "Rejected",    color: "text-red-400",    bg: "bg-red-500/15",    icon: XCircle },
};

const ROE_GRADE_CONFIG: Record<string, { color: string; bg: string }> = {
  A: { color: "text-green-400",  bg: "bg-green-500/20" },
  B: { color: "text-blue-400",   bg: "bg-blue-500/20" },
  C: { color: "text-amber-400",  bg: "bg-amber-500/20" },
  D: { color: "text-orange-400", bg: "bg-orange-500/20" },
  E: { color: "text-red-400",    bg: "bg-red-500/20" },
};

const VERDICT_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pursue: { label: "Pursue", color: "text-green-400",  bg: "bg-green-500/15" },
  park:   { label: "Park",   color: "text-amber-400",  bg: "bg-amber-500/15" },
  watch:  { label: "Watch",  color: "text-blue-400",   bg: "bg-blue-500/15" },
  reject: { label: "Reject", color: "text-red-400",    bg: "bg-red-500/15" },
};

const SECTOR_LABELS: Record<string, string> = {
  "mass-transit": "Mass Transit", manufacturing: "Manufacturing", "wholesale-trade": "Wholesale Trade",
  structural: "Structural", marine: "Marine", technology: "Technology", other: "Other",
};

const CATEGORY_LABELS: Record<string, string> = {
  technology: "Technology", supplier: "Supplier", partner: "Partner", distributor: "Distributor",
  customer: "Customer", innovation: "Innovation", grant: "Grant", other: "Other",
};

function formatCurrency(n?: number) {
  if (!n) return "-";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

function toDateStr(v: { toDate?: () => Date } | string | undefined): string {
  if (!v) return "-";
  if (typeof v === "string") return v.split("T")[0];
  if (v.toDate) return v.toDate().toISOString().split("T")[0];
  return "-";
}

// ─── ROE Score Bar ──────────────────────────────────────────────────────────

function RoeBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">{value}/{max}</span>
      </div>
      <div className="h-2 rounded-full bg-border/40 overflow-hidden">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── Detail Dialog ──────────────────────────────────────────────────────────

function EntryDetailDialog({ entry, open, onClose }: { entry: RegisterEntry | null; open: boolean; onClose: () => void }) {
  if (!entry) return null;
  const sc = STATUS_CONFIG[entry.status] || STATUS_CONFIG.identified;
  const rg = entry.roeScore ? ROE_GRADE_CONFIG[entry.roeScore.grade] : null;
  const vc = entry.stockdaleAssessment ? VERDICT_CONFIG[entry.stockdaleAssessment.verdict] : null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>{entry.company.name}</span>
            <Badge className={`${sc.bg} ${sc.color} border-0`}>{sc.label}</Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          {/* Company */}
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-2">Company</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">Sector:</span> {SECTOR_LABELS[entry.company.sector] || entry.company.sector}</div>
              {entry.company.website && <div><span className="text-muted-foreground">Website:</span> {entry.company.website}</div>}
              {entry.company.location && <div><span className="text-muted-foreground">Location:</span> {entry.company.location}</div>}
              {entry.company.size && <div><span className="text-muted-foreground">Size:</span> {entry.company.size}</div>}
              {entry.company.description && <div className="col-span-2"><span className="text-muted-foreground">Description:</span> {entry.company.description}</div>}
            </div>
          </div>

          {/* Contact */}
          {entry.contact.name && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Primary Contact</h4>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>{entry.contact.name} {entry.contact.role && `(${entry.contact.role})`}</div>
                {entry.contact.email && <div>{entry.contact.email}</div>}
                {entry.contact.phone && <div>{entry.contact.phone}</div>}
              </div>
            </div>
          )}

          {/* Opportunity */}
          <div>
            <h4 className="text-sm font-semibold text-muted-foreground mb-2">Opportunity</h4>
            <div className="space-y-1 text-sm">
              {entry.opportunity.description && <p>{entry.opportunity.description}</p>}
              <div className="flex gap-4">
                <Badge variant="outline" className="text-xs">{CATEGORY_LABELS[entry.opportunity.category] || entry.opportunity.category}</Badge>
                {entry.opportunity.potentialValue && <span>{formatCurrency(entry.opportunity.potentialValue)}/yr</span>}
                {entry.opportunity.urgencyFlag && (
                  <Badge className="bg-red-500/20 text-red-400 border-0 text-xs">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Urgent
                  </Badge>
                )}
              </div>
              {entry.opportunity.urgencyReason && <p className="text-muted-foreground text-xs">{entry.opportunity.urgencyReason}</p>}
            </div>
          </div>

          {/* ROE Score */}
          {entry.roeScore && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                ROE Score
                <span className={`text-lg font-bold ${rg?.color}`}>{entry.roeScore.total}/100 ({entry.roeScore.grade})</span>
              </h4>
              <div className="space-y-2">
                <RoeBar label="Strategic Fit" value={entry.roeScore.strategicFit} max={25} />
                <RoeBar label="Effort Estimate" value={entry.roeScore.effortEstimate} max={20} />
                <RoeBar label="Revenue Impact" value={entry.roeScore.revenueImpact} max={25} />
                <RoeBar label="Conversion Probability" value={entry.roeScore.conversionProbability} max={15} />
                <RoeBar label="Resource Risk" value={entry.roeScore.resourceRisk} max={15} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">Assessed by {entry.roeScore.assessedBy} on {entry.roeScore.assessedAt?.split("T")[0]}</p>
            </div>
          )}

          {/* Stockdale Assessment */}
          {entry.stockdaleAssessment && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
                Stockdale Assessment
                {vc && <Badge className={`${vc.bg} ${vc.color} border-0`}>{vc.label}</Badge>}
              </h4>
              <div className="space-y-1 text-sm">
                <div><span className="text-muted-foreground">Resources:</span> {entry.stockdaleAssessment.resourceAvailability}</div>
                {entry.stockdaleAssessment.gunpowderCheck && <div><span className="text-muted-foreground">Gunpowder:</span> {entry.stockdaleAssessment.gunpowderCheck}</div>}
                {entry.stockdaleAssessment.growthRisk && <div><span className="text-muted-foreground">Growth Risk:</span> {entry.stockdaleAssessment.growthRisk}</div>}
                {entry.stockdaleAssessment.flywheelImpact && <div><span className="text-muted-foreground">Flywheel:</span> {entry.stockdaleAssessment.flywheelImpact}</div>}
              </div>
            </div>
          )}

          {/* Weekly Decision */}
          {entry.weeklyDecision && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-2">Weekly Decision</h4>
              <div className="text-sm space-y-1">
                <div><span className="text-muted-foreground">Week ending:</span> {entry.weeklyDecision.weekEnding}</div>
                <div><span className="text-muted-foreground">Decision:</span> <Badge variant="outline" className="text-xs">{entry.weeklyDecision.decision}</Badge></div>
                {entry.weeklyDecision.reasoning && <p className="text-muted-foreground">{entry.weeklyDecision.reasoning}</p>}
              </div>
            </div>
          )}

          {/* Promotion Link */}
          {entry.promotedToPipeline && entry.pipelineLeadId && (
            <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
              <CheckCircle2 className="h-4 w-4 text-green-400" />
              <span className="text-sm text-green-400">Promoted to CRM Pipeline</span>
              <Link href={`/dashboard/crm/${entry.pipelineLeadId}`} className="ml-auto text-xs text-primary hover:underline flex items-center gap-1">
                View in CRM <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
          )}

          {/* Notes & Tags */}
          {entry.notes && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground mb-1">Notes</h4>
              <p className="text-sm whitespace-pre-wrap">{entry.notes}</p>
            </div>
          )}
          {entry.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {entry.tags.map((t) => <Badge key={t} variant="outline" className="text-xs">{t}</Badge>)}
            </div>
          )}

          <div className="text-xs text-muted-foreground">
            Source: {entry.source.type}{entry.source.scanDate ? ` (${entry.source.scanDate})` : ""} | Created: {toDateStr(entry.createdAt)} | By: {entry.createdBy}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Weekly Review Panel ────────────────────────────────────────────────────

function WeeklyReviewPanel({ entries, stream }: { entries: RegisterEntry[]; stream: StreamType }) {
  const shortlisted = useMemo(() => {
    return entries
      .filter((e) => e.status === "assessed" || e.status === "shortlisted")
      .sort((a, b) => (b.roeScore?.total || 0) - (a.roeScore?.total || 0))
      .slice(0, 5);
  }, [entries]);

  const activePursuits = useMemo(() => {
    return entries.filter((e) => e.status === "promoted" && e.promotedToPipeline);
  }, [entries]);

  return (
    <div className="space-y-6">
      <Card className="bg-card/50 border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            Weekly Shortlist ({
              stream === "supply_chain" ? "VANGUARD" :
              stream === "trade_distribution" ? "SHIELD" :
              "SENTINEL"
            })
          </CardTitle>
        </CardHeader>
        <CardContent>
          {shortlisted.length === 0 ? (
            <p className="text-sm text-muted-foreground">No entries ready for review. Entries need ROE assessment first.</p>
          ) : (
            <div className="space-y-3">
              {shortlisted.map((e) => {
                const rg = e.roeScore ? ROE_GRADE_CONFIG[e.roeScore.grade] : null;
                return (
                  <div key={e.id} className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/40">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{e.company.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{e.opportunity.description || e.opportunity.category}</div>
                    </div>
                    {e.roeScore && (
                      <span className={`text-sm font-bold px-2 py-0.5 rounded ${rg?.bg} ${rg?.color}`}>
                        {e.roeScore.total} ({e.roeScore.grade})
                      </span>
                    )}
                    {e.opportunity.urgencyFlag && <AlertTriangle className="h-4 w-4 text-red-400 flex-shrink-0" />}
                    <Badge variant="outline" className="text-xs">{formatCurrency(e.opportunity.potentialValue)}</Badge>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 border-border/40">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRight className="h-4 w-4 text-green-400" />
            Active Pursuits ({activePursuits.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activePursuits.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active pursuits. Promote entries from the shortlist to begin pursuit.</p>
          ) : (
            <div className="space-y-2">
              {activePursuits.map((e) => (
                <div key={e.id} className="flex items-center gap-3 p-2 rounded-lg border border-green-500/20 bg-green-500/5">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{e.company.name}</div>
                    <div className="text-xs text-muted-foreground">Promoted: {e.promotedDate?.split("T")[0] || "-"}</div>
                  </div>
                  {e.pipelineLeadId && (
                    <Link href={`/dashboard/crm/${e.pipelineLeadId}`} className="text-xs text-primary hover:underline flex items-center gap-1">
                      CRM <ExternalLink className="h-3 w-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function LeadsRegisterPage() {
  const [entries, setEntries] = useState<RegisterEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeStream, setActiveStream] = useState<StreamType>("supply_chain");
  const [view, setView] = useState<"register" | "weekly-review">("register");

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [gradeFilter, setGradeFilter] = useState<string>("all");
  const [sectorFilter, setSectorFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"roe" | "created" | "urgency">("roe");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [selectedEntry, setSelectedEntry] = useState<RegisterEntry | null>(null);

  // Real-time Firestore listener. Filter out soft-deleted entries
  // (agents can soft_delete_leads_register_entry for hygiene; the record
  // stays for audit but shouldn't appear in operational views).
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.LEADS_REGISTER),
      orderBy("createdAt", "desc"),
    );
    const unsub = onSnapshot(q, (snap) => {
      const data = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => (d as { isDeleted?: boolean }).isDeleted !== true) as RegisterEntry[];
      setEntries(data);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Stream-filtered entries
  const streamEntries = useMemo(() => entries.filter((e) => e.streamType === activeStream), [entries, activeStream]);

  // Summary stats
  const stats = useMemo(() => {
    const total = streamEntries.length;
    const byStatus: Record<string, number> = {};
    let activePursuits = 0;
    let awaitingAssessment = 0;
    let totalRoe = 0;
    let roeCount = 0;

    streamEntries.forEach((e) => {
      byStatus[e.status] = (byStatus[e.status] || 0) + 1;
      if (e.status === "promoted" && e.promotedToPipeline) activePursuits++;
      if (e.status === "identified" && !e.roeScore) awaitingAssessment++;
      if (e.roeScore && (e.status === "shortlisted" || e.status === "assessed")) {
        totalRoe += e.roeScore.total;
        roeCount++;
      }
    });

    return { total, byStatus, activePursuits, awaitingAssessment, avgRoe: roeCount > 0 ? Math.round(totalRoe / roeCount) : 0 };
  }, [streamEntries]);

  // Filtered + sorted entries
  const filteredEntries = useMemo(() => {
    let result = streamEntries;
    if (statusFilter !== "all") result = result.filter((e) => e.status === statusFilter);
    if (gradeFilter !== "all") result = result.filter((e) => e.roeScore?.grade === gradeFilter);
    if (sectorFilter !== "all") result = result.filter((e) => e.company.sector === sectorFilter);
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      result = result.filter((e) =>
        e.company.name.toLowerCase().includes(q) ||
        (e.contact.name || "").toLowerCase().includes(q) ||
        (e.opportunity.description || "").toLowerCase().includes(q) ||
        e.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    result.sort((a, b) => {
      const dir = sortDir === "desc" ? -1 : 1;
      if (sortField === "roe") return dir * ((a.roeScore?.total || 0) - (b.roeScore?.total || 0));
      if (sortField === "urgency") return dir * ((a.opportunity.urgencyFlag ? 1 : 0) - (b.opportunity.urgencyFlag ? 1 : 0));
      // created
      const aDate = toDateStr(a.createdAt);
      const bDate = toDateStr(b.createdAt);
      return dir * aDate.localeCompare(bDate);
    });
    return result;
  }, [streamEntries, statusFilter, gradeFilter, sectorFilter, searchTerm, sortField, sortDir]);

  const toggleSort = useCallback((field: typeof sortField) => {
    if (sortField === field) setSortDir((d) => d === "desc" ? "asc" : "desc");
    else { setSortField(field); setSortDir("desc"); }
  }, [sortField]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight font-space-grotesk">Leads Register</h1>
          <p className="text-sm text-muted-foreground">Pre-pipeline qualification layer. Assess, score, and promote top leads.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={view === "register" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("register")}
          >
            Register
          </Button>
          <Button
            variant={view === "weekly-review" ? "default" : "outline"}
            size="sm"
            onClick={() => setView("weekly-review")}
          >
            <Calendar className="h-4 w-4 mr-1" /> Weekly Review
          </Button>
        </div>
      </div>

      {/* Stream Tabs */}
      <Tabs value={activeStream} onValueChange={(v) => setActiveStream(v as StreamType)}>
        <TabsList className="bg-card/50 border border-border/40">
          <TabsTrigger value="supply_chain" className="gap-2">
            <Target className="h-4 w-4" /> Supply Chain (VANGUARD)
          </TabsTrigger>
          <TabsTrigger value="sales" className="gap-2">
            <TrendingUp className="h-4 w-4" /> Sales (SENTINEL)
          </TabsTrigger>
          <TabsTrigger value="trade_distribution" className="gap-2">
            <Package className="h-4 w-4" /> Trade Distribution (SHIELD)
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeStream} className="mt-4 space-y-4">
          {view === "weekly-review" ? (
            <WeeklyReviewPanel entries={streamEntries} stream={activeStream} />
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-card/50 border-border/40">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">Total Entries</div>
                    <div className="text-2xl font-bold mt-1">{stats.total}</div>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {Object.entries(stats.byStatus).map(([s, c]) => {
                        const cfg = STATUS_CONFIG[s];
                        return cfg ? <Badge key={s} className={`${cfg.bg} ${cfg.color} border-0 text-[10px]`}>{cfg.label}: {c}</Badge> : null;
                      })}
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/40">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">Active Pursuits</div>
                    <div className="text-2xl font-bold text-green-400 mt-1">{stats.activePursuits}</div>
                    <div className="text-xs text-muted-foreground mt-1">Promoted & in CRM pipeline</div>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/40">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">Avg ROE (Shortlisted)</div>
                    <div className="text-2xl font-bold text-primary mt-1">{stats.avgRoe}/100</div>
                    <div className="text-xs text-muted-foreground mt-1">Assessed & shortlisted entries</div>
                  </CardContent>
                </Card>
                <Card className="bg-card/50 border-border/40">
                  <CardContent className="pt-4 pb-3 px-4">
                    <div className="text-xs text-muted-foreground">Awaiting Assessment</div>
                    <div className="text-2xl font-bold text-amber-400 mt-1">{stats.awaitingAssessment}</div>
                    <div className="text-xs text-muted-foreground mt-1">No ROE score yet</div>
                  </CardContent>
                </Card>
              </div>

              {/* Filters */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search company, contact, tags..."
                    className="pl-9 bg-card/50 border-border/40"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                  />
                </div>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[150px] bg-card/50 border-border/40">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Statuses</SelectItem>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={gradeFilter} onValueChange={setGradeFilter}>
                  <SelectTrigger className="w-[130px] bg-card/50 border-border/40">
                    <SelectValue placeholder="ROE Grade" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Grades</SelectItem>
                    {["A", "B", "C", "D", "E"].map((g) => <SelectItem key={g} value={g}>Grade {g}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={sectorFilter} onValueChange={setSectorFilter}>
                  <SelectTrigger className="w-[160px] bg-card/50 border-border/40">
                    <SelectValue placeholder="Sector" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Sectors</SelectItem>
                    {Object.entries(SECTOR_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Table */}
              <div className="rounded-xl border border-border/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-card/80 border-b border-border/40">
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Company</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Opportunity</th>
                        <th className="text-left py-3 px-4 font-medium text-muted-foreground">Source</th>
                        <th className="text-left py-3 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("roe")}>
                          <span className="flex items-center gap-1">
                            ROE Score {sortField === "roe" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                          </span>
                        </th>
                        <th className="text-left py-3 px-3 font-medium text-muted-foreground">Resource Check</th>
                        <th className="text-left py-3 px-3 font-medium text-muted-foreground">Status</th>
                        <th className="text-center py-3 px-3 font-medium text-muted-foreground cursor-pointer select-none" onClick={() => toggleSort("urgency")}>
                          <span className="flex items-center justify-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> {sortField === "urgency" && (sortDir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
                          </span>
                        </th>
                        <th className="text-right py-3 px-4 font-medium text-muted-foreground">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredEntries.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="text-center py-12 text-muted-foreground">
                            {streamEntries.length === 0 ? "No register entries yet. OSINT scans and agent imports will populate this register." : "No entries match your filters."}
                          </td>
                        </tr>
                      ) : filteredEntries.map((e) => {
                        const sc = STATUS_CONFIG[e.status] || STATUS_CONFIG.identified;
                        const rg = e.roeScore ? ROE_GRADE_CONFIG[e.roeScore.grade] : null;
                        const vc = e.stockdaleAssessment ? VERDICT_CONFIG[e.stockdaleAssessment.verdict] : null;
                        return (
                          <tr key={e.id} className="border-b border-border/20 hover:bg-card/40 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-medium">{e.company.name}</div>
                              <Badge variant="outline" className="text-[10px] mt-0.5">{SECTOR_LABELS[e.company.sector] || e.company.sector}</Badge>
                            </td>
                            <td className="py-3 px-4 max-w-[200px]">
                              <div className="text-sm truncate">{e.opportunity.description || "-"}</div>
                              <Badge variant="outline" className="text-[10px] mt-0.5">{CATEGORY_LABELS[e.opportunity.category] || e.opportunity.category}</Badge>
                            </td>
                            <td className="py-3 px-4">
                              <div className="text-xs uppercase tracking-wider text-muted-foreground">{e.source.type}</div>
                              <div className="text-xs text-muted-foreground">{e.source.scanDate || toDateStr(e.createdAt)}</div>
                            </td>
                            <td className="py-3 px-3">
                              {e.roeScore ? (
                                <span className={`text-sm font-bold px-2 py-0.5 rounded ${rg?.bg} ${rg?.color}`}>
                                  {e.roeScore.total} ({e.roeScore.grade})
                                </span>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              {vc ? (
                                <Badge className={`${vc.bg} ${vc.color} border-0 text-xs`}>{vc.label}</Badge>
                              ) : (
                                <span className="text-xs text-muted-foreground">-</span>
                              )}
                            </td>
                            <td className="py-3 px-3">
                              <Badge className={`${sc.bg} ${sc.color} border-0 text-xs`}>{sc.label}</Badge>
                            </td>
                            <td className="py-3 px-3 text-center">
                              {e.opportunity.urgencyFlag ? <AlertTriangle className="h-4 w-4 text-red-400 inline" /> : <span className="text-muted-foreground">-</span>}
                            </td>
                            <td className="py-3 px-4 text-right">
                              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setSelectedEntry(e)}>
                                View
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                Showing {filteredEntries.length} of {streamEntries.length} entries
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Detail Dialog */}
      <EntryDetailDialog entry={selectedEntry} open={!!selectedEntry} onClose={() => setSelectedEntry(null)} />
    </div>
  );
}
