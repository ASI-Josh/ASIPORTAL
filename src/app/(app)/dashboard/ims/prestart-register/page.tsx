"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Calendar, ClipboardCheck, FileText, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { PrestartCheck, PrestartChecklist, PrestartIssue } from "@/lib/types";

const getChecklistCompliant = (checklist?: PrestartChecklist) => {
  if (!checklist) return false;
  const kitsOk = Object.values(checklist.kits || {}).every(Boolean);
  const vehicleOk = Object.values(checklist.vehicleSafety || {}).every(Boolean);
  return (
    checklist.toolsReady &&
    checklist.consumablesReady &&
    checklist.devicesCharged &&
    kitsOk &&
    vehicleOk
  );
};

const getIssueCounts = (issues?: PrestartIssue[]) => {
  const total = issues?.length || 0;
  const open = issues?.filter((issue) => issue.status !== "closed").length || 0;
  return { total, open };
};

const getComplianceBadge = (isCompliant: boolean) =>
  isCompliant
    ? "bg-green-500/20 text-green-400 border-green-500/30"
    : "bg-red-500/20 text-red-400 border-red-500/30";

const formatDate = (value?: Timestamp | string) => {
  if (!value) return "-";
  const date =
    typeof value === "string"
      ? new Date(value)
      : value?.toDate
        ? value.toDate()
        : new Date(value as unknown as string);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

export default function PrestartRegisterPage() {
  const router = useRouter();
  const [checks, setChecks] = useState<PrestartCheck[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  useEffect(() => {
    const checksQuery = query(
      collection(db, COLLECTIONS.PRESTART_CHECKS),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(checksQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<PrestartCheck, "id">),
      }));
      setChecks(loaded);
    });
    return () => unsubscribe();
  }, []);

  const totals = useMemo(() => {
    const total = checks.length;
    const withIssues = checks.filter((check) => (check.issues || []).length > 0).length;
    const openActions = checks.reduce((sum, check) => {
      const openCount = check.issues?.filter((issue) => issue.status !== "closed").length || 0;
      return sum + openCount;
    }, 0);
    const compliantCount = checks.filter((check) => getChecklistCompliant(check.checklist)).length;
    const complianceRate = total > 0 ? Math.round((compliantCount / total) * 100) : 0;
    return { total, withIssues, openActions, complianceRate };
  }, [checks]);

  const filteredChecks = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    return checks.filter((check) => {
      const matchesSearch =
        !queryText ||
        check.createdByName?.toLowerCase().includes(queryText) ||
        check.createdByEmail?.toLowerCase().includes(queryText) ||
        check.prestartDate?.includes(queryText);
      const matchesDateRange =
        (!startDate || check.prestartDate >= startDate) &&
        (!endDate || check.prestartDate <= endDate);
      return matchesSearch && matchesDateRange;
    });
  }, [checks, searchQuery, startDate, endDate]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-emerald-500/20 backdrop-blur-sm">
            <ClipboardCheck className="h-8 w-8 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Prestart Register</h1>
            <p className="text-muted-foreground">Daily prestart records and corrective actions.</p>
          </div>
        </div>
        <Button onClick={() => router.push("/dashboard/daily-prestart")}>New prestart</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totals.total}</div>
            <p className="text-xs text-muted-foreground">Total checks</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-400">{totals.withIssues}</div>
            <p className="text-xs text-muted-foreground">Checks with issues</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-red-400">{totals.openActions}</div>
            <p className="text-xs text-muted-foreground">Open corrective actions</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-green-400">{totals.complianceRate}%</div>
            <p className="text-xs text-muted-foreground">Compliance rate</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, or date..."
                className="pl-10"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Input
                type="date"
                className="w-[150px]"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
              <span className="text-muted-foreground">to</span>
              <Input
                type="date"
                className="w-[150px]"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Historical Prestart Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredChecks.length === 0 ? (
            <div className="text-center py-12">
              <ClipboardCheck className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No prestart records yet</h3>
              <p className="text-muted-foreground mb-4">
                Complete the daily prestart checklist to populate this register.
              </p>
              <Button onClick={() => router.push("/dashboard/daily-prestart")}>Start prestart</Button>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Date</TableHead>
                    <TableHead>Completed by</TableHead>
                    <TableHead>Compliance</TableHead>
                    <TableHead>Issues</TableHead>
                    <TableHead>Open CA</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredChecks.map((check) => {
                    const isCompliant = getChecklistCompliant(check.checklist);
                    const issueCounts = getIssueCounts(check.issues);
                    return (
                      <TableRow key={check.id} className="hover:bg-muted/20">
                        <TableCell className="font-medium">
                          {formatDate(check.prestartDate)}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{check.createdByName}</div>
                          <div className="text-xs text-muted-foreground">{check.createdByEmail}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={getComplianceBadge(isCompliant)}>
                            {isCompliant ? "Compliant" : "Non-Conformance"}
                          </Badge>
                        </TableCell>
                        <TableCell>{issueCounts.total}</TableCell>
                        <TableCell>{issueCounts.open}</TableCell>
                        <TableCell>{formatDate(check.updatedAt)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => router.push(`/dashboard/ims/prestart-register/${check.id}`)}
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
