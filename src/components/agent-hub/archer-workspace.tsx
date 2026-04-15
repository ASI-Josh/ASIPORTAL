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
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Types (loose — matches the /api/rnd/data response shape) ──────────────

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
    athena?: { decision?: string };
    director?: { decision?: string };
  };
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

interface RndData {
  projects: RndProjectRecord[];
  grants: GrantRecord[];
  opportunities: OpportunityRecord[];
  programmes: ProgrammeRecord[];
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
  };
  generatedAt: string;
}

type WorkspaceTab = "dashboard" | "projects" | "grants" | "opportunities" | "watchlist";

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
              { key: "projects",      label: "Projects",    icon: Target },
              { key: "grants",        label: "Grants",      icon: Landmark },
              { key: "opportunities", label: "Ops Log",     icon: Eye },
              { key: "watchlist",     label: "Watchlist",   icon: Lightbulb },
            ] as Array<{ key: WorkspaceTab; label: string; icon: typeof Target }>
          ).map((tab) => {
            const Icon = tab.icon;
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
            {activeTab === "dashboard" && <DashboardTab data={data} />}
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

function DashboardTab({ data }: { data: RndData }) {
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
        />
        <MetricCard
          icon={CheckCircle2}
          iconColor="text-emerald-400"
          label="Pending Approvals"
          value={`${m.projects.pendingAthenaApproval + m.projects.pendingDirectorApproval}`}
          sub={`${m.projects.pendingAthenaApproval} ATHENA · ${m.projects.pendingDirectorApproval} Director`}
          highlight={m.projects.pendingDirectorApproval > 0}
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
}: {
  icon: typeof Target;
  iconColor: string;
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
}) {
  return (
    <div className={cn(
      "rounded-lg border p-3",
      highlight ? "border-amber-500/40 bg-amber-500/5" : "border-border/40 bg-card/30"
    )}>
      <div className="flex items-center gap-2 mb-1">
        <Icon className={cn("h-3.5 w-3.5", iconColor)} />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="text-lg font-bold">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{sub}</p>
    </div>
  );
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
