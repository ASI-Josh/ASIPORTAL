"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  FlaskConical, Bus, Wrench, Leaf, ExternalLink, BarChart3,
  Target, Radar, ChevronLeft, AlertTriangle, TrendingUp, CheckCircle2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { OSINTScan, OSINTFinding, OSINTPillar, FindingTag, FindingRelevance, OpportunityUrgency } from "@/lib/types-osint";

// ─── Config ───────────────────────────────────────────────────────────────────

const PILLAR_CONFIG = {
  "glass-coating":    { icon: FlaskConical, color: "text-blue-400",    bg: "bg-blue-500/10",    label: "Glass & Coating" },
  "bus-coach":        { icon: Bus,          color: "text-purple-400",  bg: "bg-purple-500/10",  label: "Bus & Coach" },
  "fleet-maintenance":{ icon: Wrench,       color: "text-amber-400",   bg: "bg-amber-500/10",   label: "Fleet Maintenance" },
  "sustainability":   { icon: Leaf,         color: "text-emerald-400", bg: "bg-emerald-500/10", label: "Sustainability" },
} as const;

const TAG_STYLES: Record<FindingTag, string> = {
  "direct-relevance": "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  "pivot-opportunity": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "high-urgency": "bg-red-500/15 text-red-400 border-red-500/30",
};

const TAG_LABELS: Record<FindingTag, string> = {
  "direct-relevance": "Direct Relevance",
  "pivot-opportunity": "Pivot Opportunity",
  "high-urgency": "High Urgency",
};

const RELEVANCE_STYLES: Record<FindingRelevance, string> = {
  5: "bg-emerald-500/20 text-emerald-400",
  4: "bg-blue-500/20 text-blue-400",
  3: "bg-amber-500/20 text-amber-400",
  2: "bg-muted text-muted-foreground",
  1: "bg-muted/50 text-muted-foreground",
};

