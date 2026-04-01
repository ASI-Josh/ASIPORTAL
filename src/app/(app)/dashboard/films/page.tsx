"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  Clock,
  Eye,
  Layers,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wrench,
  XCircle,
} from "lucide-react";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type {
  FilmInstallation,
  FilmWarrantyInspection,
  FilmWarrantyRegister,
  FilmLifecycleStatus,
  FilmHealthStatus,
} from "@/lib/types";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// ─── Helpers ────────────────────────────────────────────────────────────────

function toDateString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.split("T")[0];
  if (value && typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString().split("T")[0];
  }
  return "";
}

function formatDate(iso: string) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-AU", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return iso;
  }
}

function daysUntil(iso: string) {
  if (!iso) return Infinity;
  const diff = new Date(iso).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

const HEALTH_COLORS: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  monitor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  at_risk: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  expired: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: "Healthy",
  monitor: "Monitor",
  at_risk: "At Risk",
  failed: "Failed",
  expired: "Expired",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  installed: "Installed",
  warranty_registration_overdue: "Reg. Overdue",
  year_1_service_due: "Year 1 Due",
  year_1_serviced: "Year 1 Done",
  year_1_serviced_monitor: "Year 1 Monitor",
  year_2_service_due: "Year 2 Due",
  year_2_serviced: "Year 2 Done",
  year_2_serviced_monitor: "Year 2 Monitor",
  year_3_service_due: "Year 3 Due",
  year_3_serviced: "Year 3 Done",
  year_3_serviced_monitor: "Year 3 Monitor",
  replacement_due: "Replacement Due",
  replaced: "Replaced",
  warranty_claim_pending: "Claim Pending",
  warranty_claim_submitted: "Claim Submitted",
  claim_approved: "Claim Approved",
  claim_rejected: "Claim Rejected",
  replacement_under_warranty: "Warranty Replace",
  removed_early: "Removed Early",
};

const REG_STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-500/20 text-amber-400",
  overdue: "bg-red-500/20 text-red-400",
  submitted: "bg-blue-500/20 text-blue-400",
  confirmed: "bg-emerald-500/20 text-emerald-400",
  rejected: "bg-red-500/20 text-red-400",
  expired: "bg-zinc-500/20 text-zinc-400",
};

