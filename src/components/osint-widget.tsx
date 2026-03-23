"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar, ArrowRight, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import type { OSINTScanMeta } from "@/lib/types-osint";

export function OSINTWidget() {
  const [latest, setLatest] = useState<OSINTScanMeta | null>(null);

  useEffect(() => {
    fetch("/api/osint")
      .then((r) => r.json())
      .then((data) => {
        if (data.scans?.length) setLatest(data.scans[0]);
      })
      .catch(() => {});
  }, []);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 hover:border-primary/30 transition-all group">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Radar className="h-4 w-4 text-primary" />
          ASI OSINT
          <span className="ml-auto">
            <Link
              href="/dashboard/osint"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors font-normal"
            >
              View intel
              <ArrowRight className="h-3 w-3 group-hover:translate-x-0.5 transition-transform" />
            </Link>
          </span>
        </CardTitle>
        <CardDescription>Innovation &amp; Industry Pivot Spy</CardDescription>
      </CardHeader>
      <CardContent>
        {!latest ? (
          <p className="text-sm text-muted-foreground">No scans available.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-2xl font-bold text-foreground">{latest.totalFindings}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Findings</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-400">{latest.highRelevanceCount}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">High Rel.</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-400">{latest.urgentCount}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">Urgent</p>
              </div>
            </div>
            {latest.topOpportunity && (
              <div className="flex items-start gap-2 rounded-lg bg-primary/5 border border-primary/15 px-3 py-2">
                <TrendingUp className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-snug">
                  <span className="text-foreground font-medium">Top opportunity: </span>
                  {latest.topOpportunity}
                </p>
              </div>
            )}
            {latest.urgentCount > 0 && (
              <div className="flex items-center gap-2 text-xs text-red-400">
                <AlertTriangle className="h-3 w-3" />
                {latest.urgentCount} urgent finding{latest.urgentCount !== 1 ? "s" : ""} require attention
              </div>
            )}
            <p className="text-xs text-muted-foreground text-right">
              Last scan: {new Date(latest.date + "T00:00:00").toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
