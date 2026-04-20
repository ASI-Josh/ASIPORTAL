"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { Wrench } from "lucide-react";
import type { Job, MaintenanceEvent } from "@/lib/types";

const EVENT_TYPES = [
  { value: "respray", label: "Respray" },
  { value: "major_repair", label: "Major Repair" },
  { value: "panel_replacement", label: "Panel Replacement" },
  { value: "film_replacement", label: "Film Replacement" },
  { value: "glass_replacement", label: "Glass Replacement" },
  { value: "other", label: "Other" },
] as const;

interface LogMaintenanceDialogProps {
  job: Job;
}

export function LogMaintenanceDialog({ job }: LogMaintenanceDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const defaultVehicleRego = useMemo(() => {
    const jv = job.jobVehicles?.[0];
    if (jv?.registration) return jv.registration;
    const v = job.vehicles?.[0];
    if (v && "registration" in v) return (v as { registration?: string }).registration || "";
    return "";
  }, [job]);

  const totalJobCost = useMemo(() => {
    return (job.jobVehicles || []).reduce((sum, jv) => sum + (jv.totalCost || 0), 0);
  }, [job]);

  const [form, setForm] = useState({
    vehicleRegistration: defaultVehicleRego,
    eventDate: new Date().toISOString().slice(0, 10),
    eventType: "other" as MaintenanceEvent["eventType"],
    description: job.jobDescription || "",
    actualCost: totalJobCost ? String(totalJobCost) : "",
    replacementCostAvoided: "",
    performedBy: "",
    notes: "",
  });

  const handleSubmit = async () => {
    if (!job.organizationId) {
      toast({ title: "Missing organisation", description: "This job has no linked organisation; cannot log KPI event.", variant: "destructive" });
      return;
    }
    if (!form.vehicleRegistration || !form.description) {
      toast({ title: "Missing fields", description: "Vehicle rego and description are required.", variant: "destructive" });
      return;
    }

    const actual = parseFloat(form.actualCost) || 0;
    const avoided = parseFloat(form.replacementCostAvoided) || 0;

    const event: Omit<MaintenanceEvent, "id"> = {
      organizationId: job.organizationId,
      organizationName: job.clientName,
      vehicleRegistration: form.vehicleRegistration.toUpperCase(),
      eventDate: form.eventDate,
      eventType: form.eventType,
      description: form.description,
      actualCost: actual,
      replacementCostAvoided: avoided || undefined,
      costSavings: avoided > 0 ? avoided - actual : undefined,
      jobId: job.id,
      jobNumber: job.jobNumber,
      performedBy: form.performedBy || undefined,
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.MAINTENANCE_EVENTS), event);
      toast({ title: "Maintenance event logged", description: "Linked to KPI Traceability." });
      setOpen(false);
    } catch (err) {
      toast({ title: "Error saving event", description: String(err), variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Wrench className="mr-2 h-4 w-4" />
          Log KPI Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log Maintenance Event for KPI Traceability</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <p className="text-sm text-muted-foreground">
            Captures this completed job into the Maintenance KPI so replacement-cost-avoided rolls up to {job.clientName}&apos;s dashboard.
          </p>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Vehicle Registration *</Label>
              <Input value={form.vehicleRegistration} onChange={(e) => setForm({ ...form, vehicleRegistration: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Event Date</Label>
              <Input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Event Type</Label>
              <Select value={form.eventType} onValueChange={(v) => setForm({ ...form, eventType: v as MaintenanceEvent["eventType"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {EVENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Performed By</Label>
              <Input value={form.performedBy} onChange={(e) => setForm({ ...form, performedBy: e.target.value })} placeholder="Technician name" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Description *</Label>
            <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Actual Cost ($)</Label>
              <Input type="number" step="0.01" value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: e.target.value })} />
              <p className="text-xs text-muted-foreground">Pre-filled from job cost breakdown</p>
            </div>
            <div className="space-y-2">
              <Label>Replacement Cost Avoided ($)</Label>
              <Input type="number" step="0.01" value={form.replacementCostAvoided} onChange={(e) => setForm({ ...form, replacementCostAvoided: e.target.value })} placeholder="What full replacement would have cost" />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>

          <Button onClick={handleSubmit} className="w-full">Log Event</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
