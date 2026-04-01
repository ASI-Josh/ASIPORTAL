"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  orderBy,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import {
  ArrowLeft,
  Camera,
  CheckCircle,
  ChevronRight,
  Clock,
  FileText,
  Layers,
  Shield,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from "lucide-react";

import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import type {
  FilmInstallation,
  FilmWarrantyInspection,
  FilmWarrantyRegister,
} from "@/lib/types";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

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
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

const HEALTH_COLORS: Record<string, string> = {
  healthy: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  monitor: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  at_risk: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  failed: "bg-red-500/20 text-red-400 border-red-500/30",
  expired: "bg-zinc-500/20 text-zinc-400 border-zinc-500/30",
};

const HEALTH_LABELS: Record<string, string> = {
  healthy: "Healthy", monitor: "Monitor", at_risk: "At Risk", failed: "Failed", expired: "Expired",
};

const LIFECYCLE_LABELS: Record<string, string> = {
  installed: "Installed", warranty_registration_overdue: "Reg. Overdue",
  year_1_service_due: "Year 1 Due", year_1_serviced: "Year 1 Done", year_1_serviced_monitor: "Year 1 Monitor",
  year_2_service_due: "Year 2 Due", year_2_serviced: "Year 2 Done", year_2_serviced_monitor: "Year 2 Monitor",
  year_3_service_due: "Year 3 Due", year_3_serviced: "Year 3 Done", year_3_serviced_monitor: "Year 3 Monitor",
  replacement_due: "Replacement Due", replaced: "Replaced",
  warranty_claim_pending: "Claim Pending", warranty_claim_submitted: "Claim Submitted",
  claim_approved: "Claim Approved", claim_rejected: "Claim Rejected",
  replacement_under_warranty: "Warranty Replace", removed_early: "Removed Early",
};

function deriveHealth(status: string) {
  if (["installed", "year_1_serviced", "year_2_serviced", "year_3_serviced"].includes(status)) return "healthy";
  if (status.includes("monitor")) return "monitor";
  if (["warranty_claim_pending", "warranty_claim_submitted", "warranty_registration_overdue"].includes(status)) return "at_risk";
  if (["claim_approved", "removed_early"].includes(status)) return "failed";
  if (["replacement_due", "replaced"].includes(status)) return "expired";
  return "healthy";
}

const QA_LABELS: Record<string, string> = {
  filmAdhesion: "Film Adhesion", edgeLift: "Edge Lift", bubbling: "Bubbling",
  delamination: "Delamination", opticalClarity: "Optical Clarity", discolouration: "Discolouration",
  scratches: "Scratches/Marring", pitting: "Stone Chip Pitting", staining: "Chemical Staining",
  hydrophobicPerformance: "Hydrophobic Performance", wiperCompatibility: "Wiper Compatibility",
  adasCompatibility: "ADAS Compatibility",
};

// ─── Page ───────────────────────────────────────────────────────────────────

