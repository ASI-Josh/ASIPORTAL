"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { TrendingUp, Flame, AlertTriangle, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

interface PipelineStats {
  totalActive: number;
  hotLeads: number;
  overdueFollowUps: number;
  totalEstimatedValue: number;
}

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export function SalesPipelineWidget() {
  const [stats, setStats] = useState<PipelineStats | null>(null);

  useEffect(() => {
    fetch("/api/leads/stats")
      .then((r) => r.json())
      .then((data) => setStats(data))
      .catch(() => {});
  }, []);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 hover:border-primary/30 transition-all group">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="h-4 w-4 text-primary" />
          Sales Pipeline
          <span className="ml-auto">
            <Link
              href="/dashboard/crm"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors font-normal"
            >
              View pipeline
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </span>
        </CardTitle>
        <CardDescription>Lead pipeline &amp; outreach tracking</CardDescription>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-foreground">{stats.totalActive}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Active Leads</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-400">{stats.hotLeads}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Hot (A/B)</p>
              </div>
              <div>
                <p className={`text-2xl font-bold ${stats.overdueFollowUps > 0 ? "text-red-400" : "text-foreground"}`}>
                  {stats.overdueFollowUps}
                </p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Overdue</p>
              </div>
            </div>
            {stats.totalEstimatedValue > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
                <TrendingUp className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground font-semibold">{formatCurrency(stats.totalEstimatedValue)}</span>
                  {" "}estimated pipeline value
                </p>
              </div>
            )}
            {stats.overdueFollowUps > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {stats.overdueFollowUps} follow-up{stats.overdueFollowUps !== 1 ? "s" : ""} overdue
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
