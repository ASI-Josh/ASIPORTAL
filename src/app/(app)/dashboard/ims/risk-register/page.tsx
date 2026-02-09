"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from "firebase/firestore";
import { ShieldAlert, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COLLECTIONS } from "@/lib/collections";
import { db } from "@/lib/firebaseClient";
import type { ImsRiskDomain, ImsRiskRegisterEntry, ImsRiskRegisterStatus } from "@/lib/types";

const statusBadge = (status: ImsRiskRegisterStatus) => {
  switch (status) {
    case "closed":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "in_progress":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    default:
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
  }
};

const formatDate = (value?: Timestamp) => {
  if (!value) return "-";
  const date = value.toDate();
  return date.toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
};

export default function RiskRegisterPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [entries, setEntries] = useState<ImsRiskRegisterEntry[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [domainFilter, setDomainFilter] = useState<ImsRiskDomain | "all">("all");
  const [statusFilter, setStatusFilter] = useState<ImsRiskRegisterStatus | "all">("all");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    const entriesQuery = query(
      collection(db, COLLECTIONS.IMS_RISK_REGISTER),
      orderBy("updatedAt", "desc")
    );
    const unsubscribe = onSnapshot(entriesQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ImsRiskRegisterEntry, "id">),
      }));
      setEntries(loaded);
    });
    return () => unsubscribe();
  }, []);

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesQuery =
        !q ||
        entry.title?.toLowerCase().includes(q) ||
        entry.description?.toLowerCase().includes(q) ||
        entry.source?.label?.toLowerCase().includes(q);
      const matchesDomain = domainFilter === "all" || entry.domain === domainFilter;
      const matchesStatus = statusFilter === "all" || entry.status === statusFilter;
      return matchesQuery && matchesDomain && matchesStatus;
    });
  }, [entries, searchQuery, domainFilter, statusFilter]);

  const handleUpdateEntry = async (entryId: string, updates: Partial<ImsRiskRegisterEntry>) => {
    setSavingId(entryId);
    try {
      await updateDoc(doc(db, COLLECTIONS.IMS_RISK_REGISTER, entryId), {
        ...updates,
        updatedAt: Timestamp.now(),
      });
      toast({ title: "Updated", description: "Risk register entry updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update entry.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Risk & Opportunities Register is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-amber-500/20 backdrop-blur-sm">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Risk & Opportunities Register</h1>
          <p className="text-muted-foreground">
            Aggregated risks and controls captured from incidents, assessments, and inspections (ISO 9001/14001/45001).
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search risks, sources, descriptions..."
                className="pl-10"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <div className="grid gap-2 min-w-[200px]">
              <Label>Domain</Label>
              <Select value={domainFilter} onValueChange={(val) => setDomainFilter(val as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="whs">WHS</SelectItem>
                  <SelectItem value="environment">Environment</SelectItem>
                  <SelectItem value="quality">Quality</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 min-w-[200px]">
              <Label>Status</Label>
              <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Register entries</CardTitle>
        </CardHeader>
        <CardContent>
          {filteredEntries.length === 0 ? (
            <div className="text-sm text-muted-foreground">No register entries yet.</div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Title</TableHead>
                    <TableHead>Domain</TableHead>
                    <TableHead>Risk</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.map((entry) => (
                    <TableRow key={entry.id} className="hover:bg-muted/20">
                      <TableCell className="font-medium">
                        <div>{entry.title}</div>
                        {entry.existingControls ? (
                          <div className="text-xs text-muted-foreground line-clamp-1">
                            Controls: {entry.existingControls}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell>{entry.domain.toUpperCase()}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-background/60">
                          {(entry.riskLevel || "-").toUpperCase()}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadge(entry.status)}>
                          {entry.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        <div className="font-mono text-xs">{entry.source.label || entry.source.type}</div>
                      </TableCell>
                      <TableCell>{formatDate(entry.updatedAt)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Select
                            value={entry.status}
                            onValueChange={(val) =>
                              handleUpdateEntry(entry.id, { status: val as ImsRiskRegisterStatus })
                            }
                            disabled={savingId === entry.id}
                          >
                            <SelectTrigger className="h-8 w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="open">Open</SelectItem>
                              <SelectItem value="in_progress">In progress</SelectItem>
                              <SelectItem value="closed">Closed</SelectItem>
                            </SelectContent>
                          </Select>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              if (entry.source.type === "incident") {
                                router.push(`/dashboard/ims/incidents/${entry.source.id}`);
                                return;
                              }
                              if (entry.source.type === "job_risk_assessment") {
                                router.push(`/dashboard/jobs/${entry.source.id}`);
                                return;
                              }
                              if (entry.source.url) {
                                router.push(entry.source.url);
                              }
                            }}
                          >
                            View
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

