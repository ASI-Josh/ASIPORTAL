"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  FileText, TrendingUp, AlertTriangle, Target, Lightbulb,
  BarChart3, Shield,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebaseClient";
import { collection, query, orderBy, limit as fbLimit, onSnapshot } from "firebase/firestore";
import { COLLECTIONS } from "@/lib/collections";
import { cn } from "@/lib/utils";
import type { ExecutiveReport, ExecutiveReportKpi } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeekEnding(d: string) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  return date.toLocaleDateString("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const SEVERITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400 border-red-500/30",
  critical: "bg-red-500/15 text-red-400 border-red-500/30",
  medium: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  low: "bg-blue-500/15 text-blue-400 border-blue-500/30",
};

const TREND_ICON: Record<string, { symbol: string; color: string }> = {
  up: { symbol: "▲", color: "text-green-400" },
  down: { symbol: "▼", color: "text-red-400" },
  flat: { symbol: "—", color: "text-muted-foreground" },
};

// ─── Collapsible Section ─────────────────────────────────────────────────────

function Section({ title, icon: Icon, badge, defaultOpen = false, children }: {
  title: string;
  icon: typeof TrendingUp;
  badge?: string | number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-border/40 bg-card/60 backdrop-blur">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-4 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-primary" />
          <span className="font-semibold">{title}</span>
          {badge != null && <Badge variant="outline" className="ml-2">{badge}</Badge>}
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>
      {open && <CardContent className="pt-0">{children}</CardContent>}
    </Card>
  );
}

// ─── Dynamic object renderer ─────────────────────────────────────────────────

function renderValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    return (
      <ul className="space-y-1 ml-2">
        {value.map((item, i) => (
          <li key={i} className="text-sm">{renderValue(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="grid gap-2">
        {entries.map(([k, v]) => (
          <div key={k} className="bg-muted/20 rounded-lg p-3 border border-border/20">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">
              {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
            </p>
            <div className="text-sm">{renderValue(v)}</div>
          </div>
        ))}
      </div>
    );
  }
  return <span>{String(value)}</span>;
}

function ObjectGrid({ data }: { data: Record<string, unknown> | undefined | null }) {
  if (!data || typeof data !== "object") {
    return <p className="text-sm text-muted-foreground">No data available.</p>;
  }
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No data available.</p>;
  }

  // If all values are simple (string/number), render as a compact grid
  const allSimple = entries.every(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean");
  if (allSimple) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {entries.map(([k, v]) => (
          <div key={k} className="bg-muted/20 rounded-lg p-3 border border-border/20 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
              {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
            </p>
            <p className="text-lg font-bold">{String(v)}</p>
          </div>
        ))}
      </div>
    );
  }

  // Mixed / nested: render as stacked cards
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      {entries.map(([k, v]) => (
        <div key={k} className="bg-muted/20 rounded-lg p-4 border border-border/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
            {k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim()}
          </p>
          <div className="text-sm">{renderValue(v)}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [reports, setReports] = useState<ExecutiveReport[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!db) {
      setLoading(false);
      return;
    }

    const q = query(
      collection(db, COLLECTIONS.EXECUTIVE_REPORTS),
      orderBy("weekEnding", "desc"),
      fbLimit(20)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const docs: ExecutiveReport[] = snapshot.docs.map((d) => {
          const data = d.data();
          const generatedAt = data.generatedAt?.toDate?.()?.toISOString?.() || data.generatedAt || "";
          return { id: d.id, ...data, generatedAt } as ExecutiveReport;
        });
        setReports(docs);
        setCurrentIndex(0);
        setLoading(false);
      },
      () => setLoading(false)
    );

    return () => unsubscribe();
  }, []);

  const report = reports[currentIndex] ?? null;
  const rpt = report?.report;

  // ── Loading state ──
  if (loading) {
    return (
      <div className="flex-1 space-y-6 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-72" />
          <div className="h-4 bg-muted rounded w-48" />
          <div className="h-32 bg-muted rounded" />
          <div className="grid grid-cols-2 gap-4">
            <div className="h-24 bg-muted rounded" />
            <div className="h-24 bg-muted rounded" />
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state ──
  if (reports.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <Card className="w-full max-w-lg text-center bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <div className="mx-auto bg-primary/10 p-3 rounded-full">
              <FileText className="h-8 w-8 text-primary" />
            </div>
          </CardHeader>
          <CardContent>
            <CardTitle className="text-2xl font-headline">Executive Reports</CardTitle>
            <p className="text-muted-foreground mt-2">
              No executive reports have been generated yet. ATHENA will publish weekly intelligence briefings here.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const canGoNewer = currentIndex > 0;
  const canGoOlder = currentIndex < reports.length - 1;
  const genTime = report?.generatedAt
    ? new Date(report.generatedAt).toLocaleString("en-AU", {
        weekday: "short", day: "numeric", month: "short",
        hour: "numeric", minute: "2-digit",
      })
    : "";

  return (
    <div className="flex-1 space-y-6 p-6">
      {/* ── Header ── */}
      <div>
        <h1 className="text-2xl font-headline font-bold">Executive Reports</h1>
        <p className="text-sm text-muted-foreground">ATHENA Intelligence Briefings</p>
      </div>

      {/* ── Date navigation ── */}
      <div className="flex items-center justify-between bg-card/60 backdrop-blur border border-border/40 rounded-xl px-5 py-3">
        <div>
          <p className="text-sm font-semibold">
            Week ending: {formatWeekEnding(report?.weekEnding || "")}
          </p>
          {genTime && (
            <p className="text-xs text-muted-foreground">Generated {genTime}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            disabled={!canGoNewer}
            onClick={() => setCurrentIndex((i) => i - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-muted-foreground min-w-[4rem] text-center">
            {currentIndex + 1} / {reports.length}
          </span>
          <Button
            variant="ghost" size="icon" className="h-8 w-8"
            disabled={!canGoOlder}
            onClick={() => setCurrentIndex((i) => i + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* ── Report sections ── */}
      <div className="space-y-3">
        {/* Executive Summary */}
        <Section title="Executive Summary" icon={FileText} defaultOpen>
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-4">
            <p className="text-sm leading-relaxed whitespace-pre-line">
              {rpt?.executiveSummary || "No summary available."}
            </p>
          </div>
        </Section>

        {/* KPIs — handles both array [{label,value}] and object {key:value} formats */}
        {rpt?.kpis && (Array.isArray(rpt.kpis) ? rpt.kpis.length > 0 : Object.keys(rpt.kpis).length > 0) && (
          <Section title="Key Performance Indicators" icon={BarChart3} badge={Array.isArray(rpt.kpis) ? rpt.kpis.length : Object.keys(rpt.kpis).length}>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {(Array.isArray(rpt.kpis)
                ? rpt.kpis.map((kpi: ExecutiveReportKpi, i: number) => ({ key: i, label: kpi.label, value: kpi.value, trend: kpi.trend, target: kpi.target }))
                : Object.entries(rpt.kpis as Record<string, unknown>).map(([k, v], i) => ({ key: i, label: k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").trim(), value: v, trend: undefined, target: undefined }))
              ).map((kpi) => {
                const trend = kpi.trend ? TREND_ICON[kpi.trend] : null;
                const displayValue = typeof kpi.value === "number" && kpi.value > 10000
                  ? kpi.value.toLocaleString("en-AU")
                  : typeof kpi.value === "number"
                    ? String(kpi.value)
                    : String(kpi.value ?? "—");
                return (
                  <div
                    key={kpi.key}
                    className="bg-muted/20 rounded-lg p-3 border border-border/20 text-center"
                  >
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">
                      {kpi.label}
                    </p>
                    <div className="flex items-center justify-center gap-1.5">
                      <p className="text-xl font-bold">{displayValue}</p>
                      {trend && (
                        <span className={cn("text-sm", trend.color)}>{trend.symbol}</span>
                      )}
                    </div>
                    {kpi.target != null && (
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Target: {kpi.target}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Operations */}
        {rpt?.operations && Object.keys(rpt.operations).length > 0 && (
          <Section title="Operations" icon={Target} badge={Object.keys(rpt.operations).length}>
            <ObjectGrid data={rpt.operations} />
          </Section>
        )}

        {/* Sales Pipeline */}
        {rpt?.salesPipeline && Object.keys(rpt.salesPipeline).length > 0 && (
          <Section title="Sales Pipeline" icon={TrendingUp} badge={Object.keys(rpt.salesPipeline).length}>
            <ObjectGrid data={rpt.salesPipeline} />
          </Section>
        )}

        {/* Intelligence */}
        {rpt?.intelligence && Object.keys(rpt.intelligence).length > 0 && (
          <Section title="Intelligence" icon={Shield} badge={Object.keys(rpt.intelligence).length}>
            <ObjectGrid data={rpt.intelligence} />
          </Section>
        )}

        {/* Risks — handles both string[] and {title,severity,description}[] */}
        {rpt?.risks && rpt.risks.length > 0 && (
          <Section title="Risks" icon={AlertTriangle} badge={rpt.risks.length}>
            <div className="space-y-3">
              {rpt.risks.map((risk, i) => {
                if (typeof risk === "string") {
                  return (
                    <div key={i} className="bg-muted/20 rounded-lg p-4 border border-border/20">
                      <p className="text-sm">{risk}</p>
                    </div>
                  );
                }
                const r = risk as { title?: string; severity?: string; description?: string; mitigation?: string };
                const sev = r.severity?.toLowerCase() || "medium";
                const styles = SEVERITY_STYLES[sev] || SEVERITY_STYLES.medium;
                return (
                  <div key={i} className="bg-muted/20 rounded-lg p-4 border border-border/20">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="text-sm font-semibold">{r.title || "Risk"}</h4>
                      <Badge variant="outline" className={cn("text-[10px] capitalize flex-shrink-0", styles)}>
                        {r.severity || "risk"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.description}</p>
                    {r.mitigation && (
                      <p className="text-xs text-muted-foreground mt-2">
                        <span className="font-semibold text-foreground">Mitigation:</span> {r.mitigation}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Recommendations — handles both string[] and {title,priority,description}[] */}
        {rpt?.recommendations && rpt.recommendations.length > 0 && (
          <Section title="Recommendations" icon={Lightbulb} badge={rpt.recommendations.length}>
            <div className="space-y-3">
              {rpt.recommendations.map((rec, i) => {
                if (typeof rec === "string") {
                  return (
                    <div key={i} className="flex items-start gap-3 bg-muted/20 rounded-lg p-4 border border-border/20">
                      <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                        {i + 1}
                      </span>
                      <p className="text-sm">{rec}</p>
                    </div>
                  );
                }
                const r = rec as { title?: string; priority?: string; description?: string; owner?: string };
                const pri = r.priority?.toLowerCase() || "medium";
                const styles = PRIORITY_STYLES[pri] || PRIORITY_STYLES.medium;
                return (
                  <div key={i} className="bg-muted/20 rounded-lg p-4 border border-border/20">
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <h4 className="text-sm font-semibold">{r.title}</h4>
                      <Badge variant="outline" className={cn("text-[10px] capitalize flex-shrink-0", styles)}>
                        {r.priority}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">{r.description}</p>
                    {r.owner && (
                      <p className="text-xs text-muted-foreground mt-2">
                        <span className="font-semibold text-foreground">Owner:</span> {r.owner}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          </Section>
        )}

        {/* Next Week Priorities — handles both string[] and {title,description}[] */}
        {rpt?.nextWeekPriorities && rpt.nextWeekPriorities.length > 0 && (
          <Section title="Next Week Priorities" icon={Target} badge={rpt.nextWeekPriorities.length}>
            <div className="space-y-2">
              {rpt.nextWeekPriorities.map((item, i) => {
                const isString = typeof item === "string";
                return (
                  <div key={i} className="flex items-start gap-3 py-1.5">
                    <span className="text-xs font-bold text-primary bg-primary/10 rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0">
                      {i + 1}
                    </span>
                    <div>
                      <p className="text-sm font-semibold">{isString ? item : (item as { title: string }).title}</p>
                      {!isString && (item as { description?: string }).description && (
                        <p className="text-sm text-muted-foreground mt-0.5">{(item as { description: string }).description}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        )}
      </div>
    </div>
  );
}
