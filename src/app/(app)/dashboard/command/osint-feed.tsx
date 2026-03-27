"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar, ExternalLink, AlertTriangle, TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebaseClient";

interface OSINTFinding {
  id?: string;
  title: string;
  summary?: string;
  source?: string;
  url?: string;
  relevance?: string;
  pillar?: string;
  tags?: string[];
  urgency?: string;
}

interface OSINTScan {
  date?: string;
  executiveSummary?: string;
  findings?: OSINTFinding[];
  totalFindings?: number;
}

export function OSINTFeed() {
  const [scan, setScan] = useState<OSINTScan | null>(null);

  useEffect(() => {
    const fetchScan = async () => {
      try {
        const token = await auth.currentUser?.getIdToken();
        if (!token) return;
        const res = await fetch("/api/osint", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        const data = await res.json();
        // Take the most recent scan
        const scans = data.scans || [];
        if (scans.length > 0) setScan(scans[0]);
      } catch {
        // silent
      }
    };
    fetchScan();
  }, []);

  const findings = scan?.findings || [];
  const highRelevance = findings.filter((f) => f.relevance === "high" || f.urgency === "urgent");
  const topFindings = findings.slice(0, 5);

  const relevanceBadge = (f: OSINTFinding) => {
    if (f.urgency === "urgent") return "bg-red-500/20 text-red-400 border-red-500/30";
    if (f.relevance === "high") return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-muted text-muted-foreground";
  };

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 h-full">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4 text-cyan-400" />
            OSINT Intelligence Feed
          </CardTitle>
          <Link href="/dashboard/osint">
            <Button variant="ghost" size="sm" className="text-xs">
              Full Intel
            </Button>
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Summary stats */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-border/40 bg-background/60 p-3">
            <div className="text-xs text-muted-foreground mb-1">Total Findings</div>
            <div className="text-lg font-bold">{findings.length}</div>
          </div>
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
            <div className="text-xs text-amber-400 mb-1">High Priority</div>
            <div className="text-lg font-bold text-amber-400">{highRelevance.length}</div>
          </div>
        </div>

        {scan?.executiveSummary && (
          <p className="text-xs text-muted-foreground leading-relaxed line-clamp-3">
            {scan.executiveSummary}
          </p>
        )}

        {/* Top findings */}
        {topFindings.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Latest Findings
            </p>
            {topFindings.map((f, i) => (
              <div key={f.id || i} className="rounded-lg border border-border/40 bg-background/60 p-2.5 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium leading-tight line-clamp-2">{f.title}</span>
                  <Badge className={`shrink-0 text-xs ${relevanceBadge(f)}`}>
                    {f.urgency === "urgent" ? "Urgent" : f.relevance || "info"}
                  </Badge>
                </div>
                {f.summary && (
                  <p className="text-xs text-muted-foreground line-clamp-2">{f.summary}</p>
                )}
                <div className="flex items-center gap-2">
                  {f.pillar && (
                    <Badge variant="secondary" className="text-xs">{f.pillar}</Badge>
                  )}
                  {f.url && (
                    <a
                      href={f.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:underline flex items-center gap-1"
                    >
                      View <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No OSINT scans available. VANGUARD will populate this feed.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