const URGENCY_STYLES: Record<OpportunityUrgency, string> = {
  immediate: "bg-red-500/15 text-red-400",
  "near-term": "bg-amber-500/15 text-amber-400",
  watch: "bg-muted text-muted-foreground",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(dateStr: string) {
  if (!dateStr) return "";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-AU", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterButton({
  active, onClick, children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-card text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function FindingCard({ finding }: { finding: OSINTFinding }) {
  return (
    <div className="bg-card/60 border border-border/50 rounded-xl p-4 hover:border-primary/40 transition-all group flex flex-col gap-2">
      <div className="flex justify-between items-start gap-3">
        <a
          href={finding.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-foreground leading-snug group-hover:text-primary transition-colors flex-1"
        >
          {finding.headline}
          <ExternalLink className="w-3 h-3 inline ml-1.5 opacity-0 group-hover:opacity-60 transition-opacity" />
        </a>
        <span className={`flex-shrink-0 w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold ${RELEVANCE_STYLES[finding.relevance]}`}>
          {finding.relevance}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{finding.source} · {finding.date}</p>
      <p className="text-sm text-muted-foreground leading-relaxed flex-1">{finding.summary}</p>
      {finding.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap pt-1">
          {finding.tags.map((tag) => (
            <span key={tag} className={`px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${TAG_STYLES[tag]}`}>
              {TAG_LABELS[tag]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function PillarSection({ pillar }: { pillar: OSINTPillar }) {
  const config = PILLAR_CONFIG[pillar.id];
  const Icon = config.icon;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 pb-3 border-b border-border/50">
        <div className={`w-9 h-9 rounded-lg ${config.bg} flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <div>
          <h2 className="text-base font-semibold text-foreground">{pillar.name}</h2>
        </div>
        <Badge variant="outline" className="ml-auto">{pillar.findings.length} findings</Badge>
      </div>
      {pillar.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">No findings match the current filter.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {pillar.findings.map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OSINTPage() {
  const { firebaseUser } = useAuth();
  const { toast } = useToast();
  const [scan, setScan] = useState<OSINTScan | null>(null);
  const [importing, setImporting] = useState(false);
  const [importedCount, setImportedCount] = useState<number | null>(null);
  const [availableDates, setAvailableDates] = useState<{ date: string; totalFindings: number; highRelevanceCount: number }[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [activePillar, setActivePillar] = useState("all");
  const [minRelevance, setMinRelevance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const getToken = async (): Promise<string> => {
    if (!firebaseUser) throw new Error("Not signed in");
    return firebaseUser.getIdToken();
  };

  useEffect(() => {
    if (!firebaseUser) return;
    getToken().then((token) =>
      fetch("/api/osint", { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => {
          setAvailableDates(data.scans || []);
          if (data.scans?.length) setSelectedDate(data.scans[0].date);
        })
        .catch(() => setError("Failed to load scans."))
    ).catch(() => setError("Failed to load scans."));
  }, [firebaseUser]);

  useEffect(() => {
    if (!selectedDate || !firebaseUser) return;
    setLoading(true);
    setError("");
    getToken().then((token) =>
      fetch(`/api/osint/${selectedDate}`, { headers: { Authorization: `Bearer ${token}` } })
        .then((r) => r.json())
        .then((data) => { setScan(data); setLoading(false); })
        .catch(() => { setError("Failed to load scan data."); setLoading(false); })
    ).catch(() => { setError("Auth error."); setLoading(false); });
  }, [selectedDate, firebaseUser]);

  const handleImportToPipeline = async () => {
    if (!scan || !firebaseUser) return;
    setImporting(true);
    try {
      const token = await getToken();
      // Build import payload from opportunity matrix
      const leads = scan.opportunityMatrix.map((opp) => ({
        company: opp.name.split("—")[0].trim(),
        sector: opp.pillar.toLowerCase().includes("bus") || opp.pillar.toLowerCase().includes("transit") ? "mass-transit"
          : opp.pillar.toLowerCase().includes("glass") ? "manufacturing"
          : opp.pillar.toLowerCase().includes("sustain") ? "mass-transit"
          : opp.pillar.toLowerCase().includes("fleet") ? "wholesale-trade"
          : "other",
        pipeline_stage: 1,
        bant_score: opp.relevanceScore * 16,
        source: { osint_scan_date: scan.date, finding: opp.name, pillar: opp.pillar, relevance_score: opp.relevanceScore },
        next_action: opp.action,
        follow_up_date: new Date(Date.now() + 86400000).toISOString().split("T")[0],
        recommended_sequence: "A" as const,
        notes: `From OSINT scan ${scan.date}. Opportunity Matrix rank #${opp.rank}. Urgency: ${opp.urgency}. Suggested action: ${opp.action}`,
        tags: ["osint", opp.urgency === "immediate" ? "urgent" : opp.urgency],
        market_mode: "growth" as const,
      }));
      const res = await fetch("/api/leads/import", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ osintScanDate: scan.date, leads }),
      });
      const data = await res.json();
      setImportedCount(data.created + data.updated);
      toast({ title: `Imported to pipeline`, description: `${data.created} created, ${data.updated} updated, ${data.skipped} skipped` });
    } catch {
      toast({ title: "Import failed", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const filteredPillars = scan?.pillars
    .filter((p) => activePillar === "all" || p.id === activePillar)
    .map((p) => ({
      ...p,
      findings: p.findings.filter((f) => f.relevance >= minRelevance),
    })) || [];

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard"><ChevronLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <Radar className="h-5 w-5 text-primary" />
              <h1 className="text-xl font-bold">
                <span className="text-primary">ASI</span> OSINT
              </h1>
              <Badge variant="outline" className="text-xs">Intel</Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">
              Innovation &amp; Industry Pivot Spy
              {scan?.date && ` — ${formatDate(scan.date)}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap justify-end">
          {availableDates.length > 0 && (
            <Select value={selectedDate} onValueChange={setSelectedDate}>
              <SelectTrigger className="w-44 bg-card/50 border-border/30">
                <SelectValue placeholder="Select date" />
              </SelectTrigger>
              <SelectContent>
                {availableDates.map((s) => (
                  <SelectItem key={s.date} value={s.date}>{s.date}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {scan && (
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">{scan.metadata.totalFindings} findings</Badge>
              <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">
                {scan.metadata.highRelevanceCount} high relevance
              </Badge>
              {scan.metadata.urgentCount > 0 && (
                <Badge className="bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/15">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  {scan.metadata.urgentCount} urgent
                </Badge>
              )}
              {importedCount !== null ? (
                <Badge className="bg-green-500/15 text-green-400 border-green-500/30 hover:bg-green-500/15">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  {importedCount} in pipeline
                </Badge>
              ) : (
                <Button size="sm" variant="outline" onClick={handleImportToPipeline} disabled={importing}>
                  <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                  {importing ? "Importing…" : "Import to Pipeline"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {error && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="pt-4 text-sm text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && !error && (
        <div className="space-y-4 animate-pulse">
          <div className="h-32 rounded-xl bg-card/50" />
          <div className="grid grid-cols-3 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-48 rounded-xl bg-card/50" />
            ))}
          </div>
        </div>
      )}

      {!loading && scan && (
        <>
          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">Pillar:</span>
            <FilterButton active={activePillar === "all"} onClick={() => setActivePillar("all")}>All</FilterButton>
            {Object.entries(PILLAR_CONFIG).map(([id, cfg]) => {
              const Icon = cfg.icon;
              return (
                <FilterButton key={id} active={activePillar === id} onClick={() => setActivePillar(id)}>
                  <Icon className="w-3.5 h-3.5 mr-1.5" />
                  {cfg.label}
                </FilterButton>
              );
            })}
            <div className="w-px h-6 bg-border mx-2" />
            <span className="text-xs uppercase tracking-wider text-muted-foreground mr-1">Min score:</span>
            {[0, 3, 4, 5].map((n) => (
              <FilterButton key={n} active={minRelevance === n} onClick={() => setMinRelevance(n)}>
                {n === 0 ? "All" : `${n}+`}
              </FilterButton>
            ))}
          </div>

          {/* Executive Summary */}
          <Card className="bg-primary/5 border-primary/20 backdrop-blur-lg">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm font-semibold text-primary">
                <BarChart3 className="w-4 h-4" /> Executive Summary
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {scan.executiveSummary.map((item, i) => (
                  <li key={i} className="text-sm text-muted-foreground flex gap-2">
                    <span className="text-primary mt-0.5 flex-shrink-0">▸</span>
                    {item}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {/* Pillar Sections */}
          <div className="space-y-8">
            {filteredPillars.map((pillar) => (
              <PillarSection key={pillar.id} pillar={pillar} />
            ))}
          </div>

          {/* Opportunity Matrix */}
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Target className="w-5 h-5 text-primary" />
                Opportunity Matrix — Top 10
              </CardTitle>
              <CardDescription>Ranked by relevance and strategic fit for ASI.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 bg-muted/30">
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">#</th>
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">Opportunity</th>
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">Pillar</th>
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">Score</th>
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">Potential ASI Action</th>
                      <th className="text-left text-xs uppercase tracking-wider text-muted-foreground font-semibold px-4 py-3">Urgency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scan.opportunityMatrix.map((opp) => (
                      <tr key={opp.rank} className="border-b border-border/30 hover:bg-muted/20 transition-colors">
                        <td className="px-4 py-3 text-muted-foreground font-medium">{opp.rank}</td>
                        <td className="px-4 py-3 font-medium text-foreground">{opp.name}</td>
                        <td className="px-4 py-3 text-muted-foreground">{opp.pillar}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-md text-xs font-bold ${RELEVANCE_STYLES[opp.relevanceScore as FindingRelevance] || ""}`}>
                            {opp.relevanceScore}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{opp.action}</td>
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 rounded text-xs font-semibold capitalize ${URGENCY_STYLES[opp.urgency]}`}>
                            {opp.urgency}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
