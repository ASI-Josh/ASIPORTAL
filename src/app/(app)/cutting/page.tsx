"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cuttingApi } from "@/lib/cutting/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Scissors, ChartLine, Settings } from "lucide-react";

const QC_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pass: "default",
  fail: "destructive",
  not_yet_checked: "secondary",
};

const QC_LABEL: Record<string, string> = {
  pass: "QC Pass",
  fail: "QC Fail",
  not_yet_checked: "Pending QC",
};

export default function CuttingHomePage() {
  const { user } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    let mounted = true;
    cuttingApi
      .listJobs()
      .then((r) => mounted && setJobs(r.jobs))
      .catch((e) =>
        toast({ title: "Couldn't load cutting jobs", description: e.message, variant: "destructive" }),
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [toast]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await cuttingApi.createJob({
        vehicle: { make: "", model: "" },
        patternSource: "3m_marketplace",
      });
      router.push(`/cutting/${res.job.id}`);
    } catch (e: any) {
      toast({ title: "Couldn't create job", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-headline text-3xl font-semibold tracking-tight flex items-center gap-2">
            <Scissors className="h-7 w-7 text-primary" />
            ASI Cutting Workflow
          </h1>
          <p className="text-muted-foreground">
            Standalone cutting capability — Summa S One D160 + 3M Pattern Marketplace.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href="/cutting/operator-log">
              <ChartLine className="h-4 w-4 mr-2" />
              Operator Log
            </Link>
          </Button>
          {isAdmin ? (
            <Button asChild variant="outline">
              <Link href="/cutting/material-profiles">
                <Settings className="h-4 w-4 mr-2" />
                Material Profiles
              </Link>
            </Button>
          ) : null}
          <Button onClick={handleCreate} disabled={creating}>
            <Plus className="h-4 w-4 mr-2" />
            New Cutting Job
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Cutting jobs</CardTitle>
          <CardDescription>
            {user?.role === "client"
              ? "Your cutting jobs."
              : "All cutting jobs across the tenant."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : jobs.length === 0 ? (
            <p className="text-muted-foreground text-sm">No cutting jobs yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Vehicle</TableHead>
                  <TableHead>Pattern</TableHead>
                  <TableHead>Operator</TableHead>
                  <TableHead>QC</TableHead>
                  <TableHead className="text-right">Open</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {jobs.map((j) => (
                  <TableRow key={j.id}>
                    <TableCell className="font-mono">{j.cuttingNumber}</TableCell>
                    <TableCell>
                      {[j.vehicle?.year, j.vehicle?.make, j.vehicle?.model]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </TableCell>
                    <TableCell className="text-sm">{j.patternReference || j.patternSource}</TableCell>
                    <TableCell className="text-sm">{j.operatorName || "—"}</TableCell>
                    <TableCell>
                      <Badge variant={QC_VARIANT[j.qcStatus] ?? "secondary"}>
                        {QC_LABEL[j.qcStatus] ?? j.qcStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
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
