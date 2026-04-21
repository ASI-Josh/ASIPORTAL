"use client";

/**
 * Sophie Archer's R&D & Grants Workspace — nested inside the Agent Hub page.
 *
 * Four tabs:
 *   1. Dashboard  — metrics snapshot (project phases, grant pipeline, opportunity inbox)
 *   2. Projects   — R&D project register
 *   3. Grants     — Grant applications pipeline
 *   4. Ops Log    — Opportunity log / intake queue
 *   5. Watchlist  — Grant programmes being monitored
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Target, Landmark, Eye, Lightbulb, RefreshCw, Sparkles,
  AlertTriangle, Flame, Clock, TrendingUp, CheckCircle2, ChevronRight,
  Gavel, MessageSquare, Check, X, Pause,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types (loose — matches the /api/rnd/data response shape) ──────────────

interface ApprovalRecord {
  decision?: string;
  approver?: string;
  decidedAt?: string;
  decidedBy?: string;
  note?: string;
}

interface RndProjectRecord {
  id: string;
  projectNumber?: string;
  title?: string;
  shortDescription?: string;
  phase?: string;
  status?: string;
  priority?: string;
  domain?: string;
  leadAgent?: string;
  estimatedBudget?: number;
  actualSpendToDate?: number;
  requiresDirectorApproval?: boolean;
  approvals?: {
    athena?: ApprovalRecord;
    director?: ApprovalRecord;
  };
  directorReviewNote?: string | null;
  directorReviewRequestedAt?: string | null;
  targetCompletionDate?: string;
  updatedAt?: string;
}

interface GrantRecord {
  id: string;
  grantNumber?: string;
  programmeName?: string;
  programmeBody?: string;
  roundName?: string;
  stage?: string;
  fundingType?: string;
  awardValue?: number;
  awardedAmount?: number;
  submissionDeadline?: string;
  expectedDecisionDate?: string;
  acquittalDueDate?: string;
  linkedRndProjectIds?: string[];
  internalApprovals?: {
    athena?: ApprovalRecord;
    director?: ApprovalRecord;
  };
  directorReviewNote?: string | null;
  directorReviewRequestedAt?: string | null;
  updatedAt?: string;
}

interface OpportunityRecord {
  id: string;
  opportunityNumber?: string;
  title?: string;
  description?: string;
  type?: string;
  sourcedBy?: string;
  sourceContext?: string;
  status?: string;
  reviewScore?: { overall?: number };
  parkedUntil?: string;
  directorReviewNote?: string | null;
  directorReviewRequestedAt?: string | null;
  createdAt?: string;
}

interface ProgrammeRecord {
  id: string;
  programmeName?: string;
  programmeBody?: string;
  level?: string;
  jurisdiction?: string;
  description?: string;
  programmeUrl?: string;
  fundingType?: string;
  typicalValueMin?: number;
  typicalValueMax?: number;
  frequency?: string;
  nextRoundOpensAt?: string;
  fitScore?: number;
  tags?: string[];
  isActive?: boolean;
}

interface NominationPreFeas {
  strategicFitScore?: number;
  technicalFeasibilityScore?: number;
  marketRegulatoryContext?: string;
  grantMatch?: string;
  costEnvelopeMin?: number | null;
  costEnvelopeMax?: number | null;
  flagsAndRisks?: string[];
  verdict?: "pursue" | "park" | "reject";
  writtenBy?: string;
  writtenAt?: string;
}

interface NominationRecord {
  id: string;
  title?: string;
  rationale?: string;
  domain?: string;
  priority?: string;
  targetCompletionDate?: string;
  suggestedProgrammeIds?: string[];
  selectedProgrammeIds?: string[];
  status?: string;
  preFeas?: NominationPreFeas;
  directorDecision?: string;
  directorNote?: string;
  directorDecidedAt?: string;
  directorDecidedBy?: string;
  convertedProjectId?: string;
  convertedGrantIds?: string[];
  submittedBy?: string;
  submittedByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface RndData {
  projects: RndProjectRecord[];
  grants: GrantRecord[];
  opportunities: OpportunityRecord[];
  programmes: ProgrammeRecord[];
  nominations?: NominationRecord[];
  metrics: {
    projects: {
      total: number;
      active: number;
      onHold: number;
      completed: number;
      byPhase: Record<string, number>;
      byDomain: Record<string, number>;
      totalBudget: number;
      totalSpend: number;
      pendingAthenaApproval: number;
      pendingDirectorApproval: number;
    };
    grants: {
      total: number;
      byStage: Record<string, number>;
      totalAwardedYtd: number;
      totalPotentialInFlight: number;
      upcomingDeadlines: Array<{
        grantId: string;
        grantNumber?: string;
        programmeName?: string;
        submissionDeadline: string;
        stage: string;
      }>;
      overdueCompliance: Array<{
        grantId: string;
        grantNumber?: string;
        type: string;
        item: string;
        dueDate: string;
      }>;
    };
    opportunities: {
      total: number;
      byStatus: Record<string, number>;
      byType: Record<string, number>;
      awaitingReview: number;
      readyForRevisit: number;
    };
    nominations?: {
      total: number;
      byStatus: Record<string, number>;
      submittedAwaitingPreFeas: number;
      prefeasCompleteAwaitingApproval: number;
    };
  };
  generatedAt: string;
}

type WorkspaceTab =
  | "dashboard"
  | "approvals"
  | "nominations"
  | "projects"
  | "grants"
  | "opportunities"
  | "watchlist";

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatCurrency(n?: number): string {
  if (n === undefined || n === null) return "—";
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(n);
}

function formatDate(iso?: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

// ─── Stage / phase colour maps ────────────────────────────────────────────

const PHASE_CONFIG: Record<string, { color: string; bg: string }> = {
  scoping:       { color: "text-zinc-400",    bg: "bg-zinc-500/10" },
  feasibility:   { color: "text-violet-400",  bg: "bg-violet-500/10" },
  design:        { color: "text-blue-400",    bg: "bg-blue-500/10" },
  prototype:     { color: "text-cyan-400",    bg: "bg-cyan-500/10" },
  pilot:         { color: "text-indigo-400",  bg: "bg-indigo-500/10" },
  validation:    { color: "text-amber-400",   bg: "bg-amber-500/10" },
  production:    { color: "text-green-400",   bg: "bg-green-500/10" },
  on_hold:       { color: "text-orange-400",  bg: "bg-orange-500/10" },
  archived:      { color: "text-zinc-500",    bg: "bg-zinc-500/10" },
};

const GRANT_STAGE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  monitoring:      { color: "text-zinc-400",    bg: "bg-zinc-500/10",    label: "Monitoring" },
  scoping:         { color: "text-violet-400",  bg: "bg-violet-500/10",  label: "Scoping" },
  drafting:        { color: "text-blue-400",    bg: "bg-blue-500/10",    label: "Drafting" },
  internal_review: { color: "text-cyan-400",    bg: "bg-cyan-500/10",    label: "Internal Review" },
  submitted:       { color: "text-indigo-400",  bg: "bg-indigo-500/10",  label: "Submitted" },
  under_review:    { color: "text-amber-400",   bg: "bg-amber-500/10",   label: "Under Review" },
  interview_stage: { color: "text-orange-400",  bg: "bg-orange-500/10",  label: "Interview" },
  approved:        { color: "text-green-400",   bg: "bg-green-500/10",   label: "Approved" },
  rejected:        { color: "text-red-400",     bg: "bg-red-500/10",     label: "Rejected" },
  withdrawn:       { color: "text-zinc-500",    bg: "bg-zinc-500/10",    label: "Withdrawn" },
  acquitted:       { color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Acquitted" },
};

const OPPORTUNITY_TYPE_LABELS: Record<string, string> = {
  client_pattern: "Client Pattern",
  supplier_innovation: "Supplier Innovation",
  market_gap: "Market Gap",
  technology_signal: "Technology Signal",
  regulatory_change: "Regulatory Change",
  internal_gap: "Internal Gap",
};

const OPPORTUNITY_STATUS_CONFIG: Record<string, { color: string; bg: string }> = {
  new:            { color: "text-blue-400",    bg: "bg-blue-500/10" },
  under_review:   { color: "text-amber-400",   bg: "bg-amber-500/10" },
  accepted:       { color: "text-green-400",   bg: "bg-green-500/10" },
  parked:         { color: "text-orange-400",  bg: "bg-orange-500/10" },
  rejected:       { color: "text-red-400",     bg: "bg-red-500/10" },
  converted:      { color: "text-fuchsia-400", bg: "bg-fuchsia-500/10" },
};

// ─── Component ────────────────────────────────────────────────────────────

export default function ArcherWorkspace() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("dashboard");
  const [data, setData] = useState<RndData | null>(null);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const fetchData = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/rnd/data", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Request failed" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const json = await res.json() as RndData;
      setData(json);
    } catch (err) {
      toast({
        title: "Failed to load R&D workspace",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSeed = async () => {
    if (!firebaseUser) return;
    setSeeding(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/rnd/seed", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Seed failed");
      toast({
        title: "R&D workspace seeded",
        description: `Created ${json.created.programmes} programmes, ${json.created.projects} projects, ${json.created.grants} grants, ${json.created.opportunities} opportunities.`,
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Seed failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSeeding(false);
    }
  };

  const isEmpty = useMemo(() => {
    if (!data) return false;
    return data.projects.length === 0 && data.grants.length === 0 && data.opportunities.length === 0;
  }, [data]);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-fuchsia-500/30 overflow-hidden">
      {/* Header */}
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-fuchsia-500/10 p-2">
              <Target className="h-5 w-5 text-fuchsia-400" />
            </div>
            <div>
              <CardTitle className="text-base font-bold">
                <span className="text-fuchsia-400 tracking-wide">SOPHIE ARCHER</span>
                <span className="text-muted-foreground font-normal ml-2">— R&D & Grants Workspace</span>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                R&D programme register · Grants pipeline · Opportunity intake · Programme watchlist
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              onClick={fetchData}
              disabled={loading}
              title="Refresh"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
            {!loading && isEmpty && (
              <Button variant="outline" size="sm" onClick={handleSeed} disabled={seeding}>
                <Sparkles className="mr-2 h-4 w-4 text-fuchsia-400" />
                {seeding ? "Seeding…" : "Seed Starter Data"}
              </Button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 mt-3 border-b border-border/40 -mb-3 overflow-x-auto">
          {(
            [
              { key: "dashboard",     label: "Dashboard",   icon: TrendingUp },
              { key: "approvals",     label: "Approvals",   icon: Gavel },
              { key: "nominations",   label: "Nominations", icon: Sparkles },
              { key: "projects",      label: "Projects",    icon: Target },
              { key: "grants",        label: "Grants",      icon: Landmark },
              { key: "opportunities", label: "Ops Log",     icon: Eye },
              { key: "watchlist",     label: "Watchlist",   icon: Lightbulb },
            ] as Array<{ key: WorkspaceTab; label: string; icon: typeof Target }>
          ).map((tab) => {
            const Icon = tab.icon;
            const pendingCount = tab.key === "approvals" && data ? countPendingApprovals(data) : 0;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={cn(
                  "px-3 py-2 text-xs font-medium border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap",
                  activeTab === tab.key
                    ? "border-fuchsia-400 text-fuchsia-400"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {tab.label}
                {tab.key === "approvals" && pendingCount > 0 && (
                  <Badge className="text-[9px] h-4 px-1 ml-0.5 border-0 bg-amber-500/20 text-amber-400">
                    {pendingCount}
                  </Badge>
                )}
                {tab.key === "nominations" && data && (data.nominations?.length || 0) > 0 && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5">
                    {data.nominations?.length || 0}
                  </Badge>
                )}
                {tab.key === "projects" && data && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5">{data.metrics.projects.total}</Badge>
                )}
                {tab.key === "grants" && data && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5">{data.metrics.grants.total}</Badge>
                )}
                {tab.key === "opportunities" && data && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5">{data.metrics.opportunities.total}</Badge>
                )}
                {tab.key === "watchlist" && data && (
                  <Badge variant="outline" className="text-[9px] h-4 px-1 ml-0.5">{data.programmes.length}</Badge>
                )}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="pt-4">
        {loading && !data && (
          <div className="flex items-center justify-center py-10 text-muted-foreground text-sm">
            <RefreshCw className="h-4 w-4 animate-spin mr-2" />
            Loading Sophie's workspace…
          </div>
        )}

        {!loading && isEmpty && (
          <div className="text-center py-10 space-y-3">
            <Lightbulb className="h-10 w-10 text-fuchsia-400/40 mx-auto" />
            <div>
              <p className="text-sm font-medium">Sophie's workspace is empty</p>
              <p className="text-xs text-muted-foreground mt-1">
                Click "Seed Starter Data" above to populate with realistic R&D projects, grants, and opportunities.
              </p>
            </div>
          </div>
        )}

        {data && !isEmpty && (
          <>
            {activeTab === "dashboard" && <DashboardTab data={data} onJumpToApprovals={() => setActiveTab("approvals")} />}
            {activeTab === "approvals" && <ApprovalsTab data={data} onRefresh={fetchData} />}
            {activeTab === "nominations" && <NominationsTab data={data} onRefresh={fetchData} />}
            {activeTab === "projects" && <ProjectsTab projects={data.projects} />}
            {activeTab === "grants" && <GrantsTab grants={data.grants} />}
            {activeTab === "opportunities" && <OpportunitiesTab opportunities={data.opportunities} />}
            {activeTab === "watchlist" && <WatchlistTab programmes={data.programmes} />}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Dashboard Tab ────────────────────────────────────────────────────────

function DashboardTab({ data, onJumpToApprovals }: { data: RndData; onJumpToApprovals?: () => void }) {
  const m = data.metrics;
  return (
    <div className="space-y-4">
      {/* Top row: 4 metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <MetricCard
          icon={Target}
          iconColor="text-fuchsia-400"
          label="Active Projects"
          value={`${m.projects.active}`}
          sub={`${m.projects.total} total · ${formatCurrency(m.projects.totalBudget)} budget`}
        />
        <MetricCard
          icon={Landmark}
          iconColor="text-amber-400"
          label="Grants YTD"
          value={formatCurrency(m.grants.totalAwardedYtd)}
          sub={`${formatCurrency(m.grants.totalPotentialInFlight)} in flight`}
        />
        <MetricCard
          icon={Eye}
          iconColor="text-blue-400"
          label="Awaiting Review"
          value={`${m.opportunities.awaitingReview}`}
          sub={`${m.opportunities.readyForRevisit} ready for revisit`}
          highlight={m.opportunities.awaitingReview > 0}
          onClick={m.opportunities.awaitingReview > 0 ? onJumpToApprovals : undefined}
        />
        <MetricCard
          icon={CheckCircle2}
          iconColor="text-emerald-400"
          label="Pending Approvals"
          value={`${m.projects.pendingAthenaApproval + m.projects.pendingDirectorApproval}`}
          sub={`${m.projects.pendingAthenaApproval} ATHENA · ${m.projects.pendingDirectorApproval} Director`}
          highlight={m.projects.pendingDirectorApproval > 0}
          onClick={m.projects.pendingDirectorApproval > 0 ? onJumpToApprovals : undefined}
        />
      </div>

      {/* Middle row: alerts (upcoming deadlines + overdue compliance) */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="bg-card/30 border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-amber-400" />
              Upcoming Grant Deadlines (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {m.grants.upcomingDeadlines.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No deadlines within 30 days.</p>
            ) : (
              m.grants.upcomingDeadlines.slice(0, 5).map((d) => (
                <div key={d.grantId} className="flex items-center justify-between text-xs rounded border border-border/30 bg-card/40 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{d.programmeName}</p>
                    <p className="text-muted-foreground text-[10px]">{d.grantNumber} · {GRANT_STAGE_CONFIG[d.stage]?.label || d.stage}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] ml-2 shrink-0">
                    {formatDate(d.submissionDeadline)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/30 border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className={cn("h-3.5 w-3.5", m.grants.overdueCompliance.length > 0 ? "text-red-400" : "text-muted-foreground")} />
              Overdue Compliance Events
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {m.grants.overdueCompliance.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">All compliance events current.</p>
            ) : (
              m.grants.overdueCompliance.slice(0, 5).map((c, i) => (
                <div key={`${c.grantId}-${i}`} className="flex items-center justify-between text-xs rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{c.item}</p>
                    <p className="text-muted-foreground text-[10px]">{c.grantNumber} · {c.type}</p>
                  </div>
                  <Badge variant="outline" className="text-[10px] ml-2 shrink-0 border-red-500/40 text-red-400">
                    Due {formatDate(c.dueDate)}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom row: phase + stage breakdowns */}
      <div className="grid md:grid-cols-2 gap-3">
        <Card className="bg-card/30 border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Projects by Phase</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-1.5">
            {Object.entries(m.projects.byPhase).map(([phase, count]) => {
              const cfg = PHASE_CONFIG[phase] || { color: "text-zinc-400", bg: "bg-zinc-500/10" };
              return (
                <Badge key={phase} className={cn("text-[10px] border-0 capitalize", cfg.color, cfg.bg)}>
                  {phase.replace(/_/g, " ")}: {count}
                </Badge>
              );
            })}
          </CardContent>
        </Card>

        <Card className="bg-card/30 border-border/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold">Grants by Stage</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 flex flex-wrap gap-1.5">
            {Object.entries(m.grants.byStage).map(([stage, count]) => {
              const cfg = GRANT_STAGE_CONFIG[stage] || { color: "text-zinc-400", bg: "bg-zinc-500/10", label: stage };
              return (
                <Badge key={stage} className={cn("text-[10px] border-0", cfg.color, cfg.bg)}>
                  {cfg.label}: {count}
                </Badge>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  iconColor,
  label,
  value,
  sub,
  highlight,
  onClick,
}: {
  icon: typeof Target;
  iconColor: string;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const base = cn(
    "rounded-lg border p-3 text-left",
    highlight ? "border-amber-500/40 bg-amber-500/5" : "border-border/40 bg-card/30",
    onClick && "hover:border-fuchsia-400/60 hover:bg-card/50 transition-colors cursor-pointer w-full"
  );
  const content = (
    <>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>
    </>
  );
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={base}>
        {content}
      </button>
    );
  }
  return <div className={base}>{content}</div>;
}

// ─── Projects Tab ─────────────────────────────────────────────────────────

function ProjectsTab({ projects }: { projects: RndProjectRecord[] }) {
  if (projects.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-6">No R&D projects in the register.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {projects.map((p) => {
        const phaseCfg = PHASE_CONFIG[p.phase || ""] || { color: "text-zinc-400", bg: "bg-zinc-500/10" };
        const athenaDecision = p.approvals?.athena?.decision || "pending";
        const directorDecision = p.approvals?.director?.decision || "pending";
        const budget = p.estimatedBudget || 0;
        const spend = p.actualSpendToDate || 0;
        const spendPct = budget > 0 ? Math.min(100, Math.round((spend / budget) * 100)) : 0;

        return (
          <div key={p.id} className="rounded-xl border border-border/40 bg-card/40 p-3 hover:border-fuchsia-500/40 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-muted-foreground">{p.projectNumber}</p>
                <p className="text-sm font-semibold leading-tight mt-0.5">{p.title}</p>
              </div>
              <Badge className={cn("text-[10px] border-0 capitalize shrink-0", phaseCfg.color, phaseCfg.bg)}>
                {(p.phase || "scoping").replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mb-2">
              {p.shortDescription}
            </p>
            <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground mb-2">
              <Badge variant="outline" className="text-[9px] capitalize">{p.domain}</Badge>
              <Badge variant="outline" className="text-[9px] capitalize">{p.priority}</Badge>
              {p.targetCompletionDate && (
                <Badge variant="outline" className="text-[9px]">
                  Target: {formatDate(p.targetCompletionDate)}
                </Badge>
              )}
            </div>
            {budget > 0 && (
              <div className="mb-2">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                  <span>{formatCurrency(spend)} / {formatCurrency(budget)}</span>
                  <span>{spendPct}%</span>
                </div>
                <div className="h-1 bg-border/30 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-fuchsia-500/60 transition-all"
                    style={{ width: `${spendPct}%` }}
                  />
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px]">
              <ApprovalDot label="ATHENA" decision={athenaDecision} />
              <ApprovalDot
                label="Director"
                decision={p.requiresDirectorApproval ? directorDecision : "not_required"}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ApprovalDot({ label, decision }: { label: string; decision: string }) {
  const cfg: Record<string, { color: string; dot: string; text: string }> = {
    pending:      { color: "text-amber-400",  dot: "bg-amber-400",  text: "Pending" },
    approved:     { color: "text-green-400",  dot: "bg-green-400",  text: "Approved" },
    rejected:     { color: "text-red-400",    dot: "bg-red-400",    text: "Rejected" },
    not_required: { color: "text-zinc-500",   dot: "bg-zinc-500",   text: "N/A" },
  };
  const c = cfg[decision] || cfg.pending;
  return (
    <div className="flex items-center gap-1">
      <div className={cn("h-1.5 w-1.5 rounded-full", c.dot)} />
      <span className="text-muted-foreground">{label}:</span>
      <span className={c.color}>{c.text}</span>
    </div>
  );
}

// ─── Grants Tab ───────────────────────────────────────────────────────────

function GrantsTab({ grants }: { grants: GrantRecord[] }) {
  if (grants.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-6">No grant applications in the pipeline.</p>;
  }
  return (
    <div className="space-y-2">
      {grants.map((g) => {
        const cfg = GRANT_STAGE_CONFIG[g.stage || "monitoring"] || GRANT_STAGE_CONFIG.monitoring;
        return (
          <div key={g.id} className="rounded-lg border border-border/40 bg-card/40 p-3 hover:border-amber-500/40 transition-colors">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-0.5">
                  <Landmark className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                  <p className="text-xs font-medium text-muted-foreground">{g.grantNumber}</p>
                  <Badge className={cn("text-[9px] border-0", cfg.color, cfg.bg)}>{cfg.label}</Badge>
                </div>
                <p className="text-sm font-semibold leading-tight">
                  {g.programmeName}
                  {g.roundName && <span className="text-muted-foreground font-normal"> · {g.roundName}</span>}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{g.programmeBody}</p>
              </div>
              <div className="text-right shrink-0">
                {g.awardedAmount !== undefined ? (
                  <div>
                    <p className="text-sm font-bold text-green-400">{formatCurrency(g.awardedAmount)}</p>
                    <p className="text-[9px] text-muted-foreground">awarded</p>
                  </div>
                ) : g.awardValue !== undefined ? (
                  <div>
                    <p className="text-sm font-bold text-amber-400">{formatCurrency(g.awardValue)}</p>
                    <p className="text-[9px] text-muted-foreground">potential</p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-3 mt-2 text-[10px] text-muted-foreground flex-wrap">
              {g.submissionDeadline && (
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  Submit by {formatDate(g.submissionDeadline)}
                </span>
              )}
              {g.expectedDecisionDate && (
                <span className="flex items-center gap-1">
                  <ChevronRight className="h-3 w-3" />
                  Decision ~{formatDate(g.expectedDecisionDate)}
                </span>
              )}
              {g.linkedRndProjectIds && g.linkedRndProjectIds.length > 0 && (
                <span className="flex items-center gap-1">
                  <Target className="h-3 w-3" />
                  Funds {g.linkedRndProjectIds.length} project{g.linkedRndProjectIds.length === 1 ? "" : "s"}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Opportunities Tab ────────────────────────────────────────────────────

function OpportunitiesTab({ opportunities }: { opportunities: OpportunityRecord[] }) {
  if (opportunities.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-6">No opportunities logged yet.</p>;
  }

  const awaitingReview = opportunities.filter((o) => o.status === "new" || o.status === "under_review");
  const reviewed = opportunities.filter((o) => !(o.status === "new" || o.status === "under_review"));

  return (
    <div className="space-y-4">
      {awaitingReview.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold mb-2 flex items-center gap-1.5">
            <Flame className="h-3 w-3" />
            Awaiting Archer review ({awaitingReview.length})
          </p>
          <div className="space-y-2">
            {awaitingReview.map((o) => <OpportunityCard key={o.id} opp={o} />)}
          </div>
        </div>
      )}
      {reviewed.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Reviewed ({reviewed.length})
          </p>
          <div className="space-y-2">
            {reviewed.map((o) => <OpportunityCard key={o.id} opp={o} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function OpportunityCard({ opp }: { opp: OpportunityRecord }) {
  const cfg = OPPORTUNITY_STATUS_CONFIG[opp.status || "new"] || OPPORTUNITY_STATUS_CONFIG.new;
  const typeLabel = OPPORTUNITY_TYPE_LABELS[opp.type || ""] || opp.type || "Other";

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-xs font-medium text-muted-foreground">{opp.opportunityNumber}</p>
            <Badge className={cn("text-[9px] border-0 capitalize", cfg.color, cfg.bg)}>
              {(opp.status || "new").replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-[9px]">{typeLabel}</Badge>
          </div>
          <p className="text-sm font-semibold leading-tight">{opp.title}</p>
        </div>
        {opp.reviewScore?.overall !== undefined && (
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-fuchsia-400">{opp.reviewScore.overall.toFixed(1)}</p>
            <p className="text-[9px] text-muted-foreground">score</p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mt-1">
        {opp.description}
      </p>
      <div className="flex items-center gap-2 mt-2 text-[10px] text-muted-foreground flex-wrap">
        <span>Logged by <span className="font-semibold text-foreground">{opp.sourcedBy}</span></span>
        {opp.sourceContext && <span>· {opp.sourceContext}</span>}
      </div>
    </div>
  );
}

// ─── Watchlist Tab ────────────────────────────────────────────────────────

function WatchlistTab({ programmes }: { programmes: ProgrammeRecord[] }) {
  if (programmes.length === 0) {
    return <p className="text-sm text-muted-foreground italic text-center py-6">No grant programmes on the watchlist.</p>;
  }
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {programmes.map((p) => (
        <div key={p.id} className="rounded-xl border border-border/40 bg-card/40 p-3 hover:border-emerald-500/40 transition-colors">
          <div className="flex items-start justify-between gap-2 mb-1">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight">{p.programmeName}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">{p.programmeBody}</p>
            </div>
            {p.fitScore && (
              <div className="flex items-center gap-0.5 text-[10px]">
                {[1, 2, 3, 4, 5].map((n) => (
                  <div key={n} className={cn("h-1.5 w-1.5 rounded-full", n <= (p.fitScore || 0) ? "bg-emerald-400" : "bg-border/40")} />
                ))}
              </div>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mb-2">
            {p.description}
          </p>
          <div className="flex flex-wrap gap-1.5 text-[9px] mb-2">
            <Badge variant="outline" className="text-[9px] capitalize">{p.level}</Badge>
            {p.jurisdiction && <Badge variant="outline" className="text-[9px]">{p.jurisdiction}</Badge>}
            <Badge variant="outline" className="text-[9px] capitalize">{(p.fundingType || "").replace(/_/g, " ")}</Badge>
            <Badge variant="outline" className="text-[9px] capitalize">{(p.frequency || "").replace(/_/g, " ")}</Badge>
          </div>
          {(p.typicalValueMin || p.typicalValueMax) && (
            <p className="text-[10px] text-muted-foreground">
              Typical value: {formatCurrency(p.typicalValueMin)} – {formatCurrency(p.typicalValueMax)}
            </p>
          )}
          {p.nextRoundOpensAt && (
            <p className="text-[10px] text-amber-400 mt-1">
              Next round opens: {formatDate(p.nextRoundOpensAt)}
            </p>
          )}
          {p.programmeUrl && (
            <a
              href={p.programmeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-semibold text-emerald-400 hover:underline mt-1 inline-block"
            >
              View programme →
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Approvals Tab ────────────────────────────────────────────────────────

function countPendingApprovals(data: RndData): number {
  const projectsPending = data.projects.filter(
    (p) => p.requiresDirectorApproval && (p.approvals?.director?.decision || "pending") === "pending"
  ).length;
  const grantsPending = data.grants.filter((g) => {
    const stage = String(g.stage || "");
    if (stage !== "internal_review" && stage !== "drafting") return false;
    return (g.internalApprovals?.director?.decision || "pending") === "pending";
  }).length;
  const oppsPending = data.opportunities.filter(
    (o) => o.status === "new" || o.status === "under_review"
  ).length;
  const nominationsPending = (data.nominations || []).filter(
    (n) => n.status === "prefeas_complete"
  ).length;
  return projectsPending + grantsPending + oppsPending + nominationsPending;
}

type ApprovalDecision =
  | "approved"
  | "rejected"
  | "request_amendments"
  | "accept"
  | "park"
  | "reject";

function ApprovalsTab({ data, onRefresh }: { data: RndData; onRefresh: () => void }) {
  const { firebaseUser, user } = useAuth();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingProjects = useMemo(
    () =>
      data.projects.filter(
        (p) => p.requiresDirectorApproval && (p.approvals?.director?.decision || "pending") === "pending"
      ),
    [data.projects]
  );
  const pendingGrants = useMemo(
    () =>
      data.grants.filter((g) => {
        const stage = String(g.stage || "");
        if (stage !== "internal_review" && stage !== "drafting") return false;
        return (g.internalApprovals?.director?.decision || "pending") === "pending";
      }),
    [data.grants]
  );
  const pendingOpps = useMemo(
    () => data.opportunities.filter((o) => o.status === "new" || o.status === "under_review"),
    [data.opportunities]
  );
  const pendingNominations = useMemo(
    () => (data.nominations || []).filter((n) => n.status === "prefeas_complete"),
    [data.nominations]
  );

  const isAdmin = user?.role === "admin";

  const submit = useCallback(
    async (
      type: "rnd_project" | "grant" | "opportunity",
      id: string,
      decision: ApprovalDecision,
      note: string,
      parkedUntil?: string
    ): Promise<boolean> => {
      if (!firebaseUser) {
        toast({ title: "Sign in first", variant: "destructive" });
        return false;
      }
      if (!isAdmin) {
        toast({
          title: "Director-only action",
          description: "Approvals require admin role. Technicians can view the queue only.",
          variant: "destructive",
        });
        return false;
      }
      setBusyId(id);
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/rnd/approval-action", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ type, id, decision, note: note.trim() || undefined, parkedUntil }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        toast({
          title:
            decision === "request_amendments"
              ? "Amendment request sent to Archer"
              : `${type === "opportunity" ? "Opportunity" : type === "grant" ? "Grant" : "Project"} ${decision}`,
        });
        onRefresh();
        return true;
      } catch (err) {
        toast({
          title: "Action failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [firebaseUser, isAdmin, onRefresh, toast]
  );

  const submitNomination = useCallback(
    async (id: string, action: "approve" | "reject", note: string): Promise<boolean> => {
      if (!firebaseUser) return false;
      if (!isAdmin) {
        toast({ title: "Director-only action", variant: "destructive" });
        return false;
      }
      setBusyId(id);
      try {
        const token = await firebaseUser.getIdToken();
        const res = await fetch("/api/rnd/nomination", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ action, id, note: note.trim() || undefined }),
        });
        const json = (await res.json().catch(() => ({}))) as { error?: string; convertedProjectId?: string };
        if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
        toast({
          title: action === "approve"
            ? `Nomination approved → project ${json.convertedProjectId || "created"}`
            : "Nomination rejected",
        });
        onRefresh();
        return true;
      } catch (err) {
        toast({
          title: "Nomination action failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [firebaseUser, isAdmin, onRefresh, toast]
  );

  const totalPending =
    pendingProjects.length +
    pendingGrants.length +
    pendingOpps.length +
    pendingNominations.length;

  if (totalPending === 0) {
    return (
      <div className="text-center py-10 space-y-2">
        <CheckCircle2 className="h-10 w-10 text-emerald-400/60 mx-auto" />
        <p className="text-sm font-medium">All caught up</p>
        <p className="text-xs text-muted-foreground">
          No pending Director approvals or opportunity reviews in Sophie's queue.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {!isAdmin && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-200">
          Approvals are Director-only. You can view the queue but action buttons are disabled.
        </div>
      )}

      {pendingProjects.length > 0 && (
        <ApprovalsSection
          icon={Target}
          iconColor="text-fuchsia-400"
          title="R&D Projects — Director Approval"
          count={pendingProjects.length}
        >
          {pendingProjects.map((p) => (
            <ProjectApprovalCard
              key={p.id}
              project={p}
              busy={busyId === p.id}
              onSubmit={(decision, note) => submit("rnd_project", p.id, decision, note)}
            />
          ))}
        </ApprovalsSection>
      )}

      {pendingGrants.length > 0 && (
        <ApprovalsSection
          icon={Landmark}
          iconColor="text-amber-400"
          title="Grant Applications — Internal Sign-off"
          count={pendingGrants.length}
        >
          {pendingGrants.map((g) => (
            <GrantApprovalCard
              key={g.id}
              grant={g}
              busy={busyId === g.id}
              onSubmit={(decision, note) => submit("grant", g.id, decision, note)}
            />
          ))}
        </ApprovalsSection>
      )}

      {pendingOpps.length > 0 && (
        <ApprovalsSection
          icon={Eye}
          iconColor="text-blue-400"
          title="Opportunity Log — Review Queue"
          count={pendingOpps.length}
        >
          {pendingOpps.map((o) => (
            <OpportunityApprovalCard
              key={o.id}
              opp={o}
              busy={busyId === o.id}
              onSubmit={(decision, note, parkedUntil) =>
                submit("opportunity", o.id, decision, note, parkedUntil)
              }
            />
          ))}
        </ApprovalsSection>
      )}

      {pendingNominations.length > 0 && (
        <ApprovalsSection
          icon={Sparkles}
          iconColor="text-fuchsia-400"
          title="Nominations — Pre-feas Complete, Awaiting Approval"
          count={pendingNominations.length}
        >
          {pendingNominations.map((n) => (
            <NominationApprovalCard
              key={n.id}
              nomination={n}
              programmes={data.programmes}
              busy={busyId === n.id}
              onApprove={(note) => submitNomination(n.id, "approve", note)}
              onReject={(note) => submitNomination(n.id, "reject", note)}
            />
          ))}
        </ApprovalsSection>
      )}
    </div>
  );
}

function ApprovalsSection({
  icon: Icon,
  iconColor,
  title,
  count,
  children,
}: {
  icon: typeof Target;
  iconColor: string;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
        <Icon className={cn("h-3 w-3", iconColor)} />
        {title}
        <Badge className="text-[9px] h-4 px-1 ml-1 border-0 bg-amber-500/20 text-amber-400">
          {count}
        </Badge>
      </p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

// ─── Individual approval cards ────────────────────────────────────────────

function ApprovalCardShell({
  children,
  highlight,
}: {
  children: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        highlight
          ? "border-amber-500/40 bg-amber-500/5"
          : "border-border/40 bg-card/40"
      )}
    >
      {children}
    </div>
  );
}

function ProjectApprovalCard({
  project,
  busy,
  onSubmit,
}: {
  project: RndProjectRecord;
  busy: boolean;
  onSubmit: (decision: ApprovalDecision, note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const phaseCfg = PHASE_CONFIG[project.phase || ""] || { color: "text-zinc-400", bg: "bg-zinc-500/10" };
  const athenaDecision = project.approvals?.athena?.decision || "pending";
  const athenaNote = project.approvals?.athena?.note;
  const budget = project.estimatedBudget || 0;
  const priorReviewNote = project.directorReviewNote;

  const handle = async (decision: ApprovalDecision) => {
    const ok = await onSubmit(decision, note);
    if (ok) setNote("");
  };

  return (
    <ApprovalCardShell highlight>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-muted-foreground">{project.projectNumber}</p>
          <p className="text-sm font-semibold leading-tight mt-0.5">{project.title}</p>
        </div>
        <Badge className={cn("text-[10px] border-0 capitalize shrink-0", phaseCfg.color, phaseCfg.bg)}>
          {(project.phase || "scoping").replace(/_/g, " ")}
        </Badge>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3 mb-2">
        {project.shortDescription}
      </p>
      <div className="flex flex-wrap gap-1.5 text-[10px] mb-2">
        <Badge variant="outline" className="text-[9px] capitalize">{project.domain}</Badge>
        <Badge variant="outline" className="text-[9px] capitalize">{project.priority}</Badge>
        {budget > 0 && (
          <Badge variant="outline" className="text-[9px]">
            Budget: {formatCurrency(budget)}
          </Badge>
        )}
        {project.targetCompletionDate && (
          <Badge variant="outline" className="text-[9px]">
            Target: {formatDate(project.targetCompletionDate)}
          </Badge>
        )}
      </div>

      {athenaDecision === "approved" && (
        <div className="rounded border border-green-500/30 bg-green-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-green-400 font-semibold mb-0.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> ATHENA approved
          </p>
          {athenaNote && <p className="text-muted-foreground italic">&quot;{athenaNote}&quot;</p>}
        </div>
      )}
      {athenaDecision === "rejected" && (
        <div className="rounded border border-red-500/30 bg-red-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-red-400 font-semibold mb-0.5 flex items-center gap-1">
            <X className="h-3 w-3" /> ATHENA rejected
          </p>
          {athenaNote && <p className="text-muted-foreground italic">&quot;{athenaNote}&quot;</p>}
        </div>
      )}
      {priorReviewNote && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-blue-400 font-semibold mb-0.5 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Your previous amendment note
          </p>
          <p className="text-muted-foreground italic">&quot;{priorReviewNote}&quot;</p>
        </div>
      )}

      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px]"
          onClick={() => setOpen(true)}
          disabled={busy}
        >
          <Gavel className="h-3 w-3 mr-1.5" />
          Review &amp; decide
        </Button>
      ) : (
        <ActionBlock
          note={note}
          setNote={setNote}
          busy={busy}
          placeholder="Notes for Sophie (required for amendments, optional for approve/reject)…"
          onApprove={() => handle("approved")}
          onReject={() => handle("rejected")}
          onRequestAmendments={() => handle("request_amendments")}
          onCancel={() => {
            setOpen(false);
            setNote("");
          }}
        />
      )}
    </ApprovalCardShell>
  );
}

function GrantApprovalCard({
  grant,
  busy,
  onSubmit,
}: {
  grant: GrantRecord;
  busy: boolean;
  onSubmit: (decision: ApprovalDecision, note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const cfg = GRANT_STAGE_CONFIG[grant.stage || "monitoring"] || GRANT_STAGE_CONFIG.monitoring;
  const athenaDecision = grant.internalApprovals?.athena?.decision || "pending";
  const athenaNote = grant.internalApprovals?.athena?.note;
  const priorReviewNote = grant.directorReviewNote;

  const handle = async (decision: ApprovalDecision) => {
    const ok = await onSubmit(decision, note);
    if (ok) setNote("");
  };

  return (
    <ApprovalCardShell highlight>
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <Landmark className="h-3.5 w-3.5 text-amber-400 shrink-0" />
            <p className="text-xs font-medium text-muted-foreground">{grant.grantNumber}</p>
            <Badge className={cn("text-[9px] border-0", cfg.color, cfg.bg)}>{cfg.label}</Badge>
          </div>
          <p className="text-sm font-semibold leading-tight">
            {grant.programmeName}
            {grant.roundName && <span className="text-muted-foreground font-normal"> · {grant.roundName}</span>}
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">{grant.programmeBody}</p>
        </div>
        <div className="text-right shrink-0">
          {grant.awardValue !== undefined && (
            <>
              <p className="text-sm font-bold text-amber-400">{formatCurrency(grant.awardValue)}</p>
              <p className="text-[9px] text-muted-foreground">potential</p>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 mb-2 text-[10px] text-muted-foreground flex-wrap">
        {grant.submissionDeadline && (
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            Submit by {formatDate(grant.submissionDeadline)}
          </span>
        )}
        {grant.linkedRndProjectIds && grant.linkedRndProjectIds.length > 0 && (
          <span className="flex items-center gap-1">
            <Target className="h-3 w-3" />
            Funds {grant.linkedRndProjectIds.length} project
            {grant.linkedRndProjectIds.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {athenaDecision === "approved" && (
        <div className="rounded border border-green-500/30 bg-green-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-green-400 font-semibold mb-0.5 flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" /> ATHENA approved internal submission
          </p>
          {athenaNote && <p className="text-muted-foreground italic">&quot;{athenaNote}&quot;</p>}
        </div>
      )}
      {priorReviewNote && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-blue-400 font-semibold mb-0.5 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Your previous amendment note
          </p>
          <p className="text-muted-foreground italic">&quot;{priorReviewNote}&quot;</p>
        </div>
      )}

      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px]"
          onClick={() => setOpen(true)}
          disabled={busy}
        >
          <Gavel className="h-3 w-3 mr-1.5" />
          Review &amp; decide
        </Button>
      ) : (
        <ActionBlock
          note={note}
          setNote={setNote}
          busy={busy}
          placeholder="Notes for Sophie (required for amendments)…"
          onApprove={() => handle("approved")}
          onReject={() => handle("rejected")}
          onRequestAmendments={() => handle("request_amendments")}
          onCancel={() => {
            setOpen(false);
            setNote("");
          }}
        />
      )}
    </ApprovalCardShell>
  );
}

function OpportunityApprovalCard({
  opp,
  busy,
  onSubmit,
}: {
  opp: OpportunityRecord;
  busy: boolean;
  onSubmit: (
    decision: ApprovalDecision,
    note: string,
    parkedUntil?: string
  ) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const [parkedUntil, setParkedUntil] = useState("");

  const cfg = OPPORTUNITY_STATUS_CONFIG[opp.status || "new"] || OPPORTUNITY_STATUS_CONFIG.new;
  const typeLabel = OPPORTUNITY_TYPE_LABELS[opp.type || ""] || opp.type || "Other";
  const priorReviewNote = opp.directorReviewNote;

  const handle = async (decision: ApprovalDecision) => {
    const effectiveParkedUntil = decision === "park" ? parkedUntil : undefined;
    const ok = await onSubmit(decision, note, effectiveParkedUntil);
    if (ok) {
      setNote("");
      setParkedUntil("");
    }
  };

  return (
    <ApprovalCardShell highlight>
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <p className="text-xs font-medium text-muted-foreground">{opp.opportunityNumber}</p>
            <Badge className={cn("text-[9px] border-0 capitalize", cfg.color, cfg.bg)}>
              {(opp.status || "new").replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-[9px]">{typeLabel}</Badge>
          </div>
          <p className="text-sm font-semibold leading-tight">{opp.title}</p>
        </div>
        {opp.reviewScore?.overall !== undefined && (
          <div className="text-right shrink-0">
            <p className="text-sm font-bold text-fuchsia-400">
              {opp.reviewScore.overall.toFixed(1)}
            </p>
            <p className="text-[9px] text-muted-foreground">Archer score</p>
          </div>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-3 mt-1 mb-2">
        {opp.description}
      </p>
      <div className="flex items-center gap-2 mb-2 text-[10px] text-muted-foreground flex-wrap">
        <span>Logged by <span className="font-semibold text-foreground">{opp.sourcedBy}</span></span>
        {opp.sourceContext && <span>· {opp.sourceContext}</span>}
      </div>

      {priorReviewNote && (
        <div className="rounded border border-blue-500/30 bg-blue-500/5 px-2 py-1.5 mb-2 text-[10px]">
          <p className="text-blue-400 font-semibold mb-0.5 flex items-center gap-1">
            <MessageSquare className="h-3 w-3" /> Your previous amendment note
          </p>
          <p className="text-muted-foreground italic">&quot;{priorReviewNote}&quot;</p>
        </div>
      )}

      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px]"
          onClick={() => setOpen(true)}
          disabled={busy}
        >
          <Gavel className="h-3 w-3 mr-1.5" />
          Review &amp; decide
        </Button>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Notes for Sophie (required for amendments)…"
            rows={2}
            className="text-xs"
            disabled={busy}
          />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
            <label className="flex items-center gap-1.5">
              Park until:
              <Input
                type="date"
                value={parkedUntil}
                onChange={(e) => setParkedUntil(e.target.value)}
                disabled={busy}
                className="h-7 text-[11px] w-36"
              />
            </label>
            <span className="text-[10px] italic">(only used for Park)</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              className="h-7 text-[11px] bg-green-600 hover:bg-green-700"
              onClick={() => handle("accept")}
              disabled={busy}
            >
              <Check className="h-3 w-3 mr-1" />
              Accept
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-orange-600 hover:bg-orange-700"
              onClick={() => handle("park")}
              disabled={busy}
            >
              <Pause className="h-3 w-3 mr-1" />
              Park
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-red-600 hover:bg-red-700"
              onClick={() => handle("reject")}
              disabled={busy}
            >
              <X className="h-3 w-3 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => handle("request_amendments")}
              disabled={busy || !note.trim()}
              title={!note.trim() ? "Add a note first so Archer knows what to change" : undefined}
            >
              <MessageSquare className="h-3 w-3 mr-1" />
              Request amendments
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] ml-auto"
              onClick={() => {
                setOpen(false);
                setNote("");
                setParkedUntil("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </ApprovalCardShell>
  );
}

function ActionBlock({
  note,
  setNote,
  busy,
  placeholder,
  onApprove,
  onReject,
  onRequestAmendments,
  onCancel,
}: {
  note: string;
  setNote: (v: string) => void;
  busy: boolean;
  placeholder: string;
  onApprove: () => void;
  onReject: () => void;
  onRequestAmendments: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="text-xs"
        disabled={busy}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          size="sm"
          className="h-7 text-[11px] bg-green-600 hover:bg-green-700"
          onClick={onApprove}
          disabled={busy}
        >
          <Check className="h-3 w-3 mr-1" />
          Approve
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={onRequestAmendments}
          disabled={busy || !note.trim()}
          title={!note.trim() ? "Add a note first so Archer knows what to change" : undefined}
        >
          <MessageSquare className="h-3 w-3 mr-1" />
          Request amendments
        </Button>
        <Button
          size="sm"
          className="h-7 text-[11px] bg-red-600 hover:bg-red-700"
          onClick={onReject}
          disabled={busy}
        >
          <X className="h-3 w-3 mr-1" />
          Reject
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-[11px] ml-auto"
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

// ─── Nominations Tab ──────────────────────────────────────────────────────

function NominationsTab({
  data,
  onRefresh,
}: {
  data: RndData;
  onRefresh: () => void;
}) {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Form state
  const [title, setTitle] = useState("");
  const [rationale, setRationale] = useState("");
  const [domain, setDomain] = useState("");
  const [priority, setPriority] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [targetCompletion, setTargetCompletion] = useState("");
  const [selectedProgrammes, setSelectedProgrammes] = useState<string[]>([]);
  const [manualTags, setManualTags] = useState("");

  const nominations = data.nominations || [];
  const inProgress = nominations.filter(
    (n) => n.status === "submitted" || n.status === "in_prefeas"
  );
  const awaitingApproval = nominations.filter((n) => n.status === "prefeas_complete");
  const resolved = nominations.filter((n) =>
    ["approved", "rejected", "withdrawn"].includes(String(n.status || ""))
  );

  // Auto-suggested programmes based on manual-tag overlap with watchlist entries.
  const suggestedProgrammes = useMemo(() => {
    const tags = manualTags
      .toLowerCase()
      .split(/[,\s]+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (tags.length === 0) return [];
    const scored = data.programmes.map((p) => {
      const programmeTags = (p.tags || []).map((t) => t.toLowerCase());
      const overlap = programmeTags.filter((t) => tags.includes(t)).length;
      return { programme: p, overlap, fit: p.fitScore || 0 };
    });
    return scored
      .filter((s) => s.overlap > 0 || s.fit >= 4)
      .sort((a, b) => b.overlap * 10 + b.fit - (a.overlap * 10 + a.fit))
      .slice(0, 6)
      .map((s) => s.programme);
  }, [manualTags, data.programmes]);

  const toggleProgramme = (id: string) => {
    setSelectedProgrammes((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const resetForm = () => {
    setTitle("");
    setRationale("");
    setDomain("");
    setPriority("medium");
    setTargetCompletion("");
    setSelectedProgrammes([]);
    setManualTags("");
  };

  const handleSubmit = async () => {
    if (!firebaseUser) return;
    if (!title.trim() || !rationale.trim()) {
      toast({ title: "Title and rationale are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const token = await firebaseUser.getIdToken();
      const suggestedIds = suggestedProgrammes
        .map((p) => p.id)
        .filter((id) => !selectedProgrammes.includes(id));
      const res = await fetch("/api/rnd/nomination", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          action: "create",
          title: title.trim(),
          rationale: rationale.trim(),
          domain: domain || undefined,
          priority,
          targetCompletionDate: targetCompletion || undefined,
          suggestedProgrammeIds: suggestedIds,
          selectedProgrammeIds: selectedProgrammes,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; id?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast({ title: "Nomination submitted", description: "Sophie will pre-feas it shortly." });
      resetForm();
      setShowForm(false);
      onRefresh();
    } catch (err) {
      toast({
        title: "Nomination failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async (id: string) => {
    if (!firebaseUser) return;
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/rnd/nomination", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "withdraw", id }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      toast({ title: "Nomination withdrawn" });
      onRefresh();
    } catch (err) {
      toast({
        title: "Withdraw failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  const isAdmin = user?.role === "admin";

  return (
    <div className="space-y-5">
      {/* Submit button */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Nominate a new R&D project for Sophie to pre-feas. She writes the brief, you approve
          the good ones, and approval auto-creates the project + drafts grant applications.
        </p>
        {!showForm && isAdmin && (
          <Button
            size="sm"
            className="bg-fuchsia-600 hover:bg-fuchsia-700 shrink-0"
            onClick={() => setShowForm(true)}
          >
            <Sparkles className="h-3.5 w-3.5 mr-1.5" />
            New nomination
          </Button>
        )}
      </div>

      {/* Form */}
      {showForm && (
        <Card className="bg-fuchsia-500/5 border-fuchsia-500/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-fuchsia-400" />
              New R&D Nomination
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                Title
              </label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. UV-cured film topcoat for mass-transit glazing"
                disabled={submitting}
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                Rationale — why this, why now
              </label>
              <Textarea
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                placeholder="Strategic context, the commercial gap, the technical angle, any signal from the ops log or management meeting."
                rows={4}
                disabled={submitting}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Domain
                </label>
                <Input
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  placeholder="e.g. films_coatings, materials, process"
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Priority
                </label>
                <select
                  value={priority}
                  onChange={(e) =>
                    setPriority(e.target.value as "low" | "medium" | "high" | "critical")
                  }
                  disabled={submitting}
                  className="w-full rounded-md border border-border/40 bg-background/60 px-3 py-2 text-sm"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Target completion
                </label>
                <Input
                  type="date"
                  value={targetCompletion}
                  onChange={(e) => setTargetCompletion(e.target.value)}
                  disabled={submitting}
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground block mb-1">
                  Grant-match tags (for auto-suggest)
                </label>
                <Input
                  value={manualTags}
                  onChange={(e) => setManualTags(e.target.value)}
                  placeholder="e.g. cleantech manufacturing export"
                  disabled={submitting}
                />
              </div>
            </div>

            {/* Programme suggestions + manual selection */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                Tag grant programmes for pursuit ({selectedProgrammes.length} selected)
              </p>
              {data.programmes.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">
                  No programmes on the watchlist. Tag tags above and the list will suggest
                  matches once there are programmes.
                </p>
              ) : (
                <>
                  {suggestedProgrammes.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[10px] text-fuchsia-400 font-semibold mb-1">
                        Auto-suggested matches
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {suggestedProgrammes.map((p) => {
                          const selected = selectedProgrammes.includes(p.id);
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => toggleProgramme(p.id)}
                              className={cn(
                                "rounded-lg border px-2 py-1.5 text-[11px] text-left transition-colors",
                                selected
                                  ? "border-fuchsia-500/60 bg-fuchsia-500/10 text-foreground"
                                  : "border-border/40 bg-card/40 hover:border-fuchsia-500/40"
                              )}
                            >
                              <span className="font-medium">{p.programmeName}</span>
                              <span className="text-muted-foreground ml-1">
                                · {p.programmeBody}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <details>
                    <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                      Browse all {data.programmes.length} programmes
                    </summary>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {data.programmes.map((p) => {
                        const selected = selectedProgrammes.includes(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => toggleProgramme(p.id)}
                            className={cn(
                              "rounded-lg border px-2 py-1.5 text-[11px] text-left transition-colors",
                              selected
                                ? "border-fuchsia-500/60 bg-fuchsia-500/10 text-foreground"
                                : "border-border/40 bg-card/40 hover:border-fuchsia-500/40"
                            )}
                          >
                            {p.programmeName}
                          </button>
                        );
                      })}
                    </div>
                  </details>
                </>
              )}
            </div>

            <div className="flex items-center gap-2 pt-2">
              <Button
                size="sm"
                className="bg-fuchsia-600 hover:bg-fuchsia-700"
                onClick={handleSubmit}
                disabled={submitting || !title.trim() || !rationale.trim()}
              >
                <Check className="h-3.5 w-3.5 mr-1.5" />
                Submit to Sophie
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  resetForm();
                  setShowForm(false);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Awaiting approval (these also show in Approvals tab but mirror here) */}
      {awaitingApproval.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5 text-fuchsia-400">
            <Gavel className="h-3 w-3" />
            Awaiting your approval ({awaitingApproval.length})
          </p>
          <div className="space-y-2">
            {awaitingApproval.map((n) => (
              <NominationSummaryCard
                key={n.id}
                nomination={n}
                programmes={data.programmes}
                showWithdraw={n.submittedBy === user?.uid || isAdmin}
                onWithdraw={() => handleWithdraw(n.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* In progress */}
      {inProgress.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider font-semibold mb-2 flex items-center gap-1.5 text-amber-400">
            <Clock className="h-3 w-3" />
            In progress ({inProgress.length})
          </p>
          <div className="space-y-2">
            {inProgress.map((n) => (
              <NominationSummaryCard
                key={n.id}
                nomination={n}
                programmes={data.programmes}
                showWithdraw={n.submittedBy === user?.uid || isAdmin}
                onWithdraw={() => handleWithdraw(n.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Resolved ({resolved.length})
          </p>
          <div className="space-y-2">
            {resolved.slice(0, 10).map((n) => (
              <NominationSummaryCard
                key={n.id}
                nomination={n}
                programmes={data.programmes}
              />
            ))}
          </div>
        </div>
      )}

      {nominations.length === 0 && !showForm && (
        <div className="text-center py-10 space-y-2">
          <Sparkles className="h-10 w-10 text-fuchsia-400/40 mx-auto" />
          <p className="text-sm font-medium">No nominations yet</p>
          <p className="text-xs text-muted-foreground">
            Submit your first R&D nomination to kick off Sophie's pre-feas workflow.
          </p>
        </div>
      )}
    </div>
  );
}

function NominationSummaryCard({
  nomination,
  programmes,
  showWithdraw,
  onWithdraw,
}: {
  nomination: NominationRecord;
  programmes: ProgrammeRecord[];
  showWithdraw?: boolean;
  onWithdraw?: () => void;
}) {
  const statusCfg: Record<string, { color: string; bg: string; label: string }> = {
    submitted: { color: "text-amber-400", bg: "bg-amber-500/10", label: "Awaiting pre-feas" },
    in_prefeas: { color: "text-blue-400", bg: "bg-blue-500/10", label: "In pre-feas" },
    prefeas_complete: {
      color: "text-fuchsia-400",
      bg: "bg-fuchsia-500/10",
      label: "Awaiting approval",
    },
    approved: { color: "text-green-400", bg: "bg-green-500/10", label: "Approved" },
    rejected: { color: "text-red-400", bg: "bg-red-500/10", label: "Rejected" },
    withdrawn: { color: "text-zinc-500", bg: "bg-zinc-500/10", label: "Withdrawn" },
  };
  const cfg = statusCfg[nomination.status || "submitted"] || statusCfg.submitted;
  const canWithdraw =
    showWithdraw &&
    (nomination.status === "submitted" || nomination.status === "in_prefeas");

  const programmeNames = (nomination.selectedProgrammeIds || [])
    .map((id) => programmes.find((p) => p.id === id)?.programmeName)
    .filter(Boolean) as string[];

  return (
    <div className="rounded-lg border border-border/40 bg-card/40 p-3">
      <div className="flex items-start justify-between gap-2 flex-wrap mb-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <Badge className={cn("text-[9px] border-0", cfg.color, cfg.bg)}>{cfg.label}</Badge>
            {nomination.priority && (
              <Badge variant="outline" className="text-[9px] capitalize">
                {nomination.priority}
              </Badge>
            )}
            {nomination.domain && (
              <Badge variant="outline" className="text-[9px] capitalize">
                {nomination.domain}
              </Badge>
            )}
          </div>
          <p className="text-sm font-semibold leading-tight">{nomination.title}</p>
        </div>
        {canWithdraw && (
          <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onWithdraw}>
            Withdraw
          </Button>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2 mt-1">
        {nomination.rationale}
      </p>
      {programmeNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {programmeNames.map((n) => (
            <Badge key={n} variant="outline" className="text-[9px]">
              <Landmark className="h-2.5 w-2.5 mr-1" />
              {n}
            </Badge>
          ))}
        </div>
      )}
      {nomination.preFeas && (
        <div className="mt-2 rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 space-y-1 text-[10px]">
          <p className="font-semibold text-fuchsia-400">Pre-feas brief</p>
          <div className="flex gap-3 flex-wrap">
            <span>
              Strategic fit:{" "}
              <span className="text-foreground">{nomination.preFeas.strategicFitScore}/5</span>
            </span>
            <span>
              Feasibility:{" "}
              <span className="text-foreground">
                {nomination.preFeas.technicalFeasibilityScore}/5
              </span>
            </span>
            <span>
              Verdict:{" "}
              <span
                className={cn(
                  "font-semibold",
                  nomination.preFeas.verdict === "pursue"
                    ? "text-green-400"
                    : nomination.preFeas.verdict === "park"
                      ? "text-orange-400"
                      : "text-red-400"
                )}
              >
                {nomination.preFeas.verdict}
              </span>
            </span>
          </div>
          {nomination.preFeas.grantMatch && (
            <p className="text-muted-foreground italic">
              Grant match: {nomination.preFeas.grantMatch}
            </p>
          )}
        </div>
      )}
      {nomination.directorNote && (
        <div className="mt-2 rounded border border-blue-500/30 bg-blue-500/5 p-2 text-[10px]">
          <p className="font-semibold text-blue-400">
            Director decision: {nomination.directorDecision}
          </p>
          <p className="text-muted-foreground italic">&quot;{nomination.directorNote}&quot;</p>
        </div>
      )}
      {nomination.convertedProjectId && (
        <p className="text-[10px] text-green-400 mt-2">
          → Converted to project {nomination.convertedProjectId}
          {nomination.convertedGrantIds && nomination.convertedGrantIds.length > 0 && (
            <span> + {nomination.convertedGrantIds.length} draft grant application(s)</span>
          )}
        </p>
      )}
    </div>
  );
}

function NominationApprovalCard({
  nomination,
  programmes,
  busy,
  onApprove,
  onReject,
}: {
  nomination: NominationRecord;
  programmes: ProgrammeRecord[];
  busy: boolean;
  onApprove: (note: string) => Promise<boolean>;
  onReject: (note: string) => Promise<boolean>;
}) {
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);

  const programmeNames = (nomination.selectedProgrammeIds || [])
    .map((id) => programmes.find((p) => p.id === id)?.programmeName)
    .filter(Boolean) as string[];

  const handle = async (action: "approve" | "reject") => {
    const ok = action === "approve" ? await onApprove(note) : await onReject(note);
    if (ok) {
      setNote("");
      setOpen(false);
    }
  };

  return (
    <ApprovalCardShell highlight>
      <div className="flex items-start justify-between gap-2 mb-1.5 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{nomination.title}</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Submitted by {nomination.submittedByName || "unknown"}
          </p>
        </div>
        {nomination.priority && (
          <Badge variant="outline" className="text-[9px] capitalize">
            {nomination.priority}
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug mb-2 line-clamp-3">
        {nomination.rationale}
      </p>

      {nomination.preFeas && (
        <div className="rounded border border-fuchsia-500/30 bg-fuchsia-500/5 p-2 space-y-1 text-[10px] mb-2">
          <p className="font-semibold text-fuchsia-400 flex items-center gap-1">
            <Sparkles className="h-3 w-3" />
            Sophie&apos;s pre-feas brief
          </p>
          <div className="grid grid-cols-2 gap-1">
            <span>
              Strategic fit:{" "}
              <span className="text-foreground font-semibold">
                {nomination.preFeas.strategicFitScore}/5
              </span>
            </span>
            <span>
              Technical feasibility:{" "}
              <span className="text-foreground font-semibold">
                {nomination.preFeas.technicalFeasibilityScore}/5
              </span>
            </span>
          </div>
          {nomination.preFeas.marketRegulatoryContext && (
            <p className="mt-1">
              <span className="text-muted-foreground">Context:</span>{" "}
              {nomination.preFeas.marketRegulatoryContext}
            </p>
          )}
          {nomination.preFeas.grantMatch && (
            <p>
              <span className="text-muted-foreground">Grant match:</span>{" "}
              {nomination.preFeas.grantMatch}
            </p>
          )}
          {(nomination.preFeas.costEnvelopeMin !== null &&
            nomination.preFeas.costEnvelopeMin !== undefined) ||
          (nomination.preFeas.costEnvelopeMax !== null &&
            nomination.preFeas.costEnvelopeMax !== undefined) ? (
            <p>
              <span className="text-muted-foreground">Cost envelope:</span>{" "}
              {formatCurrency(nomination.preFeas.costEnvelopeMin || undefined)} –{" "}
              {formatCurrency(nomination.preFeas.costEnvelopeMax || undefined)}
            </p>
          ) : null}
          {nomination.preFeas.flagsAndRisks && nomination.preFeas.flagsAndRisks.length > 0 && (
            <p>
              <span className="text-muted-foreground">Flags:</span>{" "}
              {nomination.preFeas.flagsAndRisks.join(" · ")}
            </p>
          )}
          <p className="pt-1">
            <span className="text-muted-foreground">Verdict:</span>{" "}
            <span
              className={cn(
                "font-semibold",
                nomination.preFeas.verdict === "pursue"
                  ? "text-green-400"
                  : nomination.preFeas.verdict === "park"
                    ? "text-orange-400"
                    : "text-red-400"
              )}
            >
              {nomination.preFeas.verdict}
            </span>
          </p>
        </div>
      )}

      {programmeNames.length > 0 && (
        <div className="mb-2">
          <p className="text-[10px] text-muted-foreground mb-1">
            Approval will draft grant applications against:
          </p>
          <div className="flex flex-wrap gap-1">
            {programmeNames.map((n) => (
              <Badge key={n} variant="outline" className="text-[9px]">
                <Landmark className="h-2.5 w-2.5 mr-1" />
                {n}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {!open ? (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-[11px]"
          onClick={() => setOpen(true)}
          disabled={busy}
        >
          <Gavel className="h-3 w-3 mr-1.5" />
          Review &amp; decide
        </Button>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note for the decision…"
            rows={2}
            className="text-xs"
            disabled={busy}
          />
          <div className="flex flex-wrap gap-1.5">
            <Button
              size="sm"
              className="h-7 text-[11px] bg-green-600 hover:bg-green-700"
              onClick={() => handle("approve")}
              disabled={busy}
              title="Approve: creates the R&D project + drafts grant applications against tagged programmes"
            >
              <Check className="h-3 w-3 mr-1" />
              Approve &amp; create project
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-red-600 hover:bg-red-700"
              onClick={() => handle("reject")}
              disabled={busy}
            >
              <X className="h-3 w-3 mr-1" />
              Reject
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-[11px] ml-auto"
              onClick={() => {
                setOpen(false);
                setNote("");
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </ApprovalCardShell>
  );
}

