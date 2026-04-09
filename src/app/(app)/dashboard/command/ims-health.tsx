"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query } from "firebase/firestore";
import {
  ShieldCheck, FileText, AlertTriangle, Clock, TrendingUp,
  ExternalLink, ClipboardCheck, CircleDot,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

interface ImsHealth {
  documents: {
    active: number;
    draft: number;
    underReview: number;
    approved: number;
    obsolete: number;
    overdueReview: number;
    total: number;
  };
  audits: { planned: number; inProgress: number; completedYTD: number; total: number };
  capas: { open: number; overdue: number; closedYTD: number; effectivenessPending: number; total: number };
  incidents: { openThisMonth: number; closedThisMonth: number; openCritical: number; total: number };
  risks: { open: number; high: number; critical: number; total: number };
  complianceScore: number;
  isoClausesCovered: number;
  isoClausesTotal: number;
}

export function ImsHealth() {
  const [health, setHealth] = useState<ImsHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Subscribe to all IMS collections; recompute health client-side for real-time updates
    const unsubs: Array<() => void> = [];
    const state: Record<string, Array<Record<string, unknown>>> = {
      docs: [], audits: [], capas: [], incidents: [], risks: [],
    };

    const recompute = () => {
      const today = new Date().toISOString().split("T")[0];
      const yearStart = `${new Date().getFullYear()}-01-01`;
      const monthStart = new Date().toISOString().slice(0, 7) + "-01";

      const documents = {
        active: state.docs.filter((d) => (d.approvalStatus || d.status) === "active").length,
        draft: state.docs.filter((d) => (d.approvalStatus || d.status) === "draft").length,
        underReview: state.docs.filter((d) => (d.approvalStatus || d.status) === "under_review").length,
        approved: state.docs.filter((d) => (d.approvalStatus || d.status) === "approved").length,
        obsolete: state.docs.filter((d) => (d.approvalStatus || d.status) === "obsolete").length,
        overdueReview: state.docs.filter((d) =>
          (d.approvalStatus || d.status) === "active" &&
          typeof d.reviewDueDate === "string" && d.reviewDueDate < today
        ).length,
        total: state.docs.length,
      };

      const audits = {
        planned: state.audits.filter((a) => a.status === "planned").length,
        inProgress: state.audits.filter((a) => a.status === "in_progress").length,
        completedYTD: state.audits.filter((a) => a.status === "completed" && typeof a.completedAt === "string" && (a.completedAt as string) >= yearStart).length,
        total: state.audits.length,
      };

      const capas = {
        open: state.capas.filter((c) => c.status === "open" || c.status === "in_progress").length,
        overdue: state.capas.filter((c) =>
          (c.status === "open" || c.status === "in_progress") &&
          typeof c.dueDate === "string" && (c.dueDate as string) < today
        ).length,
        closedYTD: state.capas.filter((c) => c.status === "closed" && typeof c.closedAt === "string" && (c.closedAt as string) >= yearStart).length,
        effectivenessPending: state.capas.filter((c) => c.status === "closed" && !c.effectivenessVerified).length,
        total: state.capas.length,
      };

      const incidents = {
        openThisMonth: state.incidents.filter((i) => i.status === "open" && typeof i.createdAt === "string" && (i.createdAt as string) >= monthStart).length,
        closedThisMonth: state.incidents.filter((i) => i.status === "closed" && typeof i.closedAt === "string" && (i.closedAt as string) >= monthStart).length,
        openCritical: state.incidents.filter((i) => i.status === "open" && i.severity === "critical").length,
        total: state.incidents.length,
      };

      const risks = {
        open: state.risks.filter((r) => r.status === "open" || r.status === "monitoring").length,
        high: state.risks.filter((r) => r.riskLevel === "high").length,
        critical: state.risks.filter((r) => r.riskLevel === "critical").length,
        total: state.risks.length,
      };

      const TOTAL_ISO_CLAUSES = 40;
      const coveredClauses = new Set<string>();
      state.docs.forEach((d) => {
        if ((d.approvalStatus || d.status) === "active" && Array.isArray(d.isoClauses)) {
          (d.isoClauses as string[]).forEach((c) => coveredClauses.add(c));
        }
      });
      const complianceScore = Math.min(100, Math.round((coveredClauses.size / TOTAL_ISO_CLAUSES) * 100));

      setHealth({
        documents, audits, capas, incidents, risks, complianceScore,
        isoClausesCovered: coveredClauses.size, isoClausesTotal: TOTAL_ISO_CLAUSES,
      });
      setLoading(false);
    };

    const subscribe = (key: string, collName: string) => {
      const unsub = onSnapshot(query(collection(db, collName)), (snap) => {
        state[key] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        recompute();
      }, () => setLoading(false));
      unsubs.push(unsub);
    };

    subscribe("docs", COLLECTIONS.IMS_DOCUMENTS);
    subscribe("audits", COLLECTIONS.IMS_AUDITS);
    subscribe("capas", COLLECTIONS.IMS_CORRECTIVE_ACTIONS);
    subscribe("incidents", COLLECTIONS.IMS_INCIDENTS);
    subscribe("risks", COLLECTIONS.IMS_RISK_REGISTER);

    return () => unsubs.forEach((u) => u());
  }, []);

  if (loading || !health) {
    return (
      <Card className="bg-card/50 border-border/40">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-violet-400" /> IMS Health
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">Loading…</div>
        </CardContent>
      </Card>
    );
  }

  const complianceColor = health.complianceScore >= 80 ? "text-green-400"
    : health.complianceScore >= 50 ? "text-amber-400" : "text-red-400";

  return (
    <Card className="bg-card/50 border-border/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-violet-400" />
          IMS Health
          <Badge variant="outline" className={`ml-auto text-[10px] ${complianceColor}`}>
            {health.complianceScore}% compliant
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Documents */}
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span className="flex items-center gap-1"><FileText className="h-3 w-3" /> Documents</span>
            <span className="font-mono">{health.documents.total}</span>
          </div>
          <div className="flex gap-1 flex-wrap">
            {health.documents.active > 0 && <Badge className="bg-green-500/15 text-green-400 border-0 text-[10px]">Active: {health.documents.active}</Badge>}
            {health.documents.draft > 0 && <Badge className="bg-zinc-500/15 text-zinc-400 border-0 text-[10px]">Draft: {health.documents.draft}</Badge>}
            {health.documents.underReview > 0 && <Badge className="bg-blue-500/15 text-blue-400 border-0 text-[10px]">Review: {health.documents.underReview}</Badge>}
            {health.documents.approved > 0 && <Badge className="bg-violet-500/15 text-violet-400 border-0 text-[10px]">Approved: {health.documents.approved}</Badge>}
            {health.documents.overdueReview > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">
                <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Overdue: {health.documents.overdueReview}
              </Badge>
            )}
          </div>
        </div>

        {/* CAPAs */}
        <div className="flex items-center justify-between text-xs border-t border-border/30 pt-2">
          <span className="flex items-center gap-1 text-muted-foreground">
            <ClipboardCheck className="h-3 w-3" /> CAPAs
          </span>
          <div className="flex items-center gap-2">
            <span>Open: <strong>{health.capas.open}</strong></span>
            {health.capas.overdue > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">
                {health.capas.overdue} overdue
              </Badge>
            )}
          </div>
        </div>

        {/* Incidents */}
        <div className="flex items-center justify-between text-xs border-t border-border/30 pt-2">
          <span className="flex items-center gap-1 text-muted-foreground">
            <CircleDot className="h-3 w-3" /> Incidents (month)
          </span>
          <div className="flex items-center gap-2">
            <span>Open: <strong>{health.incidents.openThisMonth}</strong></span>
            {health.incidents.openCritical > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">
                {health.incidents.openCritical} critical
              </Badge>
            )}
          </div>
        </div>

        {/* Audits */}
        <div className="flex items-center justify-between text-xs border-t border-border/30 pt-2">
          <span className="flex items-center gap-1 text-muted-foreground">
            <ShieldCheck className="h-3 w-3" /> Audits
          </span>
          <div className="flex items-center gap-2">
            <span>Planned: <strong>{health.audits.planned}</strong></span>
            <span>YTD: <strong>{health.audits.completedYTD}</strong></span>
          </div>
        </div>

        {/* Risks */}
        <div className="flex items-center justify-between text-xs border-t border-border/30 pt-2">
          <span className="flex items-center gap-1 text-muted-foreground">
            <TrendingUp className="h-3 w-3" /> Risks
          </span>
          <div className="flex items-center gap-2">
            <span>Open: <strong>{health.risks.open}</strong></span>
            {health.risks.critical > 0 && (
              <Badge className="bg-red-500/20 text-red-400 border-0 text-[10px]">
                {health.risks.critical} crit
              </Badge>
            )}
            {health.risks.high > 0 && (
              <Badge className="bg-amber-500/20 text-amber-400 border-0 text-[10px]">
                {health.risks.high} high
              </Badge>
            )}
          </div>
        </div>

        {/* ISO coverage */}
        <div className="pt-2 border-t border-border/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
            <span>ISO clause coverage</span>
            <span className="font-mono">{health.isoClausesCovered}/{health.isoClausesTotal}</span>
          </div>
          <div className="h-1.5 rounded-full bg-border/40 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${
                health.complianceScore >= 80 ? "bg-green-500" : health.complianceScore >= 50 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${health.complianceScore}%` }}
            />
          </div>
        </div>

        <Link href="/dashboard/ims" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 pt-1">
          View IMS hub <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
