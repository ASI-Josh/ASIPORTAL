"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { cuttingApi } from "@/lib/cutting/api";
import { useAuth } from "@/contexts/AuthContext";
import { CUTTING_ISSUE_TAG_LABELS } from "@/lib/types";
import type { CuttingIssueTag } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft } from "lucide-react";

function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  if (typeof ts === "object" && "_seconds" in ts) return new Date(ts._seconds * 1000);
  if (typeof ts === "object" && "seconds" in ts) return new Date(ts.seconds * 1000);
  if (typeof ts === "string") return new Date(ts);
  return null;
}

export default function OperatorLogPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterOperator, setFilterOperator] = useState("");
  const [filterFilm, setFilterFilm] = useState("");

  useEffect(() => {
    cuttingApi
      .listJobs()
      .then((r) => setJobs(r.jobs))
      .catch((e) =>
        toast({ title: "Couldn't load", description: e.message, variant: "destructive" }),
      )
      .finally(() => setLoading(false));
  }, [toast]);

  const filtered = useMemo(() => {
    const fromTs = filterFrom ? new Date(filterFrom).getTime() : -Infinity;
    const toTs = filterTo ? new Date(filterTo).getTime() + 86_400_000 : Infinity;
    return jobs.filter((j) => {
      const created = tsToDate(j.createdAt)?.getTime() ?? 0;
      if (created < fromTs || created > toTs) return false;
      if (filterOperator && !(j.operatorName ?? "").toLowerCase().includes(filterOperator.toLowerCase()))
        return false;
      if (filterFilm && !(j.filmStockDescription ?? "").toLowerCase().includes(filterFilm.toLowerCase()))
        return false;
      return true;
    });
  }, [jobs, filterFrom, filterTo, filterOperator, filterFilm]);

  const stats = useMemo(() => {
    const completed = filtered.filter((j) => j.qcStatus === "pass");
    const filmConsumed: Record<string, number> = {};
    let totalCutMs = 0;
    let cutCount = 0;
    const tagCounts: Record<string, number> = {};

    for (const j of completed) {
      const film = j.filmStockDescription ?? "Unspecified";
      filmConsumed[film] = (filmConsumed[film] ?? 0) + Number(j.rollConsumedMetres ?? 0);
      const start = tsToDate(j.cutStartAt)?.getTime();
      const end = tsToDate(j.cutEndAt)?.getTime();
      if (start && end && end > start) {
        totalCutMs += end - start;
        cutCount += 1;
      }
      for (const t of (j.issueTags ?? []) as CuttingIssueTag[]) {
        tagCounts[t] = (tagCounts[t] ?? 0) + 1;
      }
    }

    const topTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    return {
      completedCount: completed.length,
      filmConsumed,
      avgCutMinutes: cutCount > 0 ? totalCutMs / cutCount / 60_000 : 0,
      topTags,
    };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cutting">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
        <h1 className="font-headline text-2xl font-semibold">Operator log</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div>
            <Label>From</Label>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div>
            <Label>To</Label>
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          <div>
            <Label>Operator</Label>
            <Input value={filterOperator} onChange={(e) => setFilterOperator(e.target.value)} placeholder="Name" />
          </div>
          <div>
            <Label>Film type</Label>
            <Input value={filterFilm} onChange={(e) => setFilterFilm(e.target.value)} placeholder="APEAX PPF" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Completed jobs</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">{stats.completedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Avg cut time</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-semibold">
              {stats.avgCutMinutes ? `${stats.avgCutMinutes.toFixed(1)} min` : "—"}
            </div>
          </CardContent>
        </Card>
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Film consumed (m)</CardTitle>
          </CardHeader>
          <CardContent>
            {Object.keys(stats.filmConsumed).length === 0 ? (
              <p className="text-muted-foreground text-sm">No completed jobs in range.</p>
            ) : (
              <ul className="text-sm space-y-1">
                {Object.entries(stats.filmConsumed).map(([k, v]) => (
                  <li key={k} className="flex justify-between">
                    <span>{k}</span>
                    <span className="font-mono">{v.toFixed(2)}m</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Top issue tags</CardTitle>
          <CardDescription>Most frequent issues across completed jobs in range.</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.topTags.length === 0 ? (
            <p className="text-muted-foreground text-sm">None.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {stats.topTags.map(([tag, count]) => (
                <li key={tag} className="flex justify-between">
                  <span>{CUTTING_ISSUE_TAG_LABELS[tag as CuttingIssueTag] ?? tag}</span>
                  <span className="font-mono">{count}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent jobs</CardTitle>
          {user?.role === "client" ? (
            <CardDescription>Showing your jobs only.</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>Film</TableHead>
                  <TableHead>Metres</TableHead>
                  <TableHead>QC</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono">{j.cuttingNumber}</TableCell>
                    <TableCell>{[j.vehicle?.make, j.vehicle?.model].filter(Boolean).join(" ") || "—"}</TableCell>
                    <TableCell>{j.operatorName || "—"}</TableCell>
                    <TableCell>{j.filmStockDescription || "—"}</TableCell>
                    <TableCell className="font-mono">{j.rollConsumedMetres?.toFixed?.(2) ?? "—"}</TableCell>
                    <TableCell>{j.qcStatus.replace(/_/g, " ")}</TableCell>
                    <TableCell>
                      <Button asChild size="sm" variant="ghost">
                        <Link href={`/cutting/${j.id}`}>Open</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
