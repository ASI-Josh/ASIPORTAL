"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import {
  ChevronLeft,
  ClipboardCheck,
  Clock,
  FileText,
  Image as ImageIcon,
  Mail,
  ListChecks,
} from "lucide-react";

import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import type { DamageReportItem, Inspection, VehicleReport } from "@/lib/types";
import { BOOKING_TYPE_LABELS, calculateCostBreakdown } from "@/lib/types";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type SummaryLineItem = {
  id: string;
  vehicleLabel: string;
  damage: DamageReportItem;
  labourCost: number;
  materialsCost: number;
  totalCost: number;
  downtimeHours: number;
};

function formatCurrency(value: number | undefined | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "TBC";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function formatHours(hours: number) {
  const rounded = Math.round(hours * 10) / 10;
  const unit = rounded === 1 ? "hour" : "hours";
  return `${rounded.toString().replace(/\.0$/, "")} ${unit}`;
}

function getVehicleLabel(report: VehicleReport, index: number) {
  return (
    report.vehicle?.registration ||
    report.vehicle?.fleetAssetNumber ||
    report.vehicle?.vin ||
    `Vehicle ${index + 1}`
  );
}

function getDamageTotalCost(damage: DamageReportItem) {
  if (typeof damage.totalCost === "number" && Number.isFinite(damage.totalCost)) return damage.totalCost;
  if (typeof damage.estimatedCost === "number" && Number.isFinite(damage.estimatedCost)) return damage.estimatedCost;
  return 0;
}

function getDamageDowntimeHours(damage: DamageReportItem) {
  return typeof damage.estimatedDowntimeHours === "number" && damage.estimatedDowntimeHours > 0
    ? damage.estimatedDowntimeHours
    : 0;
}

export default function ClientInspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [vehicleReports, setVehicleReports] = useState<VehicleReport[]>([]);
  const [activePhoto, setActivePhoto] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    if (!id || !user?.organizationId) return;
    const ref = doc(db, COLLECTIONS.INSPECTIONS, id);
    const unsubscribe = onSnapshot(
      ref,
      (snapshot) => {
        if (!snapshot.exists()) {
          setInspection(null);
          return;
        }
        const data = { id: snapshot.id, ...(snapshot.data() as Omit<Inspection, "id">) };
        setInspection(data);
      },
      () => setInspection(null)
    );
    return () => unsubscribe();
  }, [id, user?.organizationId]);

  useEffect(() => {
    if (!inspection) return;
    setVehicleReports(Array.isArray(inspection.vehicleReports) ? inspection.vehicleReports : []);
  }, [inspection]);

  const summaryItems = useMemo<SummaryLineItem[]>(
    () =>
      vehicleReports.flatMap((report, reportIndex) => {
        const vehicleLabel = getVehicleLabel(report, reportIndex);
        const damages = Array.isArray(report.damages) ? report.damages : [];
        return damages.map((damage, damageIndex) => ({
          ...(() => {
            const totalCost = getDamageTotalCost(damage);
            const fallback = calculateCostBreakdown(totalCost);
            const labourCost =
              typeof damage.labourCost === "number" && Number.isFinite(damage.labourCost)
                ? damage.labourCost
                : fallback.labourCost;
            const materialsCost =
              typeof damage.materialsCost === "number" && Number.isFinite(damage.materialsCost)
                ? damage.materialsCost
                : fallback.materialsCost;
            return { totalCost, labourCost, materialsCost };
          })(),
          id: `${report.vehicleId}-${damage.id || damageIndex}`,
          vehicleLabel,
          damage,
          downtimeHours: getDamageDowntimeHours(damage),
        }));
      }),
    [vehicleReports]
  );

  const totals = useMemo(
    () =>
      summaryItems.reduce(
        (acc, item) => ({
          totalLabour: acc.totalLabour + item.labourCost,
          totalMaterials: acc.totalMaterials + item.materialsCost,
          totalCost: acc.totalCost + item.totalCost,
          totalDowntimeHours: acc.totalDowntimeHours + item.downtimeHours,
        }),
        { totalLabour: 0, totalMaterials: 0, totalCost: 0, totalDowntimeHours: 0 }
      ),
    [summaryItems]
  );

  const fallbackDowntimeText = useMemo(() => {
    const estimated = inspection?.estimatedDowntime;
    if (!estimated || typeof estimated.value !== "number" || estimated.value <= 0) return "Not provided";
    const unit = estimated.unit === "days" ? (estimated.value === 1 ? "day" : "days") : estimated.value === 1 ? "hour" : "hours";
    return `${estimated.value} ${unit}`;
  }, [inspection?.estimatedDowntime]);

  const worksDowntimeText =
    totals.totalDowntimeHours > 0 ? formatHours(totals.totalDowntimeHours) : fallbackDowntimeText;

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ClipboardCheck className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Inspection Not Found</h2>
        <p className="text-muted-foreground">We could not find this inspection.</p>
        <Button onClick={() => router.push("/client/inspections")}>
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back to inspections
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Dialog open={Boolean(activePhoto)} onOpenChange={(open) => !open && setActivePhoto(null)}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{activePhoto?.label || "Inspection photo"}</DialogTitle>
          </DialogHeader>
          {activePhoto && (
            <img
              src={activePhoto.url}
              alt={activePhoto.label}
              className="w-full rounded-lg object-contain max-h-[75vh]"
            />
          )}
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.back()} className="w-fit">
          <ChevronLeft className="mr-2 h-4 w-4" />
          Back
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-3xl font-headline font-bold tracking-tight">{inspection.inspectionNumber}</h2>
            <p className="text-muted-foreground">
              Review sequence: 1) Summary 2) Photos 3) Reply by email to approve.
            </p>
          </div>
          <Badge variant="secondary">{inspection.status}</Badge>
        </div>
      </div>

      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="p-4 space-y-2 text-sm">
          <div className="flex items-center gap-2 font-medium">
            <FileText className="h-4 w-4 text-primary" />
            Quote delivery
          </div>
          <p className="text-muted-foreground">
            To approve works, reply to the quote email confirming approved scope, PO/Works Order Number, and your
            allocated date/time for works.
          </p>
          <div className="flex flex-wrap gap-2">
            {inspection.quote?.file?.downloadUrl && (
              <Button asChild size="sm" variant="outline">
                <Link href={inspection.quote.file.downloadUrl} target="_blank" rel="noreferrer">
                  Download quote PDF
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="outline">
              <a
                href={`mailto:${inspection.clientEmail || ""}?subject=${encodeURIComponent(
                  `Approval: ${inspection.inspectionNumber}`
                )}&body=${encodeURIComponent(
                  [
                    `Inspection reference: ${inspection.inspectionNumber}`,
                    "",
                    "Approved scope of works:",
                    "- ",
                    "",
                    "PO/Works Order Number:",
                    "- ",
                    "",
                    "Allocated works date/time:",
                    "- ",
                  ].join("\n")
                )}`}
              >
                <Mail className="mr-2 h-4 w-4" />
                Reply with approval details
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="summary">1. Summary</TabsTrigger>
          <TabsTrigger value="photos">2. Photos</TabsTrigger>
          <TabsTrigger value="approval">3. Approval</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader className="pb-1">
              <CardTitle className="flex items-center gap-2 text-base">
                <ListChecks className="h-4 w-4 text-primary" />
                Inspection Cost Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-md border border-border/40 bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">Inspection schedule</div>
                  <div className="font-medium">
                    {inspection.scheduledDate?.toDate
                      ? `${inspection.scheduledDate.toDate().toLocaleDateString("en-AU")} ${inspection.scheduledTime || ""}`.trim()
                      : "Not scheduled"}
                  </div>
                </div>
                <div className="rounded-md border border-border/40 bg-muted/20 p-3">
                  <div className="text-xs text-muted-foreground">Items</div>
                  <div className="font-medium">{summaryItems.length}</div>
                </div>
                <div className="rounded-md border border-primary/30 bg-primary/10 p-3">
                  <div className="text-xs text-muted-foreground">Works Downtime Allocation Required</div>
                  <div className="font-medium">{worksDowntimeText}</div>
                </div>
              </div>

              {summaryItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No damage line items were provided on this inspection.</p>
              ) : (
                <div className="space-y-2">
                  {summaryItems.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border/40 bg-background/40 p-3"
                    >
                      <div className="space-y-1">
                        <div className="text-sm font-medium">
                          {item.vehicleLabel} - {BOOKING_TYPE_LABELS[item.damage.repairType]} - {item.damage.location || "-"}
                        </div>
                        {item.damage.description ? (
                          <p className="text-xs text-muted-foreground">{item.damage.description}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          Labour {formatCurrency(item.labourCost)} | Materials {formatCurrency(item.materialsCost)}
                          {item.downtimeHours > 0 ? ` | Downtime ${formatHours(item.downtimeHours)}` : ""}
                        </p>
                      </div>
                      <div className="text-sm font-semibold">{formatCurrency(item.totalCost)}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="rounded-md border border-primary/40 bg-primary/10 p-3">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Total Labour</p>
                    <p className="text-base font-semibold">{formatCurrency(totals.totalLabour)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Materials</p>
                    <p className="text-base font-semibold">{formatCurrency(totals.totalMaterials)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Total Estimated Cost</p>
                    <p className="text-base font-semibold">{formatCurrency(totals.totalCost)}</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="photos" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <ImageIcon className="h-4 w-4 text-primary" />
                Inspection photos (click to enlarge)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {summaryItems.every((item) => {
                const pre = Array.isArray(item.damage.preWorkPhotos) ? item.damage.preWorkPhotos : [];
                const fallback = Array.isArray(item.damage.photoUrls) ? item.damage.photoUrls : [];
                return [...pre, ...fallback].length === 0;
              }) ? (
                <p className="text-sm text-muted-foreground">No inspection photos available.</p>
              ) : (
                summaryItems.map((item) => {
                  const pre = Array.isArray(item.damage.preWorkPhotos) ? item.damage.preWorkPhotos : [];
                  const fallback = Array.isArray(item.damage.photoUrls) ? item.damage.photoUrls : [];
                  const photos = Array.from(new Set([...pre, ...fallback]));
                  if (photos.length === 0) return null;
                  const label = `${item.vehicleLabel} - ${BOOKING_TYPE_LABELS[item.damage.repairType]} - ${item.damage.location}`;
                  return (
                    <div key={`photos-${item.id}`} className="space-y-2">
                      <div className="text-sm font-medium">{label}</div>
                      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4">
                        {photos.map((url, index) => (
                          <button
                            key={`${item.id}-${index}`}
                            type="button"
                            onClick={() => setActivePhoto({ url, label })}
                            className="group relative overflow-hidden rounded-lg border border-border/40 bg-muted/20"
                          >
                            <img
                              src={url}
                              alt={`${label} photo ${index + 1}`}
                              className="h-32 w-full object-cover transition group-hover:scale-105"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="approval" className="space-y-4">
          <Card className="bg-card/50 backdrop-blur-lg border-border/20">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Mail className="h-4 w-4 text-primary" />
                Reply by email to approve
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">
                Reply to the quote email and include all details below so ASI can schedule the works.
              </p>
              <ol className="space-y-2 list-decimal pl-5">
                <li>Confirm approved scope of works (full or partial line items).</li>
                <li>Provide your PO/Works Order Number.</li>
                <li>Provide your allocated works date and time window.</li>
              </ol>
              <div className="rounded-md border border-border/50 bg-muted/30 p-3">
                <div className="font-medium">Inspection reference</div>
                <div className="text-muted-foreground">{inspection.inspectionNumber}</div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
