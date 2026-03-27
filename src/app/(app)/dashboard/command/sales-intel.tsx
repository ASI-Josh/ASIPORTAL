"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DollarSign, TrendingUp, AlertTriangle, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebaseClient";

interface PipelineStats {
  totalLeads: number;
  hotLeads: number;
  overdueFollowUps: number;
  estimatedValue: number;
  byStage: Record<string, number>;
}

interface TopClient {
  name: string;
  revenue: number;
}

interface InactiveClient {
  name: string;
  daysInactive: number;
}

interface Props {
  topClients: TopClient[];
  inactiveClients: InactiveClient[];
}

export function SalesIntel({ topClients, inactiveClients }: Props) {
  const [stats, setStats] = useState<PipelineStats | null>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch("/api/leads/stats", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        setStats(data);
      } catch {
        // silent
      }
    };
    fetchStats();
  }, []);

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(v);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 h-full overflow-hidden">
      <div className="px-6 py-3 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-emerald-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="font-headline font-semibold text-sm text-emerald-400">
              Sales &amp; CRM Intelligence
            </span>
          </div>
          <Link href="/dashboard/crm">
            <Button variant="ghost" size="sm" className="text-xs">
              Open CRM
            </Button>
          </Link>
        </div>
      </div>
      <CardContent className="space-y-4">
        {/* Pipeline KPIs */}
        {stats && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border/40 bg-background/60 p-3">
              <div className="text-xs text-muted-foreground mb-1">Active Leads</div>
              <div className="text-lg font-bold">{stats.totalLeads}</div>
            </div>
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-xs text-emerald-400 mb-1">Hot Leads (A/B)</div>
              <div className="text-lg font-bold text-emerald-400">{stats.hotLeads}</div>
            </div>
          </div>
        )}

        {stats && stats.overdueFollowUps > 0 && (
          <div className="flex items-center justify-between text-sm rounded-lg border border-red-500/20 bg-red-500/5 p-3">
            <span className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-3.5 w-3.5" />
              Overdue Follow-ups
            </span>
            <Badge className="bg-red-500/20 text-red-400">{stats.overdueFollowUps}</Badge>
          </div>
        )}

        {stats && stats.estimatedValue > 0 && (
          <div className="flex items-center justify-between text-sm">
            <span className="flex items-center gap-1 text-muted-foreground">
              <DollarSign className="h-3 w-3" /> Pipeline Value
            </span>
            <span className="font-bold">{formatCurrency(stats.estimatedValue)}</span>
          </div>
        )}

        {/* Top Clients */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Top Clients by Revenue
          </p>
          {topClients.length === 0 ? (
            <p className="text-xs text-muted-foreground">No revenue data yet.</p>
          ) : (
            topClients.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="truncate">{c.name}</span>
                <span className="font-medium ml-2">{formatCurrency(c.revenue)}</span>
              </div>
            ))
          )}
        </div>

        {/* Inactive Watch */}
        {inactiveClients.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-amber-400">
              Inactive 4+ Weeks
            </p>
            {inactiveClients.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="truncate">{c.name}</span>
                <span className="text-muted-foreground ml-2">{c.daysInactive}d</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
