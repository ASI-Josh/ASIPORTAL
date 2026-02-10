"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Timestamp, doc, onSnapshot, updateDoc } from "firebase/firestore";
import { CheckCircle, ChevronLeft, ClipboardCheck, Clock, Image as ImageIcon } from "lucide-react";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import type { Inspection, VehicleReport } from "@/lib/types";
import { BOOKING_TYPE_LABELS } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ClientDecision = "pending" | "approved" | "rejected";

function getDecisionLabel(decision: ClientDecision) {
  if (decision === "approved") return "Approved";
  if (decision === "rejected") return "Rejected";
  return "Pending";
}

function computeApprovalStatus(reports: VehicleReport[]) {
  const damages = reports.flatMap((report) => report.damages || []);
  if (damages.length === 0) return "pending";
  const approved = damages.filter((damage) => damage.clientDecision === "approved").length;
  const rejected = damages.filter((damage) => damage.clientDecision === "rejected").length;
  if (approved === damages.length) return "approved";
  if (rejected === damages.length) return "rejected";
  if (approved > 0 || rejected > 0) return "partial";
  return "pending";
}

export default function ClientInspectionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [vehicleReports, setVehicleReports] = useState<VehicleReport[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [schedulingNote, setSchedulingNote] = useState("");
  const [vehicleJobRefs, setVehicleJobRefs] = useState<Record<string, string>>({});
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
    const nextReports = inspection.vehicleReports.map((report) => ({
      ...report,
      damages: report.damages.map((damage) => ({
        ...damage,
        clientDecision: (damage.clientDecision as ClientDecision) || "pending",
      })),
    }));
    setVehicleReports(nextReports);
    setSchedulingNote((inspection as any).clientSchedulingNote || "");
    setVehicleJobRefs((inspection as any).clientVehicleJobRefs || {});
  }, [inspection]);

  const approvalStatus = useMemo(
    () => computeApprovalStatus(vehicleReports),
    [vehicleReports]
  );

  const handleDecisionChange = (
    vehicleId: string,
    damageId: string,
    decision: ClientDecision
  ) => {
    setVehicleReports((prev) =>
      prev.map((report) => {
        if (report.vehicleId !== vehicleId) return report;
        return {
          ...report,
          damages: report.damages.map((damage) =>
            damage.id === damageId ? { ...damage, clientDecision: decision } : damage
          ),
        };
      })
    );
  };

  const handleDecisionNotes = (vehicleId: string, damageId: string, notes: string) => {
    setVehicleReports((prev) =>
      prev.map((report) => {
        if (report.vehicleId !== vehicleId) return report;
        return {
          ...report,
          damages: report.damages.map((damage) =>
            damage.id === damageId ? { ...damage, clientDecisionNotes: notes } : damage
          ),
        };
      })
    );
  };

  const handleSaveApprovals = async () => {
    if (!inspection) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, COLLECTIONS.INSPECTIONS, inspection.id), {
        vehicleReports,
        clientApprovalStatus: approvalStatus,
        clientApprovalUpdatedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        clientSchedulingNote: schedulingNote,
        clientVehicleJobRefs: vehicleJobRefs,
      });
      toast({
        title: "Approvals saved",
        description: "Your approval selections have been saved.",
      });
    } catch (error: any) {
      toast({
        title: "Save failed",
        description: error.message || "Unable to save approvals.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitApprovals = async () => {
    if (!inspection || !firebaseUser) return;
    setSubmitting(true);
    try {
      await handleSaveApprovals();
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/client/approve-inspection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inspectionId: inspection.id,
          approvalStatus,
          clientSchedulingNote: schedulingNote,
          clientVehicleJobRefs: vehicleJobRefs,
        }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || "Unable to submit approval.");
      }
      toast({
        title: "RFQ approved",
        description: "ASI has been notified and the job is now queued for scheduling.",
      });
    } catch (error: any) {
      toast({
        title: "Submission failed",
        description: error.message || "Unable to submit approval.",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (!inspection) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <ClipboardCheck className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Inspection Not Found</h2>
        <p className="text-muted-foreground">We couldn’t find this inspection.</p>
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
      <div className="flex items-center justify-between">
        <div>
          <Button variant="ghost" size="sm" onClick={() => router.back()}>
            <ChevronLeft className="mr-2 h-4 w-4" />
            Back
          </Button>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            {inspection.inspectionNumber}
          </h2>
          <p className="text-muted-foreground">
            Approve or reject each repair item per vehicle.
          </p>
        </div>
        <Badge variant="secondary">{inspection.status}</Badge>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <Badge variant="outline">Approval: {approvalStatus}</Badge>
        <span className="text-muted-foreground">Vehicles: {vehicleReports.length}</span>
      </div>

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
                ? ` → ${inspection.finishDate.toDate().toLocaleDateString("en-AU")} ${inspection.finishTime}`.trim()
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
            {report.damages.some((damage) => damage.clientDecision === "approved") && (
              <div className="rounded-lg border border-border/40 bg-background/50 p-3">
                <Label className="text-xs text-muted-foreground">Client Job Number</Label>
                <Input
                  value={vehicleJobRefs[report.vehicleId] || ""}
                  onChange={(event) =>
                    setVehicleJobRefs((prev) => ({
                      ...prev,
                      [report.vehicleId]: event.target.value,
                    }))
                  }
                  placeholder="Optional reference for approved vehicle work"
                />
              </div>
            )}
            {report.damages.map((damage) => (
              <Card key={damage.id} className="bg-background/50 border-border/50">
                <CardContent className="p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium">
                        {BOOKING_TYPE_LABELS[damage.repairType]} • {damage.location}
                      </p>
                      <p className="text-sm text-muted-foreground">{damage.description}</p>
                    </div>
                    <Badge variant="outline">
                      {damage.totalCost ? `$${damage.totalCost.toFixed(2)}` : "TBC"}
                    </Badge>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label className="text-xs text-muted-foreground">Decision</Label>
                      <Select
                        value={(damage.clientDecision as ClientDecision) || "pending"}
                        onValueChange={(value) =>
                          handleDecisionChange(report.vehicleId, damage.id, value as ClientDecision)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(["pending", "approved", "rejected"] as ClientDecision[]).map(
                            (value) => (
                              <SelectItem key={value} value={value}>
                                {getDecisionLabel(value)}
                              </SelectItem>
                            )
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                      <Textarea
                        value={damage.clientDecisionNotes || ""}
                        onChange={(event) =>
                          handleDecisionNotes(report.vehicleId, damage.id, event.target.value)
                        }
                        placeholder="Add any notes for this repair item"
                        className="min-h-[90px]"
                      />
                    </div>
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

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Scheduling notes</CardTitle>
        </CardHeader>
        <CardContent>
          <Textarea
            value={schedulingNote}
            onChange={(event) => setSchedulingNote(event.target.value)}
            placeholder="Tell ASI your preferred dates/times or availability."
            className="min-h-[120px]"
          />
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={handleSaveApprovals} disabled={saving}>
          {saving ? "Saving..." : "Save approvals"}
        </Button>
        <Button onClick={handleSubmitApprovals} disabled={submitting}>
          <CheckCircle className="mr-2 h-4 w-4" />
          {submitting ? "Submitting..." : "Submit approvals"}
        </Button>
      </div>
    </div>
  );
}
