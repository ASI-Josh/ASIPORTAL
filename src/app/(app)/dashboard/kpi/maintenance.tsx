"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { Plus, Wrench, DollarSign, TrendingUp, ClipboardList } from "lucide-react";
import type { MaintenanceEvent, ContactOrganization } from "@/lib/types";

interface MaintenanceTabProps {
  maintenanceEvents: MaintenanceEvent[];
  organizations: ContactOrganization[];
}

const EVENT_TYPES = [
  { value: "respray", label: "Respray" },
  { value: "major_repair", label: "Major Repair" },
  { value: "panel_replacement", label: "Panel Replacement" },
  { value: "film_replacement", label: "Film Replacement" },
  { value: "glass_replacement", label: "Glass Replacement" },
  { value: "other", label: "Other" },
] as const;

export function MaintenanceTab({ maintenanceEvents, organizations }: MaintenanceTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    organizationId: "",
    vehicleRegistration: "",
    eventDate: new Date().toISOString().slice(0, 10),
    eventType: "respray" as string,
    description: "",
    actualCost: "",
    replacementCostAvoided: "",
    jobNumber: "",
    performedBy: "",
    notes: "",
  });

  const totalActualCost = useMemo(() => {
    return maintenanceEvents.reduce((s, e) => s + (e.actualCost || 0), 0);
  }, [maintenanceEvents]);

  const totalCostAvoided = useMemo(() => {
    return maintenanceEvents.reduce((s, e) => s + (e.replacementCostAvoided || 0), 0);
  }, [maintenanceEvents]);

  const netSavings = useMemo(() => {
    return maintenanceEvents.reduce((s, e) => s + (e.costSavings || 0), 0);
  }, [maintenanceEvents]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.vehicleRegistration || !form.description) {
      toast({ title: "Missing fields", description: "Organisation, vehicle, and description are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);
    const actual = parseFloat(form.actualCost) || 0;
    const avoided = parseFloat(form.replacementCostAvoided) || 0;

    const event: Omit<MaintenanceEvent, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name || "",
      vehicleRegistration: form.vehicleRegistration.toUpperCase(),
      eventDate: form.eventDate,
      eventType: form.eventType as MaintenanceEvent["eventType"],
      description: form.description,
      actualCost: actual,
      replacementCostAvoided: avoided || undefined,
      costSavings: avoided > 0 ? avoided - actual : undefined,
      jobNumber: form.jobNumber || undefined,
      performedBy: form.performedBy || undefined,
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.MAINTENANCE_EVENTS), event);
      toast({ title: "Maintenance event logged" });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error saving event", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Events</CardTitle>
            <ClipboardList className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{maintenanceEvents.length}</div>
            <p className="text-xs text-muted-foreground">Maintenance events logged</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Actual Cost</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalActualCost.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Total maintenance spend</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cost Avoided</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCostAvoided.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Replacement cost avoided</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Net Savings</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">${netSavings.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Avoided minus actual</p>
          </CardContent>
        </Card>
      </div>

      {/* Events Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Maintenance Event Log</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Log Event</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Log Maintenance Event</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Organisation *</Label>
                    <Select value={form.organizationId} onValueChange={(v) => setForm({ ...form, organizationId: v })}>
                      <SelectTrigger><SelectValue placeholder="Select org" /></SelectTrigger>
                      <SelectContent>
                        {organizations.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Vehicle Rego *</Label>
                    <Input value={form.vehicleRegistration} onChange={(e) => setForm({ ...form, vehicleRegistration: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Event Date</Label>
                    <Input type="date" value={form.eventDate} onChange={(e) => setForm({ ...form, eventDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Event Type</Label>
                    <Select value={form.eventType} onValueChange={(v) => setForm({ ...form, eventType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Description *</Label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="e.g. Full bus respray — PaintShield delayed by 3 years" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Actual Cost ($)</Label>
                    <Input type="number" step="0.01" value={form.actualCost} onChange={(e) => setForm({ ...form, actualCost: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Replacement Cost Avoided ($)</Label>
                    <Input type="number" step="0.01" value={form.replacementCostAvoided} onChange={(e) => setForm({ ...form, replacementCostAvoided: e.target.value })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Job Number</Label>
                    <Input value={form.jobNumber} onChange={(e) => setForm({ ...form, jobNumber: e.target.value })} placeholder="e.g. JOB-2026-001" />
                  </div>
                  <div className="space-y-2">
                    <Label>Performed By</Label>
                    <Input value={form.performedBy} onChange={(e) => setForm({ ...form, performedBy: e.target.value })} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>
                <Button onClick={handleSubmit} className="w-full">Save Event</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {maintenanceEvents.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Wrench className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No maintenance events logged yet. Track respray delays, replacement costs avoided, and more.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="text-right">Actual Cost</TableHead>
                    <TableHead className="text-right">Cost Avoided</TableHead>
                    <TableHead className="text-right">Net Savings</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {maintenanceEvents.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell>{e.eventDate}</TableCell>
                      <TableCell className="font-medium">{e.vehicleRegistration}</TableCell>
                      <TableCell>{e.organizationName}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">
                          {e.eventType.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate">{e.description}</TableCell>
                      <TableCell className="text-right">${e.actualCost.toLocaleString()}</TableCell>
                      <TableCell className="text-right">
                        {e.replacementCostAvoided ? `$${e.replacementCostAvoided.toLocaleString()}` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {e.costSavings !== undefined ? (
                          <span className={e.costSavings > 0 ? "text-green-400" : ""}>
                            ${e.costSavings.toLocaleString()}
                          </span>
                        ) : "—"}
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
