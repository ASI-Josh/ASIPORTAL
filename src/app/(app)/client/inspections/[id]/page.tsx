"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { ChevronLeft, ClipboardCheck, Clock, Image as ImageIcon, FileText } from "lucide-react";

import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import type { Inspection, VehicleReport } from "@/lib/types";
import { BOOKING_TYPE_LABELS } from "@/lib/types";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function formatCurrency(value: number | undefined | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "TBC";
  try {
    return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

export default function ClientInspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [vehicleReports, setVehicleReports] = useState<VehicleReport[]>([]);
  const [activePhoto, setActivePhoto] = useState<string | null>(null);

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

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ClipboardCheck className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Inspection Not Found</h2>
        <p className="text-muted-foreground">We couldnâ€™t find this inspection.</p>
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
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Inspection Photo</DialogTitle>
          </DialogHeader>
          {activePhoto && (
            <img
              src={activePhoto}
              alt="Inspection photo"
              className="w-full rounded-lg object-contain max-h-[70vh]"
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
            <h2 className="text-3xl font-headline font-bold tracking-tight">
              {inspection.inspectionNumber}
            </h2>
            <p className="text-muted-foreground">
              This inspection report is read-only. Quotes and approvals are handled via email.
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
            To approve works, reply to the quote email confirming the scope you approve (you may
            approve partial items) and your booked-out dates/times.
          </p>
          {inspection.quote?.file?.downloadUrl && (
            <Button asChild size="sm" variant="outline">
              <Link href={inspection.quote.file.downloadUrl} target="_blank" rel="noreferrer">
                Download quote PDF
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="h-4 w-4 text-primary" />
            Schedule & downtime
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <div className="text-xs text-muted-foreground">Inspection schedule</div>
            <div className="font-medium">
              {inspection.scheduledDate?.toDate
                ? `${inspection.scheduledDate.toDate().toLocaleDateString("en-AU")} ${inspection.scheduledTime || ""}`.trim()
                : "Not scheduled"}
              {inspection.finishDate?.toDate && inspection.finishTime
                ? ` â†’ ${inspection.finishDate.toDate().toLocaleDateString("en-AU")} ${inspection.finishTime}`.trim()
                : ""}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Estimated downtime (works)</div>
            <div className="font-medium">
              {inspection.estimatedDowntime
                ? `${inspection.estimatedDowntime.value} ${inspection.estimatedDowntime.unit === "hours"
                    ? inspection.estimatedDowntime.value === 1
                      ? "hour"
                      : "hours"
                    : inspection.estimatedDowntime.value === 1
                      ? "day"
                      : "days"}`.trim()
                : "Not provided"}
            </div>
          </div>
        </CardContent>
      </Card>

      {vehicleReports.map((report) => (
        <Card key={report.vehicleId} className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              {report.vehicle?.registration ||
                report.vehicle?.fleetAssetNumber ||
                report.vehicle?.vin ||
                "Vehicle"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.damages.map((damage) => (
              <Card key={damage.id} className="bg-background/50 border-border/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {BOOKING_TYPE_LABELS[damage.repairType]} â€¢ {damage.location}
                      </p>
                      <p className="text-sm text-muted-foreground">{damage.description}</p>
                      {typeof damage.estimatedDowntimeHours === "number" &&
                      damage.estimatedDowntimeHours > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Est. downtime:{" "}
                          {(Math.round(damage.estimatedDowntimeHours * 10) / 10)
                            .toString()
                            .replace(/\\.0$/, "")}{" "}
                          hrs
                        </p>
                      ) : null}
                    </div>
                    <Badge variant="outline">{formatCurrency(damage.totalCost)}</Badge>
                  </div>

                  {damage.preWorkPhotos?.length ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <ImageIcon className="h-3.5 w-3.5" />
                        Before photos
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        {damage.preWorkPhotos.map((url) => (
                          <button
                            key={url}
                            type="button"
                            onClick={() => setActivePhoto(url)}
                            className="group relative overflow-hidden rounded-lg border border-border/40 bg-muted/20"
                          >
                            <img
                              src={url}
                              alt="Before repair"
                              className="h-28 w-full object-cover transition group-hover:scale-105"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
