"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { Target, ExternalLink, ArrowRight, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

interface PursuitEntry {
  id: string;
  streamType: string;
  company: { name: string };
  opportunity: { potentialValue?: number; category: string };
  roeScore?: { total: number; grade: string };
  promotedDate?: string;
  pipelineLeadId?: string;
}

const GRADE_COLORS: Record<string, string> = {
  A: "text-green-400 bg-green-500/20",
  B: "text-blue-400 bg-blue-500/20",
  C: "text-amber-400 bg-amber-500/20",
  D: "text-orange-400 bg-orange-500/20",
  E: "text-red-400 bg-red-500/20",
};

function daysSince(dateStr?: string): number {
  if (!dateStr) return 0;
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

export function ActivePursuits() {
  const [pursuits, setPursuits] = useState<PursuitEntry[]>([]);

  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.LEADS_REGISTER),
      where("status", "==", "promoted"),
      where("promotedToPipeline", "==", true),
    );
    const unsub = onSnapshot(q, (snap) => {
      setPursuits(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PursuitEntry[]);
    });
    return () => unsub();
  }, []);

  if (pursuits.length === 0) return null;

  return (
    <Card className="bg-card/50 border-border/40">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          Active Pursuits
          <Badge variant="outline" className="ml-auto text-xs">{pursuits.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pursuits.map((p) => {
          const days = daysSince(p.promotedDate);
          const gc = GRADE_COLORS[p.roeScore?.grade || "E"] || GRADE_COLORS.E;
          return (
            <div key={p.id} className="flex items-center gap-3 p-2 rounded-lg border border-border/30 hover:border-primary/30 transition-colors">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{p.company.name}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${p.streamType === "supply_chain" ? "border-violet-500/40 text-violet-400" : "border-blue-500/40 text-blue-400"}`}
                  >
                    {p.streamType === "supply_chain" ? "SC" : "Sales"}
                  </Badge>
                  {p.roeScore && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${gc}`}>
                      {p.roeScore.grade}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                    <Clock className="h-2.5 w-2.5" /> {days}d
                  </span>
                </div>
              </div>
              {p.pipelineLeadId && (
                <Link
                  href={`/dashboard/crm/${p.pipelineLeadId}`}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1 flex-shrink-0"
                >
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          );
        })}
        <Link href="/dashboard/leads-register" className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 pt-1">
          View full register <ExternalLink className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
