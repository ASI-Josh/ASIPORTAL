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
import { Plus, Battery, MapPin, Zap, TrendingUp } from "lucide-react";
import type { ZebEnergyRecord, ContactOrganization } from "@/lib/types";

interface ZebTabProps {
  zebRecords: ZebEnergyRecord[];
  organizations: ContactOrganization[];
}

export function ZebTab({ zebRecords, organizations }: ZebTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    organizationId: "",
    vehicleRegistration: "",
    recordDate: new Date().toISOString().slice(0, 10),
    batteryCapacityKwh: "",
    energyConsumedKwh: "",
    rangeAchievedKm: "",
    rangeRatedKm: "",
    hvacEnergyKwh: "",
    hvacReductionKwh: "",
    ambientTempC: "",
    routeType: "urban" as string,
    notes: "",
  });

  const avgRangeExtension = useMemo(() => {
    const withExtension = zebRecords.filter((r) => r.rangeExtensionPercent);
    if (withExtension.length === 0) return null;
    return withExtension.reduce((s, r) => s + (r.rangeExtensionPercent || 0), 0) / withExtension.length;
  }, [zebRecords]);

  const totalHvacSaved = useMemo(() => {
    return zebRecords.reduce((s, r) => s + (r.hvacReductionKwh || 0), 0);
  }, [zebRecords]);

  const avgRangeAchieved = useMemo(() => {
    if (zebRecords.length === 0) return null;
    return zebRecords.reduce((s, r) => s + r.rangeAchievedKm, 0) / zebRecords.length;
  }, [zebRecords]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.vehicleRegistration || !form.batteryCapacityKwh) {
      toast({ title: "Missing fields", description: "Organisation, vehicle, and battery capacity are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);
    const rangeAchieved = parseFloat(form.rangeAchievedKm) || 0;
    const rangeRated = parseFloat(form.rangeRatedKm) || 0;
    const extensionKm = rangeRated > 0 ? rangeAchieved - rangeRated : undefined;
    const extensionPct = rangeRated > 0 && extensionKm ? (extensionKm / rangeRated) * 100 : undefined;

    const record: Omit<ZebEnergyRecord, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name || "",
      vehicleRegistration: form.vehicleRegistration.toUpperCase(),
      recordDate: form.recordDate,
      batteryCapacityKwh: parseFloat(form.batteryCapacityKwh),
      energyConsumedKwh: parseFloat(form.energyConsumedKwh) || 0,
      rangeAchievedKm: rangeAchieved,
      rangeRatedKm: rangeRated,
      rangeExtensionKm: extensionKm && extensionKm > 0 ? Number(extensionKm.toFixed(1)) : undefined,
      rangeExtensionPercent: extensionPct && extensionPct > 0 ? Number(extensionPct.toFixed(2)) : undefined,
      hvacEnergyKwh: parseFloat(form.hvacEnergyKwh) || undefined,
      hvacReductionKwh: parseFloat(form.hvacReductionKwh) || undefined,
      ambientTempC: parseFloat(form.ambientTempC) || undefined,
      routeType: form.routeType as ZebEnergyRecord["routeType"],
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.ZEB_ENERGY_RECORDS), record);
      toast({ title: "ZEB energy record added" });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error saving record", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">
            <span className="font-semibold text-blue-400">ZEB Integration (P2)</span> — Track battery consumption, range extension from reduced HVAC draw, and RadShield thermal impact on zero-emission bus fleets. Future-proofing for electric bus transition.
          </p>
        </CardContent>
      </Card>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Records</CardTitle>
            <Battery className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{zebRecords.length}</div>
            <p className="text-xs text-muted-foreground">ZEB energy records</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Range</CardTitle>
            <MapPin className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgRangeAchieved !== null ? `${avgRangeAchieved.toFixed(0)} km` : "—"}</div>
            <p className="text-xs text-muted-foreground">Average range achieved</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Range Extension</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgRangeExtension !== null ? `+${avgRangeExtension.toFixed(1)}%` : "—"}</div>
            <p className="text-xs text-muted-foreground">From RadShield HVAC reduction</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">HVAC Energy Saved</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalHvacSaved.toFixed(1)} kWh</div>
            <p className="text-xs text-muted-foreground">Total HVAC reduction</p>
          </CardContent>
        </Card>
      </div>

      {/* ZEB Records Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">ZEB Energy Records</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Record</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add ZEB Energy Record</DialogTitle>
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
                    <Label>Date</Label>
                    <Input type="date" value={form.recordDate} onChange={(e) => setForm({ ...form, recordDate: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Route Type</Label>
                    <Select value={form.routeType} onValueChange={(v) => setForm({ ...form, routeType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urban">Urban</SelectItem>
                        <SelectItem value="suburban">Suburban</SelectItem>
                        <SelectItem value="highway">Highway</SelectItem>
                        <SelectItem value="mixed">Mixed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Battery &amp; Range</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Battery Capacity (kWh) *</Label>
                      <Input type="number" step="0.1" value={form.batteryCapacityKwh} onChange={(e) => setForm({ ...form, batteryCapacityKwh: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Energy Consumed (kWh)</Label>
                      <Input type="number" step="0.1" value={form.energyConsumedKwh} onChange={(e) => setForm({ ...form, energyConsumedKwh: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Range Achieved (km)</Label>
                      <Input type="number" step="0.1" value={form.rangeAchievedKm} onChange={(e) => setForm({ ...form, rangeAchievedKm: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Range Rated (km)</Label>
                      <Input type="number" step="0.1" value={form.rangeRatedKm} onChange={(e) => setForm({ ...form, rangeRatedKm: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">HVAC Impact</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>HVAC Energy (kWh)</Label>
                      <Input type="number" step="0.1" value={form.hvacEnergyKwh} onChange={(e) => setForm({ ...form, hvacEnergyKwh: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>HVAC Reduction (kWh)</Label>
                      <Input type="number" step="0.1" value={form.hvacReductionKwh} onChange={(e) => setForm({ ...form, hvacReductionKwh: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Ambient Temp (°C)</Label>
                  <Input type="number" step="0.1" value={form.ambientTempC} onChange={(e) => setForm({ ...form, ambientTempC: e.target.value })} />
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>

                <Button onClick={handleSubmit} className="w-full">Save Record</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {zebRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Battery className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No ZEB energy records yet. Start tracking electric bus battery and range data.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead className="text-right">Battery (kWh)</TableHead>
                    <TableHead className="text-right">Consumed (kWh)</TableHead>
                    <TableHead className="text-right">Range (km)</TableHead>
                    <TableHead className="text-right">Extension</TableHead>
                    <TableHead>Route</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {zebRecords.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.recordDate}</TableCell>
                      <TableCell className="font-medium">{r.vehicleRegistration}</TableCell>
                      <TableCell>{r.organizationName}</TableCell>
                      <TableCell className="text-right">{r.batteryCapacityKwh}</TableCell>
                      <TableCell className="text-right">{r.energyConsumedKwh}</TableCell>
                      <TableCell className="text-right">{r.rangeAchievedKm} / {r.rangeRatedKm}</TableCell>
                      <TableCell className="text-right">
                        {r.rangeExtensionPercent ? (
                          <Badge variant="default">+{r.rangeExtensionPercent.toFixed(1)}%</Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs capitalize">{r.routeType || "—"}</Badge>
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
