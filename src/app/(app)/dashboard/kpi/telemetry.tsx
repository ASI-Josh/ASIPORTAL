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
import { Plus, Thermometer, Gauge, Zap, AlertCircle } from "lucide-react";
import type { TelemetryReading, ContactOrganization } from "@/lib/types";

interface TelemetryTabProps {
  telemetryReadings: TelemetryReading[];
  organizations: ContactOrganization[];
}

export function TelemetryTab({ telemetryReadings, organizations }: TelemetryTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    organizationId: "",
    vehicleRegistration: "",
    readingDate: new Date().toISOString().slice(0, 10),
    readingSource: "manual" as string,
    // Compressor
    dutyCyclePercent: "",
    runHoursTotal: "",
    tempDeltaCabin: "",
    // Electrical
    totalSystemLoadKw: "",
    alternatorReductionKw: "",
    // Temperature
    ambientTempC: "",
    cabinTempPreC: "",
    cabinTempPostC: "",
    // Component lifecycle
    compressorHoursTotal: "",
    estimatedLifeHours: "12000",
    notes: "",
  });

  // Summary stats
  const avgDutyCycle = useMemo(() => {
    const readings = telemetryReadings.filter((r) => r.compressor?.dutyCyclePercent);
    if (readings.length === 0) return null;
    return readings.reduce((s, r) => s + (r.compressor?.dutyCyclePercent || 0), 0) / readings.length;
  }, [telemetryReadings]);

  const avgTempDelta = useMemo(() => {
    const readings = telemetryReadings.filter((r) => r.temperature?.deltaTempC);
    if (readings.length === 0) return null;
    return readings.reduce((s, r) => s + (r.temperature?.deltaTempC || 0), 0) / readings.length;
  }, [telemetryReadings]);

  const criticalAlerts = useMemo(() => {
    return telemetryReadings.filter(
      (r) => r.componentLifecycle?.alertLevel === "critical" || r.componentLifecycle?.alertLevel === "warning"
    );
  }, [telemetryReadings]);

  const avgElectricalReduction = useMemo(() => {
    const readings = telemetryReadings.filter((r) => r.electrical?.alternatorReductionKw);
    if (readings.length === 0) return null;
    return readings.reduce((s, r) => s + (r.electrical?.alternatorReductionKw || 0), 0) / readings.length;
  }, [telemetryReadings]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.vehicleRegistration) {
      toast({ title: "Missing fields", description: "Organisation and vehicle rego are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);

    const cabinPre = parseFloat(form.cabinTempPreC) || undefined;
    const cabinPost = parseFloat(form.cabinTempPostC) || undefined;
    const compHours = parseFloat(form.compressorHoursTotal) || undefined;
    const estLife = parseFloat(form.estimatedLifeHours) || undefined;
    const remainingPct = compHours && estLife ? Math.max(0, ((estLife - compHours) / estLife) * 100) : undefined;

    const reading: Omit<TelemetryReading, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name,
      vehicleRegistration: form.vehicleRegistration.toUpperCase(),
      readingDate: form.readingDate,
      readingSource: form.readingSource as TelemetryReading["readingSource"],
      compressor: form.dutyCyclePercent ? {
        dutyCyclePercent: parseFloat(form.dutyCyclePercent),
        runHoursTotal: parseFloat(form.runHoursTotal) || 0,
        tempDeltaCabin: parseFloat(form.tempDeltaCabin) || 0,
      } : undefined,
      electrical: form.totalSystemLoadKw ? {
        totalSystemLoadKw: parseFloat(form.totalSystemLoadKw),
        alternatorReductionKw: parseFloat(form.alternatorReductionKw) || undefined,
      } : undefined,
      temperature: cabinPre && cabinPost ? {
        ambientTempC: parseFloat(form.ambientTempC) || 0,
        cabinTempPreC: cabinPre,
        cabinTempPostC: cabinPost,
        deltaTempC: cabinPre - cabinPost,
      } : undefined,
      componentLifecycle: compHours ? {
        compressorHoursTotal: compHours,
        estimatedLifeHours: estLife || 12000,
        remainingLifePercent: Number((remainingPct || 0).toFixed(1)),
        alertLevel: remainingPct !== undefined ? (remainingPct < 10 ? "critical" : remainingPct < 25 ? "warning" : "ok") : "ok",
      } : undefined,
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.TELEMETRY_READINGS), reading);
      toast({ title: "Telemetry reading added" });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error saving reading", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Duty Cycle</CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgDutyCycle !== null ? `${avgDutyCycle.toFixed(1)}%` : "—"}</div>
            <p className="text-xs text-muted-foreground">A/C compressor duty cycle</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Avg Temp Reduction</CardTitle>
            <Thermometer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgTempDelta !== null ? `${avgTempDelta.toFixed(1)} °C` : "—"}</div>
            <p className="text-xs text-muted-foreground">Cabin temperature delta</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Electrical Reduction</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgElectricalReduction !== null ? `${avgElectricalReduction.toFixed(1)} kW` : "—"}</div>
            <p className="text-xs text-muted-foreground">Avg alternator load reduction</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Alerts</CardTitle>
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{criticalAlerts.length}</div>
            <p className="text-xs text-muted-foreground">Components needing attention</p>
          </CardContent>
        </Card>
      </div>

      {/* Component Lifecycle Alerts */}
      {criticalAlerts.length > 0 && (
        <Card className="border-orange-500/50">
          <CardHeader>
            <CardTitle className="text-lg">Component Lifecycle Alerts</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {criticalAlerts.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="font-medium text-sm">{r.vehicleRegistration}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.componentLifecycle?.compressorHoursTotal.toLocaleString()} / {r.componentLifecycle?.estimatedLifeHours.toLocaleString()} hrs
                    </p>
                  </div>
                  <Badge variant={r.componentLifecycle?.alertLevel === "critical" ? "destructive" : "default"}>
                    {r.componentLifecycle?.remainingLifePercent.toFixed(0)}% remaining
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Telemetry Readings Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Telemetry Readings</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Reading</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Add Telemetry Reading</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid grid-cols-3 gap-4">
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
                  <div className="space-y-2">
                    <Label>Date</Label>
                    <Input type="date" value={form.readingDate} onChange={(e) => setForm({ ...form, readingDate: e.target.value })} />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Compressor Telemetry</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Duty Cycle (%)</Label>
                      <Input type="number" step="0.1" value={form.dutyCyclePercent} onChange={(e) => setForm({ ...form, dutyCyclePercent: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Run Hours (total)</Label>
                      <Input type="number" value={form.runHoursTotal} onChange={(e) => setForm({ ...form, runHoursTotal: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Cabin Temp Delta (°C)</Label>
                      <Input type="number" step="0.1" value={form.tempDeltaCabin} onChange={(e) => setForm({ ...form, tempDeltaCabin: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Electrical System</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Total System Load (kW)</Label>
                      <Input type="number" step="0.1" value={form.totalSystemLoadKw} onChange={(e) => setForm({ ...form, totalSystemLoadKw: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Alternator Reduction (kW)</Label>
                      <Input type="number" step="0.1" value={form.alternatorReductionKw} onChange={(e) => setForm({ ...form, alternatorReductionKw: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Temperature (Pre/Post RadShield)</p>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Ambient (°C)</Label>
                      <Input type="number" step="0.1" value={form.ambientTempC} onChange={(e) => setForm({ ...form, ambientTempC: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Cabin Pre (°C)</Label>
                      <Input type="number" step="0.1" value={form.cabinTempPreC} onChange={(e) => setForm({ ...form, cabinTempPreC: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Cabin Post (°C)</Label>
                      <Input type="number" step="0.1" value={form.cabinTempPostC} onChange={(e) => setForm({ ...form, cabinTempPostC: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Component Lifecycle</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Compressor Hours (total)</Label>
                      <Input type="number" value={form.compressorHoursTotal} onChange={(e) => setForm({ ...form, compressorHoursTotal: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Estimated Life (hours)</Label>
                      <Input type="number" value={form.estimatedLifeHours} onChange={(e) => setForm({ ...form, estimatedLifeHours: e.target.value })} />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>

                <Button onClick={handleSubmit} className="w-full">Save Reading</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {telemetryReadings.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Thermometer className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No telemetry readings yet. Add compressor, electrical, and temperature readings to start tracking.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Duty Cycle</TableHead>
                    <TableHead className="text-right">System Load</TableHead>
                    <TableHead className="text-right">Temp Delta</TableHead>
                    <TableHead className="text-right">Compressor Life</TableHead>
                    <TableHead>Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {telemetryReadings.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.vehicleRegistration}</TableCell>
                      <TableCell>{r.readingDate}</TableCell>
                      <TableCell className="text-right">
                        {r.compressor?.dutyCyclePercent !== undefined ? `${r.compressor.dutyCyclePercent}%` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.electrical?.totalSystemLoadKw !== undefined ? `${r.electrical.totalSystemLoadKw} kW` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.temperature?.deltaTempC !== undefined ? `${r.temperature.deltaTempC.toFixed(1)} °C` : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.componentLifecycle ? (
                          <Badge variant={
                            r.componentLifecycle.alertLevel === "critical" ? "destructive" :
                            r.componentLifecycle.alertLevel === "warning" ? "default" : "secondary"
                          }>
                            {r.componentLifecycle.remainingLifePercent.toFixed(0)}%
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">{r.readingSource}</Badge>
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
