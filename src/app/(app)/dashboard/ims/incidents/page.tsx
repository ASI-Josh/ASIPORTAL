"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { AlertTriangle, Calendar, FileText, Search } from "lucide-react";

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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { COLLECTIONS } from "@/lib/collections";
import { db } from "@/lib/firebaseClient";
import { generateIncidentNumber } from "@/lib/firestore";
import type { ImsIncident, ImsIncidentStatus } from "@/lib/types";

const statusBadge = (status: ImsIncidentStatus) => {
  switch (status) {
    case "closed":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "actions_required":
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "investigating":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    case "reported":
      return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    default:
      return "bg-muted text-muted-foreground border-border/40";
  }
};

const formatDateTime = (value?: Timestamp) => {
  if (!value) return "-";
  const date = value.toDate();
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function IncidentsRegisterPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const [incidents, setIncidents] = useState<ImsIncident[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const incidentsQuery = query(
      collection(db, COLLECTIONS.IMS_INCIDENTS),
      orderBy("reportedAt", "desc")
    );
    const unsubscribe = onSnapshot(incidentsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<ImsIncident, "id">),
      }));
      setIncidents(loaded);
    });
    return () => unsubscribe();
  }, []);

  const totals = useMemo(() => {
    const total = incidents.length;
    const open = incidents.filter((i) => i.status !== "closed").length;
    const investigating = incidents.filter((i) => i.status === "investigating").length;
    const actionsRequired = incidents.filter((i) => i.status === "actions_required").length;
    return { total, open, investigating, actionsRequired };
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    return incidents.filter((incident) => {
      const matchesSearch =
        !queryText ||
        incident.incidentNumber?.toLowerCase().includes(queryText) ||
        incident.reportedByName?.toLowerCase().includes(queryText) ||
        incident.reportedByEmail?.toLowerCase().includes(queryText) ||
        incident.organizationName?.toLowerCase().includes(queryText) ||
        incident.jobNumber?.toLowerCase().includes(queryText);

      const occurred = incident.occurredAt?.toDate?.();
      const occurredDate = occurred
        ? occurred.toISOString().slice(0, 10)
        : undefined;
      const matchesDateRange =
        (!startDate || (occurredDate && occurredDate >= startDate)) &&
        (!endDate || (occurredDate && occurredDate <= endDate));

      return matchesSearch && matchesDateRange;
    });
  }, [incidents, searchQuery, startDate, endDate]);

  const handleCreateIncident = async () => {
    if (!user) return;
    setCreating(true);
    try {
      const incidentNumber = await generateIncidentNumber();
      const now = Timestamp.now();
      const payload: Omit<ImsIncident, "id"> = {
        incidentNumber,
        category: "whs",
        incidentType: "hazard",
        severity: "medium",
        status: "draft",
        occurredAt: now,
        reportedAt: now,
        reportedById: user.uid,
        reportedByName: user.name || user.email,
        reportedByEmail: user.email,
        description: "",
        createdAt: now,
        updatedAt: now,
      };
      const ref = await addDoc(collection(db, COLLECTIONS.IMS_INCIDENTS), payload);
      toast({ title: "Incident created", description: incidentNumber });
      router.push(`/dashboard/ims/incidents/${ref.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create incident.";
      toast({ title: "Create failed", description: message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-amber-500/20 backdrop-blur-sm">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Incident Register</h1>
            <p className="text-muted-foreground">
              ISO 9001/14001/45001 aligned incident reporting, investigation, and close-out.
            </p>
          </div>
        </div>
        <Button onClick={handleCreateIncident} disabled={creating}>
          {creating ? "Creating..." : "New incident"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold">{totals.total}</div>
            <p className="text-xs text-muted-foreground">Total incidents</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-amber-300">{totals.open}</div>
            <p className="text-xs text-muted-foreground">Open</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-sky-300">{totals.investigating}</div>
            <p className="text-xs text-muted-foreground">Investigating</p>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="pt-6">
            <div className="text-2xl font-bold text-purple-300">{totals.actionsRequired}</div>
            <p className="text-xs text-muted-foreground">Actions required</p>
          </CardContent>
        </Card>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-4">
            <div className="relative flex-1 min-w-[250px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by incident #, reporter, client, job #..."
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
            Incident Records
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filteredIncidents.length === 0 ? (
            <div className="text-center py-12">
              <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No incidents yet</h3>
              <p className="text-muted-foreground mb-4">
                Create an incident report to populate this register.
              </p>
              <Button onClick={handleCreateIncident} disabled={creating}>
                {creating ? "Creating..." : "Create first incident"}
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Incident</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Occurred</TableHead>
                    <TableHead>Reported by</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredIncidents.map((incident) => (
                    <TableRow key={incident.id} className="hover:bg-muted/20">
                      <TableCell className="font-medium">
                        <div className="font-mono">{incident.incidentNumber}</div>
                        {incident.jobNumber && (
                          <div className="text-xs text-muted-foreground">
                            Job: {incident.jobNumber}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadge(incident.status)}>
                          {incident.status.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>{incident.category.toUpperCase()}</TableCell>
                      <TableCell>{incident.severity.toUpperCase()}</TableCell>
                      <TableCell>{formatDateTime(incident.occurredAt)}</TableCell>
                      <TableCell>
                        <div className="font-medium">{incident.reportedByName}</div>
                        <div className="text-xs text-muted-foreground">{incident.reportedByEmail}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/ims/incidents/${incident.id}`)}
                        >
                          Open
                        </Button>
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