function deriveHealth(status: string): FilmHealthStatus {
  if (["installed", "year_1_serviced", "year_2_serviced", "year_3_serviced"].includes(status)) return "healthy";
  if (status.includes("monitor")) return "monitor";
  if (["warranty_claim_pending", "warranty_claim_submitted", "warranty_registration_overdue"].includes(status)) return "at_risk";
  if (["claim_approved", "removed_early"].includes(status)) return "failed";
  if (["replacement_due", "replaced"].includes(status)) return "expired";
  return "healthy";
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export default function FilmsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const [installations, setInstallations] = useState<FilmInstallation[]>([]);
  const [registers, setRegisters] = useState<FilmWarrantyRegister[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterClient, setFilterClient] = useState("all");
  const [filterHealth, setFilterHealth] = useState("all");
  const [inspections, setInspections] = useState<FilmWarrantyInspection[]>([]);
  const [confirmRegId, setConfirmRegId] = useState<string | null>(null);
  const [confirmRegRef, setConfirmRegRef] = useState("");
  const [confirmingReg, setConfirmingReg] = useState(false);

  const handleConfirmRegistration = async () => {
    if (!confirmRegId || !confirmRegRef.trim()) return;
    setConfirmingReg(true);
    try {
      const installRef = doc(db, COLLECTIONS.FILM_INSTALLATIONS, confirmRegId);
      await updateDoc(installRef, {
        "warrantyRegistration.status": "confirmed",
        "warrantyRegistration.apeaxRegistrationRef": confirmRegRef.trim(),
        "warrantyRegistration.registeredDate": new Date().toISOString().split("T")[0],
        updatedAt: Timestamp.now(),
      });
      // Also update the warranty register
      const reg = registers.find((r) => r.filmInstallationId === confirmRegId);
      if (reg) {
        const regRef = doc(db, COLLECTIONS.FILM_WARRANTY_REGISTER, reg.id);
        await updateDoc(regRef, {
          registrationStatus: "confirmed",
          apeaxRegistrationRef: confirmRegRef.trim(),
          updatedAt: Timestamp.now(),
        });
      }
      toast({ title: "Registration confirmed", description: `APEAX ref: ${confirmRegRef.trim()}` });
      setConfirmRegId(null);
      setConfirmRegRef("");
    } catch (error) {
      toast({ title: "Failed to confirm", description: String(error), variant: "destructive" });
    } finally {
      setConfirmingReg(false);
    }
  };

  // Live subscriptions
  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.FILM_INSTALLATIONS), orderBy("installedDate", "desc"));
    return onSnapshot(q, (snap) => {
      setInstallations(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FilmInstallation, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.FILM_WARRANTY_REGISTER));
    return onSnapshot(q, (snap) => {
      setRegisters(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FilmWarrantyRegister, "id">) }))
      );
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.FILM_WARRANTY_INSPECTIONS), orderBy("inspectionDate", "desc"));
    return onSnapshot(q, (snap) => {
      setInspections(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FilmWarrantyInspection, "id">) }))
      );
    });
  }, []);

  // Derived data
  const clients = useMemo(() => {
    const set = new Set(installations.map((i) => i.clientName).filter(Boolean));
    return Array.from(set).sort();
  }, [installations]);

  const activeInstallations = useMemo(
    () => installations.filter((i) => i.status === "active"),
    [installations]
  );

  const filtered = useMemo(() => {
    let list = activeInstallations;
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (i) =>
          i.installationNumber?.toLowerCase().includes(term) ||
          i.assetIdentifier?.toLowerCase().includes(term) ||
          i.clientName?.toLowerCase().includes(term) ||
          i.vehicleMake?.toLowerCase().includes(term) ||
          i.vehicleModel?.toLowerCase().includes(term)
      );
    }
    if (filterClient !== "all") list = list.filter((i) => i.clientName === filterClient);
    if (filterHealth !== "all") list = list.filter((i) => deriveHealth(i.lifecycleStatus) === filterHealth);
    return list;
  }, [activeInstallations, searchTerm, filterClient, filterHealth]);

  // Metrics
  const metrics = useMemo(() => {
    const byFilmType: Record<string, number> = {};
    const warrantyReg = { pending: 0, overdue: 0, submitted: 0, confirmed: 0 };
    const health = { healthy: 0, monitor: 0, at_risk: 0, failed: 0 };
    let totalClaims = 0;
    let openClaims = 0;

    activeInstallations.forEach((i) => {
      byFilmType[i.filmType] = (byFilmType[i.filmType] || 0) + 1;

      const h = deriveHealth(i.lifecycleStatus);
      if (h in health) health[h as keyof typeof health]++;

      const regStatus = (i.warrantyRegistration as any)?.status;
      if (regStatus in warrantyReg) warrantyReg[regStatus as keyof typeof warrantyReg]++;

      const claims = Array.isArray(i.warrantyClaims) ? i.warrantyClaims : [];
      totalClaims += claims.length;
      openClaims += claims.filter((c) =>
        ["draft", "submitted_to_apeax", "under_review"].includes(c.claimStatus)
      ).length;
    });

    const today = new Date().toISOString().split("T")[0];
    let servicesDue30 = 0;
    let servicesOverdue = 0;
    registers.forEach((r) => {
      const checks = [
        { due: toDateString(r.year1ServiceDue), done: r.year1ServiceCompleted },
        { due: toDateString(r.year2ServiceDue), done: r.year2ServiceCompleted },
        { due: toDateString(r.year3ServiceDue), done: r.year3ServiceCompleted },
      ];
      checks.forEach(({ due, done }) => {
        if (done || !due) return;
        if (due < today) servicesOverdue++;
        else if (daysUntil(due) <= 30) servicesDue30++;
      });
    });

    return {
      total: activeInstallations.length,
      byFilmType,
      warrantyReg,
      health,
      totalClaims,
      openClaims,
      servicesDue30,
      servicesOverdue,
    };
  }, [activeInstallations, registers]);

  const registerMap = useMemo(() => {
    const map = new Map<string, FilmWarrantyRegister>();
    registers.forEach((r) => {
      if (r.filmInstallationId) map.set(r.filmInstallationId, r);
    });
    return map;
  }, [registers]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">Film Management</h2>
        <p className="text-muted-foreground">
          APEAX OptiShield lifecycle management — installations, warranty inspections, claims, and service scheduling.
        </p>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-primary/10 p-2.5">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Active Installations</p>
                <p className="text-2xl font-bold">{metrics.total}</p>
              </div>
            </div>
            {Object.keys(metrics.byFilmType).length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {Object.entries(metrics.byFilmType).map(([type, count]) => (
                  <Badge key={type} variant="secondary" className="text-xs">
                    {type} ({count})
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-blue-500/10 p-2.5">
                <Wrench className="h-5 w-5 text-blue-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Services Due</p>
                <p className="text-2xl font-bold">{metrics.servicesDue30 + metrics.servicesOverdue}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-2">
              {metrics.servicesOverdue > 0 && (
                <Badge variant="destructive" className="text-xs">{metrics.servicesOverdue} overdue</Badge>
              )}
              {metrics.servicesDue30 > 0 && (
                <Badge variant="secondary" className="text-xs">{metrics.servicesDue30} next 30d</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-amber-500/10 p-2.5">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Warranty Alerts</p>
                <p className="text-2xl font-bold">
                  {metrics.warrantyReg.pending + metrics.warrantyReg.overdue + metrics.openClaims}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {metrics.warrantyReg.pending > 0 && (
                <Badge className="bg-amber-500/20 text-amber-400 border-0">{metrics.warrantyReg.pending} reg pending</Badge>
              )}
              {metrics.warrantyReg.overdue > 0 && (
                <Badge className="bg-red-500/20 text-red-400 border-0">{metrics.warrantyReg.overdue} reg overdue</Badge>
              )}
              {metrics.openClaims > 0 && (
                <Badge className="bg-orange-500/20 text-orange-400 border-0">{metrics.openClaims} claims open</Badge>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-emerald-500/10 p-2.5">
                <Activity className="h-5 w-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Health Overview</p>
                <p className="text-2xl font-bold">{metrics.health.healthy}/{metrics.total}</p>
              </div>
            </div>
            <div className="mt-2 flex gap-1.5 text-xs">
              {metrics.health.healthy > 0 && <Badge className="bg-emerald-500/20 text-emerald-400 border-0">{metrics.health.healthy} healthy</Badge>}
              {metrics.health.monitor > 0 && <Badge className="bg-amber-500/20 text-amber-400 border-0">{metrics.health.monitor} monitor</Badge>}
              {metrics.health.at_risk > 0 && <Badge className="bg-orange-500/20 text-orange-400 border-0">{metrics.health.at_risk} at risk</Badge>}
              {metrics.health.failed > 0 && <Badge className="bg-red-500/20 text-red-400 border-0">{metrics.health.failed} failed</Badge>}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="installations" className="space-y-4">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="installations">Installation Register</TabsTrigger>
          <TabsTrigger value="inspections">Inspections</TabsTrigger>
          <TabsTrigger value="schedule">Service Schedule</TabsTrigger>
          <TabsTrigger value="warranty">Warranty Register</TabsTrigger>
          <TabsTrigger value="claims">Claims</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ─── Tab 1: Installation Register ─── */}
        <TabsContent value="installations" className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by install #, asset, client, vehicle..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
            </div>
            <Select value={filterClient} onValueChange={setFilterClient}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="All clients" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clients.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterHealth} onValueChange={setFilterHealth}>
              <SelectTrigger className="w-[140px]"><SelectValue placeholder="All health" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All health</SelectItem>
                <SelectItem value="healthy">Healthy</SelectItem>
                <SelectItem value="monitor">Monitor</SelectItem>
                <SelectItem value="at_risk">At Risk</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {filtered.length === 0 ? (
            <Card className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardContent className="p-8 text-center text-muted-foreground">
                <Shield className="mx-auto h-12 w-12 mb-3 opacity-40" />
                <p>No film installations found.{searchTerm || filterClient !== "all" || filterHealth !== "all" ? " Try adjusting your filters." : ""}</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {filtered.map((inst) => {
                const health = deriveHealth(inst.lifecycleStatus);
                const reg = registerMap.get(inst.id);
                const nextService = reg
                  ? (!reg.year1ServiceCompleted ? toDateString(reg.year1ServiceDue)
                    : !reg.year2ServiceCompleted ? toDateString(reg.year2ServiceDue)
                    : !reg.year3ServiceCompleted ? toDateString(reg.year3ServiceDue)
                    : toDateString(reg.replacementDue))
                  : "";
                const daysToService = nextService ? daysUntil(nextService) : Infinity;

                return (
                  <Card
                    key={inst.id}
                    className="bg-card/50 backdrop-blur-lg border-border/20 hover:border-primary/30 transition-colors cursor-pointer"
                    onClick={() => router.push(`/dashboard/films/${inst.id}`)}
                  >
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`rounded-full w-3 h-3 flex-shrink-0 ${
                            health === "healthy" ? "bg-emerald-400" :
                            health === "monitor" ? "bg-amber-400" :
                            health === "at_risk" ? "bg-orange-400" :
                            health === "failed" ? "bg-red-400" : "bg-zinc-400"
                          }`} />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-medium text-sm">{inst.installationNumber}</span>
                              <Badge variant="secondary" className="text-xs">{inst.filmType}</Badge>
                              <Badge className={`text-xs border ${HEALTH_COLORS[health] || ""}`}>
                                {HEALTH_LABELS[health] || health}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {inst.clientName} — {inst.assetIdentifier}
                              {inst.vehicleMake ? ` (${inst.vehicleMake} ${inst.vehicleModel || ""})`.trim() : ""}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Installed</div>
                            <div>{formatDate(toDateString(inst.installedDate))}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Warranty</div>
                            <div>{formatDate(toDateString(inst.warrantyEndDate))}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Next Service</div>
                            <div className={daysToService < 0 ? "text-red-400 font-medium" : daysToService <= 30 ? "text-amber-400" : ""}>
                              {nextService ? formatDate(nextService) : "—"}
                            </div>
                          </div>
                          <Badge variant="outline" className="text-xs">
                            {LIFECYCLE_LABELS[inst.lifecycleStatus] || inst.lifecycleStatus}
                          </Badge>
                          <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ─── Tab: Inspections ─── */}
        <TabsContent value="inspections" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Eye className="h-4 w-4 text-primary" />
                Warranty Inspections
              </CardTitle>
            </CardHeader>
            <CardContent>
              {inspections.length === 0 ? (
                <p className="text-sm text-muted-foreground">No warranty inspections recorded yet.</p>
              ) : (
                <div className="space-y-2">
                  {inspections.map((insp) => {
                    const install = installations.find((i) => i.id === insp.filmInstallationId);
                    const resultColors: Record<string, string> = {
                      pass: "bg-emerald-500/20 text-emerald-400",
                      conditional_pass: "bg-amber-500/20 text-amber-400",
                      fail: "bg-red-500/20 text-red-400",
                    };
                    const statusColors: Record<string, string> = {
                      draft: "bg-zinc-500/20 text-zinc-400",
                      in_progress: "bg-blue-500/20 text-blue-400",
                      completed: "bg-emerald-500/20 text-emerald-400",
                      cancelled: "bg-red-500/20 text-red-400",
                    };

                    // Count QA criteria results
                    const vi = insp.visualInspection;
                    let passCount = 0, failCount = 0, monitorCount = 0;
                    if (vi) {
                      const criteria = [
                        vi.filmAdhesion, vi.edgeLift, vi.bubbling, vi.delamination,
                        vi.opticalClarity, vi.discolouration, vi.scratches, vi.pitting,
                        vi.staining, vi.hydrophobicPerformance, vi.wiperCompatibility,
                        vi.adasCompatibility,
                      ].filter(Boolean);
                      criteria.forEach((c) => {
                        if (c?.result === "pass") passCount++;
                        else if (c?.result === "fail") failCount++;
                        else if (c?.result === "monitor") monitorCount++;
                      });
                    }
                    const hasQaData = passCount + failCount + monitorCount > 0;

                    return (
                      <div
                        key={insp.id}
                        className="rounded-md border border-border/40 bg-background/40 p-4 space-y-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="font-mono text-sm font-medium">{insp.inspectionNumber}</span>
                              <Badge className={`text-xs border-0 ${statusColors[insp.status] || ""}`}>
                                {insp.status}
                              </Badge>
                              {insp.overallResult && (
                                <Badge className={`text-xs border-0 ${resultColors[insp.overallResult] || ""}`}>
                                  {insp.overallResult.replace(/_/g, " ")}
                                </Badge>
                              )}
                              <Badge variant="outline" className="text-xs">
                                {insp.inspectionType?.replace(/_/g, " ")}
                              </Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {insp.installationNumber} — {insp.clientName} — {insp.assetIdentifier}
                            </p>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div className="text-right">
                              <div className="text-xs">Inspected by</div>
                              <div>{insp.inspectedBy}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs">Date</div>
                              <div>{formatDate(toDateString(insp.inspectionDate))}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs">Film age</div>
                              <div>{insp.filmAgeMonths}mo</div>
                            </div>
                          </div>
                        </div>

                        {/* QA Summary */}
                        {hasQaData && (
                          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-border/20">
                            <span className="text-xs text-muted-foreground font-medium">QA Results:</span>
                            <div className="flex gap-1.5">
                              {passCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-emerald-400">
                                  <CheckCircle className="h-3 w-3" /> {passCount} pass
                                </span>
                              )}
                              {monitorCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-amber-400">
                                  <Eye className="h-3 w-3" /> {monitorCount} monitor
                                </span>
                              )}
                              {failCount > 0 && (
                                <span className="flex items-center gap-1 text-xs text-red-400">
                                  <XCircle className="h-3 w-3" /> {failCount} fail
                                </span>
                              )}
                            </div>
                            {insp.overallCondition && (
                              <span className="text-xs text-muted-foreground">
                                Condition: <span className="font-medium">{insp.overallCondition}</span>
                              </span>
                            )}
                            {insp.hydroguardService?.applied && (
                              <Badge variant="secondary" className="text-xs">HydroGuard applied</Badge>
                            )}
                          </div>
                        )}

                        {/* Expanded QA criteria detail */}
                        {hasQaData && (
                          <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3 pt-1">
                            {(() => {
                              const QA_LABELS: Record<string, string> = {
                                filmAdhesion: "Film Adhesion",
                                edgeLift: "Edge Lift",
                                bubbling: "Bubbling",
                                delamination: "Delamination",
                                opticalClarity: "Optical Clarity",
                                discolouration: "Discolouration",
                                scratches: "Scratches/Marring",
                                pitting: "Stone Chip Pitting",
                                staining: "Chemical Staining",
                                hydrophobicPerformance: "Hydrophobic Perf.",
                                wiperCompatibility: "Wiper Compatibility",
                                adasCompatibility: "ADAS Check",
                              };
                              return Object.entries(QA_LABELS).map(([key, label]) => {
                                const criterion = vi?.[key as keyof typeof vi] as any;
                                if (!criterion) return null;
                                const r = criterion.result;
                                return (
                                  <div key={key} className="flex items-center justify-between rounded border border-border/20 px-2 py-1 text-xs">
                                    <span className="text-muted-foreground">{label}</span>
                                    <span className={
                                      r === "pass" ? "text-emerald-400 font-medium" :
                                      r === "fail" ? "text-red-400 font-medium" :
                                      "text-amber-400 font-medium"
                                    }>{r}</span>
                                  </div>
                                );
                              }).filter(Boolean);
                            })()}
                          </div>
                        )}

                        {insp.conditions && insp.conditions.length > 0 && (
                          <div className="pt-1 border-t border-border/20 space-y-1">
                            <span className="text-xs font-medium text-amber-400">Conditions:</span>
                            {insp.conditions.map((cond, idx) => (
                              <div key={idx} className="text-xs text-muted-foreground">
                                • {cond.conditionType} — review by {formatDate(cond.reviewDate)} ({cond.severity})
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab: Service Schedule ─── */}
        <TabsContent value="schedule" className="space-y-4">
          {(() => {
            const today = new Date().toISOString().split("T")[0];
            type ServiceItem = { install: FilmInstallation; reg: FilmWarrantyRegister; serviceType: string; dueDate: string; overdue: boolean; materials: string };
            const serviceItems: ServiceItem[] = [];

            registers.forEach((reg) => {
              const install = installations.find((i) => i.id === reg.filmInstallationId);
              if (!install || install.status !== "active") return;

              const checks = [
                { type: "Year 1 Inspection + HydroGuard", due: toDateString(reg.year1ServiceDue), done: reg.year1ServiceCompleted, materials: "HydroGuard Nano-Ceramic Coating" },
                { type: "Year 2 Inspection + HydroGuard", due: toDateString(reg.year2ServiceDue), done: reg.year2ServiceCompleted, materials: "HydroGuard Nano-Ceramic Coating" },
                { type: "Year 3 Inspection + HydroGuard", due: toDateString(reg.year3ServiceDue), done: reg.year3ServiceCompleted, materials: "HydroGuard Nano-Ceramic Coating" },
                { type: "Film Replacement", due: toDateString(reg.replacementDue), done: reg.replacementCompleted, materials: "OptiShield Film + HydroGuard" },
              ];

              checks.forEach(({ type, due, done, materials }) => {
                if (done || !due) return;
                if (due < today || daysUntil(due) <= 90) {
                  serviceItems.push({ install, reg, serviceType: type, dueDate: due, overdue: due < today, materials });
                }
              });
            });

            serviceItems.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

            // Group by client for batch scheduling view
            const byClient: Record<string, ServiceItem[]> = {};
            serviceItems.forEach(item => {
              const client = item.install.clientName || "Unknown";
              if (!byClient[client]) byClient[client] = [];
              byClient[client].push(item);
            });

            const overdueCount = serviceItems.filter(i => i.overdue).length;
            const next30 = serviceItems.filter(i => !i.overdue && daysUntil(i.dueDate) <= 30).length;
            const next90 = serviceItems.filter(i => !i.overdue && daysUntil(i.dueDate) > 30).length;

            return (
              <>
                {/* Alert summary */}
                <div className="flex gap-3 flex-wrap">
                  {overdueCount > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
                      <span className="text-sm font-medium text-red-400">{overdueCount} overdue</span>
                    </div>
                  )}
                  {next30 > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                      <span className="text-sm font-medium text-amber-400">{next30} due within 30 days</span>
                    </div>
                  )}
                  {next90 > 0 && (
                    <div className="flex items-center gap-2 rounded-lg border border-blue-500/30 bg-blue-500/10 px-4 py-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                      <span className="text-sm font-medium text-blue-400">{next90} due within 31–90 days</span>
                    </div>
                  )}
                </div>

                {/* Grouped by client for batch scheduling */}
                {Object.keys(byClient).length === 0 ? (
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardContent className="p-8 text-center text-muted-foreground">
                      <Clock className="mx-auto h-12 w-12 mb-3 opacity-40" />
                      <p>No services due in the next 90 days.</p>
                    </CardContent>
                  </Card>
                ) : (
                  Object.entries(byClient).sort(([, a], [, b]) => {
                    // Clients with overdue services first
                    const aOverdue = a.some(i => i.overdue);
                    const bOverdue = b.some(i => i.overdue);
                    if (aOverdue && !bOverdue) return -1;
                    if (!aOverdue && bOverdue) return 1;
                    return a[0].dueDate.localeCompare(b[0].dueDate);
                  }).map(([client, items]) => {
                    const clientOverdue = items.filter(i => i.overdue).length;
                    return (
                      <Card key={client} className="bg-card/50 backdrop-blur-lg border-border/20">
                        <CardHeader className="pb-2">
                          <CardTitle className="flex items-center justify-between text-base">
                            <div className="flex items-center gap-2">
                              <Layers className="h-4 w-4 text-primary" />
                              {client}
                              <Badge variant="secondary" className="text-xs">{items.length} service{items.length !== 1 ? "s" : ""}</Badge>
                              {clientOverdue > 0 && <Badge variant="destructive" className="text-xs">{clientOverdue} overdue</Badge>}
                            </div>
                            {items.length > 1 && (
                              <span className="text-xs text-muted-foreground font-normal">
                                Batch scheduling: {items.length} assets at one depot visit
                              </span>
                            )}
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-2">
                          {items.map((item, idx) => {
                            const days = daysUntil(item.dueDate);
                            return (
                              <div key={idx} className="flex items-center justify-between rounded-md border border-border/40 bg-background/40 p-3">
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm">{item.install.installationNumber}</span>
                                    <span className="text-sm text-muted-foreground">— {item.install.assetIdentifier}</span>
                                    {item.overdue && <Badge variant="destructive" className="text-xs">OVERDUE</Badge>}
                                    {!item.overdue && days <= 30 && <Badge className="text-xs bg-amber-500/20 text-amber-400 border-0">{days}d</Badge>}
                                  </div>
                                  <p className="text-xs text-muted-foreground">Materials: {item.materials}</p>
                                </div>
                                <div className="text-right">
                                  <div className="text-sm font-medium">{item.serviceType}</div>
                                  <div className={`text-sm ${item.overdue ? "text-red-400 font-medium" : days <= 30 ? "text-amber-400" : "text-muted-foreground"}`}>
                                    {formatDate(item.dueDate)}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })
                )}
              </>
            );
          })()}
        </TabsContent>

        {/* ─── Tab 3: Warranty Register ─── */}
        <TabsContent value="warranty" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" />
                APEAX Warranty Register
              </CardTitle>
            </CardHeader>
            <CardContent>
              {registers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No warranty registrations yet.</p>
              ) : (
                <div className="space-y-2">
                  {registers.map((reg) => {
                    const install = installations.find((i) => i.id === reg.filmInstallationId);
                    const regStatus = String(reg.registrationStatus || "pending");
                    return (
                      <div
                        key={reg.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/40 bg-background/40 p-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{reg.installationNumber}</span>
                            <Badge className={`text-xs border-0 ${REG_STATUS_COLORS[regStatus] || ""}`}>
                              {regStatus}
                            </Badge>
                            {reg.apeaxRegistrationRef && (
                              <span className="text-xs text-muted-foreground">Ref: {reg.apeaxRegistrationRef}</span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {reg.clientName} — {reg.assetIdentifier}
                          </p>
                        </div>
                        <div className="flex items-center gap-4 text-sm">
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Deadline</div>
                            <div className={
                              regStatus === "pending" && daysUntil(toDateString(reg.registrationDeadline)) < 0
                                ? "text-red-400 font-medium"
                                : regStatus === "pending" && daysUntil(toDateString(reg.registrationDeadline)) <= 7
                                ? "text-amber-400"
                                : ""
                            }>
                              {formatDate(toDateString(reg.registrationDeadline))}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-xs text-muted-foreground">Warranty End</div>
                            <div>{formatDate(toDateString(reg.warrantyEndDate))}</div>
                          </div>
                          <div className="flex gap-1">
                            {[
                              { label: "Y1", done: reg.year1ServiceCompleted },
                              { label: "Y2", done: reg.year2ServiceCompleted },
                              { label: "Y3", done: reg.year3ServiceCompleted },
                            ].map(({ label, done }) => (
                              <div
                                key={label}
                                className={`w-8 h-6 rounded text-xs flex items-center justify-center font-medium ${
                                  done
                                    ? "bg-emerald-500/20 text-emerald-400"
                                    : "bg-muted/30 text-muted-foreground"
                                }`}
                              >
                                {label}
                              </div>
                            ))}
                          </div>
                          <Badge className={`text-xs border ${HEALTH_COLORS[String(reg.currentHealth)] || ""}`}>
                            {HEALTH_LABELS[String(reg.currentHealth)] || reg.currentHealth}
                          </Badge>
                          {(regStatus === "pending" || regStatus === "overdue" || regStatus === "submitted") && (
                            <Button
                              size="sm"
                              variant={regStatus === "submitted" ? "default" : "outline"}
                              className="text-xs h-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (regStatus === "submitted") {
                                  setConfirmRegId(reg.filmInstallationId);
                                  setConfirmRegRef("");
                                } else {
                                  // Mark as submitted (registration email generated via MCP agent)
                                  const installRef = doc(db, COLLECTIONS.FILM_INSTALLATIONS, reg.filmInstallationId);
                                  updateDoc(installRef, {
                                    "warrantyRegistration.status": "submitted",
                                    "warrantyRegistration.registeredDate": new Date().toISOString().split("T")[0],
                                    updatedAt: Timestamp.now(),
                                  });
                                  const regRef = doc(db, COLLECTIONS.FILM_WARRANTY_REGISTER, reg.id);
                                  updateDoc(regRef, {
                                    registrationStatus: "submitted",
                                    updatedAt: Timestamp.now(),
                                  });
                                  toast({ title: "Registration marked as submitted", description: "Confirm with APEAX ref once received." });
                                }
                              }}
                            >
                              {regStatus === "submitted" ? "Confirm Ref" : "Mark Submitted"}
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Tab 4: Claims ─── */}
        <TabsContent value="claims" className="space-y-4">
          {(() => {
            const allClaims = activeInstallations.flatMap((inst) =>
              (Array.isArray(inst.warrantyClaims) ? inst.warrantyClaims : []).map((c) => ({
                ...c,
                filmInstallationId: inst.id,
                installationNumber: inst.installationNumber,
                clientName: inst.clientName,
                assetIdentifier: inst.assetIdentifier,
              }))
            );

            const statusColors: Record<string, string> = {
              draft: "bg-zinc-500/20 text-zinc-400",
              submitted_to_apeax: "bg-blue-500/20 text-blue-400",
              under_review: "bg-amber-500/20 text-amber-400",
              approved: "bg-emerald-500/20 text-emerald-400",
              rejected: "bg-red-500/20 text-red-400",
              resolved: "bg-zinc-500/20 text-zinc-300",
            };

            const PIPELINE_STAGES = [
              { key: "draft", label: "Draft" },
              { key: "submitted_to_apeax", label: "Submitted" },
              { key: "under_review", label: "Under Review" },
              { key: "approved", label: "Approved" },
              { key: "rejected", label: "Rejected" },
              { key: "resolved", label: "Resolved" },
            ];

            const stageCounts: Record<string, number> = {};
            PIPELINE_STAGES.forEach((s) => { stageCounts[s.key] = 0; });
            allClaims.forEach((c) => { stageCounts[c.claimStatus] = (stageCounts[c.claimStatus] || 0) + 1; });

            return (
              <>
                {/* Pipeline summary */}
                <div className="flex gap-2 flex-wrap">
                  {PIPELINE_STAGES.map((stage) => (
                    <div
                      key={stage.key}
                      className={`flex-1 min-w-[100px] rounded-lg border border-border/30 p-3 text-center ${statusColors[stage.key] || "bg-muted/20"}`}
                    >
                      <div className="text-xl font-bold">{stageCounts[stage.key]}</div>
                      <div className="text-xs">{stage.label}</div>
                    </div>
                  ))}
                </div>

                <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                      <AlertTriangle className="h-4 w-4 text-primary" />
                      Warranty Claims ({allClaims.length})
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {allClaims.length === 0 ? (
                      <p className="text-sm text-muted-foreground">No warranty claims yet. Claims are auto-created when a warranty inspection fails, or can be created manually via the MCP agent.</p>
                    ) : (
                      <div className="space-y-2">
                        {allClaims.map((claim, idx) => (
                          <div key={idx} className="rounded-md border border-border/40 bg-background/40 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <div className="space-y-0.5">
                                <div className="flex items-center gap-2">
                                  <span className="font-mono text-sm font-medium">{claim.claimNumber}</span>
                                  <Badge className={`text-xs border-0 ${statusColors[claim.claimStatus] || ""}`}>
                                    {claim.claimStatus.replace(/_/g, " ")}
                                  </Badge>
                                  <Badge variant="outline" className="text-xs">{claim.severity}</Badge>
                                  <Badge variant="secondary" className="text-xs">{claim.claimType?.replace(/_/g, " ")}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                  {claim.installationNumber} — {claim.clientName} — {claim.assetIdentifier}
                                </p>
                              </div>
                              <div className="text-right text-sm text-muted-foreground">
                                <div>{formatDate(claim.claimDate)}</div>
                                {claim.apeaxClaimRef && <div className="text-xs">APEAX: {claim.apeaxClaimRef}</div>}
                              </div>
                            </div>
                            <p className="text-sm">{claim.description}</p>
                            {(claim.resolution || claim.creditAmount) && (
                              <div className="flex gap-4 text-sm pt-1 border-t border-border/20">
                                {claim.resolution && <span className="text-muted-foreground">Resolution: {claim.resolution}</span>}
                                {claim.creditAmount && <span className="text-emerald-400 font-medium">Credit: ${claim.creditAmount}</span>}
                                {claim.resolutionDate && <span className="text-muted-foreground">Resolved: {formatDate(claim.resolutionDate)}</span>}
                              </div>
                            )}
                            {Array.isArray(claim.evidencePhotos) && claim.evidencePhotos.length > 0 && (
                              <div className="flex gap-2 pt-1 border-t border-border/20">
                                {claim.evidencePhotos.map((p: any, pIdx: number) => (
                                  <img key={pIdx} src={p.url} alt={p.caption || "Evidence"} className="w-16 h-16 rounded object-cover border border-border/40" />
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            );
          })()}
        </TabsContent>

        {/* ─── Tab 5: Analytics ─── */}
        <TabsContent value="analytics" className="space-y-4">
          {(() => {
            // Installation volume by client
            const byClient: Record<string, number> = {};
            activeInstallations.forEach(i => { byClient[i.clientName] = (byClient[i.clientName] || 0) + 1; });
            const sortedClients = Object.entries(byClient).sort((a, b) => b[1] - a[1]);
            const maxClientCount = sortedClients.length > 0 ? sortedClients[0][1] : 1;

            // Inspection results
            let totalPass = 0, totalConditional = 0, totalFail = 0;
            inspections.forEach(insp => {
              if (insp.overallResult === "pass") totalPass++;
              else if (insp.overallResult === "conditional_pass") totalConditional++;
              else if (insp.overallResult === "fail") totalFail++;
            });
            const totalInspections = totalPass + totalConditional + totalFail;

            // Film type distribution
            const byType: Record<string, number> = {};
            activeInstallations.forEach(i => { byType[i.filmType] = (byType[i.filmType] || 0) + 1; });

            // Lifecycle distribution
            const byLifecycle: Record<string, number> = {};
            activeInstallations.forEach(i => { byLifecycle[i.lifecycleStatus] = (byLifecycle[i.lifecycleStatus] || 0) + 1; });
            const sortedLifecycle = Object.entries(byLifecycle).sort((a, b) => b[1] - a[1]);

            // HydroGuard consumption
            let hydroguardCount = 0;
            inspections.forEach(insp => {
              if (insp.hydroguardService?.applied) hydroguardCount++;
            });

            // Average film age
            const ages = activeInstallations.map(i => {
              const installed = toDateString(i.installedDate);
              if (!installed) return 0;
              return Math.ceil((Date.now() - new Date(installed).getTime()) / (1000 * 60 * 60 * 24 * 30.44));
            }).filter(a => a > 0);
            const avgAge = ages.length > 0 ? Math.round(ages.reduce((s, a) => s + a, 0) / ages.length) : 0;

            // Claims rate
            const totalClaimsCount = activeInstallations.reduce((sum, i) => sum + (Array.isArray(i.warrantyClaims) ? i.warrantyClaims.length : 0), 0);
            const claimRate = metrics.total > 0 ? ((totalClaimsCount / metrics.total) * 100).toFixed(1) : "0";

            return (
              <>
                {/* KPI Cards */}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">{metrics.total}</p>
                      <p className="text-sm text-muted-foreground">Active Installations</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">{avgAge}<span className="text-base text-muted-foreground">mo</span></p>
                      <p className="text-sm text-muted-foreground">Avg Film Age</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">{totalInspections}</p>
                      <p className="text-sm text-muted-foreground">Inspections Completed</p>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardContent className="p-4 text-center">
                      <p className="text-3xl font-bold">{claimRate}%</p>
                      <p className="text-sm text-muted-foreground">Claim Rate</p>
                    </CardContent>
                  </Card>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Inspection Results */}
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Inspection Results</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {totalInspections === 0 ? (
                        <p className="text-sm text-muted-foreground">No inspections completed yet.</p>
                      ) : (
                        <>
                          <div className="flex rounded-lg overflow-hidden h-8">
                            {totalPass > 0 && <div className="bg-emerald-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(totalPass / totalInspections) * 100}%` }}>{totalPass}</div>}
                            {totalConditional > 0 && <div className="bg-amber-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(totalConditional / totalInspections) * 100}%` }}>{totalConditional}</div>}
                            {totalFail > 0 && <div className="bg-red-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(totalFail / totalInspections) * 100}%` }}>{totalFail}</div>}
                          </div>
                          <div className="flex gap-4 text-xs">
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /> Pass ({totalPass})</span>
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-amber-500" /> Conditional ({totalConditional})</span>
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-red-500" /> Fail ({totalFail})</span>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Pass rate: {totalInspections > 0 ? ((totalPass / totalInspections) * 100).toFixed(0) : 0}% |
                            HydroGuard applied: {hydroguardCount}/{totalInspections} inspections
                          </p>
                        </>
                      )}
                    </CardContent>
                  </Card>

                  {/* Lifecycle Distribution */}
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Lifecycle Distribution</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {sortedLifecycle.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No data yet.</p>
                      ) : (
                        sortedLifecycle.map(([status, count]) => (
                          <div key={status} className="flex items-center gap-3 text-sm">
                            <span className="text-muted-foreground w-[140px] truncate text-xs">{LIFECYCLE_LABELS[status] || status}</span>
                            <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden">
                              <div
                                className={`h-full rounded ${
                                  status.includes("serviced") && !status.includes("monitor") ? "bg-emerald-500/60" :
                                  status.includes("monitor") ? "bg-amber-500/60" :
                                  status.includes("claim") || status.includes("overdue") ? "bg-red-500/60" :
                                  status === "installed" ? "bg-blue-500/60" :
                                  "bg-zinc-500/60"
                                }`}
                                style={{ width: `${(count / metrics.total) * 100}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium w-8 text-right">{count}</span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  {/* Client Concentration */}
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Client Concentration</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {sortedClients.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No installations yet.</p>
                      ) : (
                        sortedClients.slice(0, 10).map(([client, count]) => (
                          <div key={client} className="flex items-center gap-3 text-sm">
                            <span className="text-muted-foreground w-[140px] truncate text-xs">{client}</span>
                            <div className="flex-1 h-5 bg-muted/20 rounded overflow-hidden">
                              <div className="h-full rounded bg-primary/60" style={{ width: `${(count / maxClientCount) * 100}%` }} />
                            </div>
                            <span className="text-xs font-medium w-8 text-right">{count}</span>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>

                  {/* Health & Claims Summary */}
                  <Card className="bg-card/50 backdrop-blur-lg border-border/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Portfolio Health</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {/* Health donut approximation as stacked bar */}
                      {metrics.total > 0 && (
                        <>
                          <div className="flex rounded-lg overflow-hidden h-8">
                            {metrics.health.healthy > 0 && <div className="bg-emerald-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(metrics.health.healthy / metrics.total) * 100}%` }}>{metrics.health.healthy}</div>}
                            {metrics.health.monitor > 0 && <div className="bg-amber-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(metrics.health.monitor / metrics.total) * 100}%` }}>{metrics.health.monitor}</div>}
                            {metrics.health.at_risk > 0 && <div className="bg-orange-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(metrics.health.at_risk / metrics.total) * 100}%` }}>{metrics.health.at_risk}</div>}
                            {metrics.health.failed > 0 && <div className="bg-red-500 flex items-center justify-center text-white text-xs font-medium" style={{ width: `${(metrics.health.failed / metrics.total) * 100}%` }}>{metrics.health.failed}</div>}
                          </div>
                          <div className="flex flex-wrap gap-3 text-xs">
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /> Healthy ({metrics.health.healthy})</span>
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-amber-500" /> Monitor ({metrics.health.monitor})</span>
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-orange-500" /> At Risk ({metrics.health.at_risk})</span>
                            <span className="flex items-center gap-1"><div className="w-2.5 h-2.5 rounded bg-red-500" /> Failed ({metrics.health.failed})</span>
                          </div>
                        </>
                      )}
                      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/20">
                        <div className="rounded border border-border/30 p-2 text-center">
                          <div className="text-lg font-bold">{totalClaimsCount}</div>
                          <div className="text-xs text-muted-foreground">Total Claims</div>
                        </div>
                        <div className="rounded border border-border/30 p-2 text-center">
                          <div className="text-lg font-bold">{hydroguardCount}</div>
                          <div className="text-xs text-muted-foreground">HydroGuard Apps</div>
                        </div>
                        <div className="rounded border border-border/30 p-2 text-center">
                          <div className="text-lg font-bold">{sortedClients.length}</div>
                          <div className="text-xs text-muted-foreground">Clients</div>
                        </div>
                        <div className="rounded border border-border/30 p-2 text-center">
                          <div className="text-lg font-bold">{metrics.warrantyReg.confirmed}</div>
                          <div className="text-xs text-muted-foreground">Warranties Confirmed</div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </>
            );
          })()}
        </TabsContent>
      </Tabs>

      {/* ─── Confirm Registration Dialog ─── */}
      <Dialog open={Boolean(confirmRegId)} onOpenChange={(open) => !open && setConfirmRegId(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm APEAX Registration</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter the APEAX warranty reference number received from their confirmation email.
            </p>
            <Input
              placeholder="APEAX reference number"
              value={confirmRegRef}
              onChange={(e) => setConfirmRegRef(e.target.value)}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirmRegId(null)}>Cancel</Button>
              <Button
                onClick={handleConfirmRegistration}
                disabled={!confirmRegRef.trim() || confirmingReg}
              >
                {confirmingReg ? "Confirming..." : "Confirm Registration"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