export default function FilmInstallationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();

  const [installation, setInstallation] = useState<FilmInstallation | null>(null);
  const [register, setRegister] = useState<FilmWarrantyRegister | null>(null);
  const [inspections, setInspections] = useState<FilmWarrantyInspection[]>([]);

  useEffect(() => {
    if (!id) return;
    return onSnapshot(doc(db, COLLECTIONS.FILM_INSTALLATIONS, id), (snap) => {
      if (!snap.exists()) { setInstallation(null); return; }
      setInstallation({ id: snap.id, ...(snap.data() as Omit<FilmInstallation, "id">) });
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(collection(db, COLLECTIONS.FILM_WARRANTY_REGISTER), where("filmInstallationId", "==", id));
    return onSnapshot(q, (snap) => {
      setRegister(snap.empty ? null : { id: snap.docs[0].id, ...(snap.docs[0].data() as Omit<FilmWarrantyRegister, "id">) });
    });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const q = query(
      collection(db, COLLECTIONS.FILM_WARRANTY_INSPECTIONS),
      where("filmInstallationId", "==", id),
      orderBy("inspectionDate", "desc")
    );
    return onSnapshot(q, (snap) => {
      setInspections(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<FilmWarrantyInspection, "id">) })));
    });
  }, [id]);

  if (!installation) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <Shield className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Installation Not Found</h2>
        <Button onClick={() => router.push("/dashboard/films")}>
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Films
        </Button>
      </div>
    );
  }

  const inst = installation;
  const health = deriveHealth(inst.lifecycleStatus);
  const services = Array.isArray(inst.serviceHistory) ? inst.serviceHistory : [];
  const claims = Array.isArray(inst.warrantyClaims) ? inst.warrantyClaims : [];

  // Collect all photos from inspections
  const allPhotos: { url: string; label: string }[] = [];
  inspections.forEach(insp => {
    if (!insp.visualInspection) return;
    Object.entries(insp.visualInspection).forEach(([key, criterion]) => {
      if (criterion && Array.isArray(criterion.photoUrls)) {
        criterion.photoUrls.forEach((url: string) => {
          allPhotos.push({ url, label: `${QA_LABELS[key] || key} — ${insp.inspectionNumber}` });
        });
      }
    });
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard/films")} className="w-fit">
          <ArrowLeft className="mr-2 h-4 w-4" /> Back to Films
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-3xl font-headline font-bold tracking-tight">{inst.installationNumber}</h2>
              <Badge className={`border ${HEALTH_COLORS[health]}`}>{HEALTH_LABELS[health]}</Badge>
              <Badge variant="secondary">{inst.filmType}</Badge>
              <Badge variant="outline">{LIFECYCLE_LABELS[inst.lifecycleStatus] || inst.lifecycleStatus}</Badge>
            </div>
            <p className="text-muted-foreground">
              {inst.clientName} — {inst.assetIdentifier}
              {inst.vehicleMake ? ` (${inst.vehicleMake} ${inst.vehicleModel || ""} ${inst.vehicleYear || ""})`.trim() : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Lifecycle Timeline */}
      {register && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Clock className="h-4 w-4 text-primary" />
              Lifecycle Timeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-0 py-4">
              {[
                { label: "Installed", sublabel: formatDate(toDateString(inst.installedDate)), done: true, active: false },
                {
                  label: "Warranty Reg",
                  sublabel: (() => {
                    const s = (inst.warrantyRegistration as any)?.status;
                    return s === "confirmed" ? `Confirmed` : s === "submitted" ? "Submitted" : `Due ${formatDate(toDateString((inst.warrantyRegistration as any)?.registrationDeadline))}`;
                  })(),
                  done: ["submitted", "confirmed"].includes((inst.warrantyRegistration as any)?.status),
                  active: (inst.warrantyRegistration as any)?.status === "pending" || (inst.warrantyRegistration as any)?.status === "overdue",
                  alert: (inst.warrantyRegistration as any)?.status === "overdue",
                },
                { label: "Year 1 Service", sublabel: register.year1ServiceCompleted ? `Done ${formatDate(toDateString(register.year1ServiceDate))}` : formatDate(toDateString(register.year1ServiceDue)), done: register.year1ServiceCompleted, active: !register.year1ServiceCompleted && daysUntil(toDateString(register.year1ServiceDue)) <= 30, alert: !register.year1ServiceCompleted && daysUntil(toDateString(register.year1ServiceDue)) < 0 },
                { label: "Year 2 Service", sublabel: register.year2ServiceCompleted ? `Done ${formatDate(toDateString(register.year2ServiceDate))}` : formatDate(toDateString(register.year2ServiceDue)), done: register.year2ServiceCompleted, active: register.year1ServiceCompleted && !register.year2ServiceCompleted && daysUntil(toDateString(register.year2ServiceDue)) <= 30, alert: register.year1ServiceCompleted && !register.year2ServiceCompleted && daysUntil(toDateString(register.year2ServiceDue)) < 0 },
                { label: "Year 3 Service", sublabel: register.year3ServiceCompleted ? `Done ${formatDate(toDateString(register.year3ServiceDate))}` : formatDate(toDateString(register.year3ServiceDue)), done: register.year3ServiceCompleted, active: register.year2ServiceCompleted && !register.year3ServiceCompleted && daysUntil(toDateString(register.year3ServiceDue)) <= 30, alert: register.year2ServiceCompleted && !register.year3ServiceCompleted && daysUntil(toDateString(register.year3ServiceDue)) < 0 },
                { label: "Replacement", sublabel: register.replacementCompleted ? "Replaced" : formatDate(toDateString(register.replacementDue)), done: register.replacementCompleted, active: register.year3ServiceCompleted && !register.replacementCompleted },
              ].map((step, idx, arr) => (
                <div key={idx} className="flex items-start flex-1">
                  <div className="flex flex-col items-center flex-1 gap-1">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center border-2 transition-all ${
                      step.done ? "bg-emerald-500 border-emerald-500" :
                      step.alert ? "bg-red-500/20 border-red-500 animate-pulse" :
                      step.active ? "bg-amber-500/20 border-amber-500" :
                      "bg-muted/30 border-border"
                    }`}>
                      {step.done && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                      {step.alert && !step.done && <XCircle className="w-3.5 h-3.5 text-red-400" />}
                    </div>
                    <span className="text-xs font-medium text-center leading-tight mt-1">{step.label}</span>
                    <span className={`text-[10px] text-center leading-tight ${step.alert ? "text-red-400 font-medium" : step.active ? "text-amber-400" : "text-muted-foreground/60"}`}>
                      {step.sublabel}
                    </span>
                    {step.done && register && (() => {
                      const resultKey = idx === 2 ? register.year1ServiceResult : idx === 3 ? register.year2ServiceResult : idx === 4 ? register.year3ServiceResult : null;
                      if (!resultKey) return null;
                      return (
                        <Badge className={`text-[9px] mt-0.5 border-0 ${
                          resultKey === "pass" ? "bg-emerald-500/20 text-emerald-400" :
                          resultKey === "conditional_pass" ? "bg-amber-500/20 text-amber-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>{resultKey?.replace(/_/g, " ")}</Badge>
                      );
                    })()}
                  </div>
                  {idx < arr.length - 1 && (
                    <div className={`h-0.5 flex-shrink-0 w-full mt-3 ${step.done ? "bg-emerald-500/50" : "bg-border"}`} />
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Installation Details */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              Installation Details
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div><span className="text-muted-foreground">Film:</span> {inst.filmProduct || inst.filmType}</div>
              <div><span className="text-muted-foreground">Asset Type:</span> {inst.assetType?.replace(/_/g, " ")}</div>
              <div><span className="text-muted-foreground">Installed:</span> {formatDate(toDateString(inst.installedDate))}</div>
              <div><span className="text-muted-foreground">Installed By:</span> {inst.installedBy}</div>
              <div><span className="text-muted-foreground">Warranty End:</span> {formatDate(toDateString(inst.warrantyEndDate))}</div>
              {inst.batchNumber && <div><span className="text-muted-foreground">Batch:</span> {inst.batchNumber}</div>}
              {inst.rollNumber && <div><span className="text-muted-foreground">Roll:</span> {inst.rollNumber}</div>}
              {inst.installationJobNumber && <div><span className="text-muted-foreground">Job:</span> {inst.installationJobNumber}</div>}
              {inst.siteLocation && <div className="sm:col-span-2"><span className="text-muted-foreground">Site:</span> {inst.siteLocation.name} {inst.siteLocation.address}</div>}
              {inst.assetDescription && <div className="sm:col-span-2"><span className="text-muted-foreground">Description:</span> {inst.assetDescription}</div>}
            </div>
          </CardContent>
        </Card>

        {/* Warranty Status */}
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Warranty Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <span className="text-muted-foreground">Registration:</span>{" "}
                <Badge className={`text-xs border-0 ${
                  (inst.warrantyRegistration as any)?.status === "confirmed" ? "bg-emerald-500/20 text-emerald-400" :
                  (inst.warrantyRegistration as any)?.status === "overdue" ? "bg-red-500/20 text-red-400" :
                  "bg-amber-500/20 text-amber-400"
                }`}>{(inst.warrantyRegistration as any)?.status}</Badge>
              </div>
              {(inst.warrantyRegistration as any)?.apeaxRegistrationRef && (
                <div><span className="text-muted-foreground">APEAX Ref:</span> {(inst.warrantyRegistration as any).apeaxRegistrationRef}</div>
              )}
              <div><span className="text-muted-foreground">Reg Deadline:</span> {formatDate(toDateString((inst.warrantyRegistration as any)?.registrationDeadline))}</div>
              <div><span className="text-muted-foreground">Warranty Period:</span> {formatDate(toDateString(inst.warrantyStartDate))} — {formatDate(toDateString(inst.warrantyEndDate))}</div>
              {register && (
                <>
                  <div><span className="text-muted-foreground">Health:</span> <Badge className={`text-xs border ${HEALTH_COLORS[String(register.currentHealth)]}`}>{HEALTH_LABELS[String(register.currentHealth)]}</Badge></div>
                  <div><span className="text-muted-foreground">Claims:</span> {register.totalClaims} total, {register.openClaims} open</div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Service History */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4 text-primary" />
            Service History ({services.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {services.length === 0 ? (
            <p className="text-sm text-muted-foreground">No services recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {services.map((s, idx) => (
                <div key={idx} className="flex items-center justify-between rounded-md border border-border/30 bg-background/40 p-3 text-sm">
                  <div className="space-y-0.5">
                    <div className="font-medium">{s.serviceType?.replace(/_/g, " ")}</div>
                    <div className="text-muted-foreground">by {s.performedBy}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`text-xs border-0 ${
                      s.result === "pass" ? "bg-emerald-500/20 text-emerald-400" :
                      s.result === "conditional_pass" ? "bg-amber-500/20 text-amber-400" :
                      "bg-red-500/20 text-red-400"
                    }`}>{s.result?.replace(/_/g, " ")}</Badge>
                    {s.hydroguardApplied && <Badge variant="secondary" className="text-xs">HydroGuard</Badge>}
                    <span className="text-muted-foreground">{formatDate(s.serviceDate)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Inspection Records */}
      {inspections.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Inspection Records ({inspections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {inspections.map((insp) => {
              const vi = insp.visualInspection;
              return (
                <div key={insp.id} className="rounded-md border border-border/30 bg-background/40 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-medium">{insp.inspectionNumber}</span>
                      <Badge variant="outline" className="text-xs">{insp.inspectionType?.replace(/_/g, " ")}</Badge>
                      {insp.overallResult && (
                        <Badge className={`text-xs border-0 ${
                          insp.overallResult === "pass" ? "bg-emerald-500/20 text-emerald-400" :
                          insp.overallResult === "conditional_pass" ? "bg-amber-500/20 text-amber-400" :
                          "bg-red-500/20 text-red-400"
                        }`}>{insp.overallResult.replace(/_/g, " ")}</Badge>
                      )}
                      {insp.overallCondition && <Badge variant="secondary" className="text-xs">{insp.overallCondition}</Badge>}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {formatDate(toDateString(insp.inspectionDate))} — {insp.inspectedBy}
                    </div>
                  </div>

                  {/* Full QA Grid */}
                  {vi && (
                    <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
                      {Object.entries(QA_LABELS).map(([key, label]) => {
                        const criterion = vi[key as keyof typeof vi] as any;
                        if (!criterion) return null;
                        return (
                          <div key={key} className="flex items-center justify-between rounded border border-border/20 px-2.5 py-1.5 text-xs">
                            <span className="text-muted-foreground">{label}</span>
                            <div className="flex items-center gap-1.5">
                              <span className={
                                criterion.result === "pass" ? "text-emerald-400 font-medium" :
                                criterion.result === "fail" ? "text-red-400 font-medium" :
                                "text-amber-400 font-medium"
                              }>{criterion.result}</span>
                              {criterion.details && <span className="text-muted-foreground/60 max-w-[120px] truncate" title={criterion.details}>({criterion.details})</span>}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* HydroGuard */}
                  {insp.hydroguardService?.applied && (
                    <div className="text-xs text-muted-foreground flex gap-3 pt-1 border-t border-border/20">
                      <span className="text-emerald-400 font-medium">HydroGuard Applied</span>
                      {insp.hydroguardService.productUsed && <span>Product: {insp.hydroguardService.productUsed}</span>}
                      {insp.hydroguardService.coatsApplied && <span>{insp.hydroguardService.coatsApplied} coat(s)</span>}
                      {insp.hydroguardService.cureTimeMinutes && <span>{insp.hydroguardService.cureTimeMinutes}min cure</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Claims History */}
      {claims.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-primary" />
              Warranty Claims ({claims.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {claims.map((c, idx) => (
              <div key={idx} className="rounded-md border border-border/30 bg-background/40 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm">{c.claimNumber}</span>
                    <Badge variant="outline" className="text-xs">{c.claimStatus?.replace(/_/g, " ")}</Badge>
                    <Badge variant="secondary" className="text-xs">{c.severity}</Badge>
                    <Badge variant="secondary" className="text-xs">{c.claimType?.replace(/_/g, " ")}</Badge>
                  </div>
                  <span className="text-sm text-muted-foreground">{formatDate(c.claimDate)}</span>
                </div>
                <p className="text-sm">{c.description}</p>
                {(c.resolution || c.creditAmount) && (
                  <div className="flex gap-4 text-sm border-t border-border/20 pt-1">
                    {c.resolution && <span className="text-muted-foreground">Resolution: {c.resolution}</span>}
                    {c.creditAmount && <span className="text-emerald-400 font-medium">Credit: ${c.creditAmount}</span>}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Photos Gallery */}
      {allPhotos.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary" />
              Inspection Photos ({allPhotos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {allPhotos.map((photo, idx) => (
                <div key={idx} className="space-y-1">
                  <img src={photo.url} alt={photo.label} className="w-full h-24 rounded-lg object-cover border border-border/40" />
                  <p className="text-[10px] text-muted-foreground truncate">{photo.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Notes */}
      {inst.notes && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-4">
            <h4 className="text-sm font-semibold mb-1">Notes</h4>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{inst.notes}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
