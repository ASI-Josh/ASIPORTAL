"use client";

import { useMemo, useState } from "react";
import { addDoc, collection, doc, updateDoc, serverTimestamp } from "firebase/firestore";
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
import { Plus, Fuel, DollarSign, Zap, TrendingDown } from "lucide-react";
import type { FuelRecord, ContactOrganization, KpiSnapshot } from "@/lib/types";

interface FuelEnergyTabProps {
  fuelRecords: FuelRecord[];
  organizations: ContactOrganization[];
  snapshots: KpiSnapshot[];
}

const FUEL_TYPES = [
  { value: "diesel", label: "Diesel" },
  { value: "petrol", label: "Petrol" },
  { value: "lpg", label: "LPG" },
  { value: "cng", label: "CNG" },
  { value: "electric", label: "Electric" },
] as const;

const DATA_SOURCES = [
  { value: "manual", label: "Manual Entry" },
  { value: "telematics", label: "Telematics" },
  { value: "fleet_report", label: "Fleet Report" },
] as const;

export function FuelEnergyTab({ fuelRecords, organizations, snapshots }: FuelEnergyTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [orgFilter, setOrgFilter] = useState<string>("all");

  // Form state
  const [form, setForm] = useState({
    organizationId: "",
    vehicleRegistration: "",
    vehicleDescription: "",
    fuelType: "diesel" as string,
    baselineConsumptionLPer100km: "",
    baselinePeriodStart: "",
    baselinePeriodEnd: "",
    baselineSource: "manual" as string,
    postInstallConsumptionLPer100km: "",
    postInstallPeriodStart: "",
    postInstallPeriodEnd: "",
    postInstallSource: "manual" as string,
    annualDistanceKm: "",
    fuelCostPerLitre: "1.80",
    hvacLoadReductionKw: "",
    radshieldInstalled: true,
    installDate: "",
    notes: "",
  });

  const filteredRecords = useMemo(() => {
    if (orgFilter === "all") return fuelRecords;
    return fuelRecords.filter((r) => r.organizationId === orgFilter);
  }, [fuelRecords, orgFilter]);

  // Fleet-level rollup
  const fleetRollup = useMemo(() => {
    const byOrg: Record<string, { name: string; litres: number; cost: number; kwh: number; vehicles: Set<string> }> = {};
    fuelRecords.forEach((r) => {
      if (!byOrg[r.organizationId]) {
        byOrg[r.organizationId] = { name: r.organizationName, litres: 0, cost: 0, kwh: 0, vehicles: new Set() };
      }
      const entry = byOrg[r.organizationId];
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) {
        entry.litres += (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
      }
      entry.cost += r.estimatedCostSavingsPerYear || 0;
      entry.kwh += r.estimatedKwhSaved || 0;
      entry.vehicles.add(r.vehicleRegistration);
    });
    return Object.entries(byOrg).map(([id, d]) => ({
      organizationId: id,
      name: d.name,
      litres: Math.round(d.litres),
      cost: Math.round(d.cost),
      kwh: Math.round(d.kwh),
      vehicleCount: d.vehicles.size,
    }));
  }, [fuelRecords]);

  const totalSummary = useMemo(() => {
    return {
      litres: fleetRollup.reduce((s, r) => s + r.litres, 0),
      cost: fleetRollup.reduce((s, r) => s + r.cost, 0),
      kwh: fleetRollup.reduce((s, r) => s + r.kwh, 0),
      vehicles: fuelRecords.length,
    };
  }, [fleetRollup, fuelRecords]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.vehicleRegistration || !form.baselineConsumptionLPer100km) {
      toast({ title: "Missing fields", description: "Organisation, vehicle rego, and baseline consumption are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);
    const baseline = parseFloat(form.baselineConsumptionLPer100km);
    const postInstall = form.postInstallConsumptionLPer100km ? parseFloat(form.postInstallConsumptionLPer100km) : undefined;
    const annualKm = form.annualDistanceKm ? parseFloat(form.annualDistanceKm) : undefined;
    const costPerLitre = parseFloat(form.fuelCostPerLitre);
    const hvacReduction = form.hvacLoadReductionKw ? parseFloat(form.hvacLoadReductionKw) : undefined;

    const fuelDelta = postInstall !== undefined ? baseline - postInstall : undefined;
    const fuelDeltaPercent = fuelDelta !== undefined ? (fuelDelta / baseline) * 100 : undefined;
    const annualLitresSaved = fuelDelta !== undefined && annualKm ? (fuelDelta * annualKm) / 100 : undefined;
    const costSavings = annualLitresSaved !== undefined ? annualLitresSaved * costPerLitre : undefined;
    // Rough kWh estimate: 1 litre diesel ≈ 10.1 kWh
    const kwhSaved = annualLitresSaved !== undefined ? annualLitresSaved * 10.1 : undefined;

    const record: Omit<FuelRecord, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name || "",
      vehicleRegistration: form.vehicleRegistration.toUpperCase(),
      vehicleDescription: form.vehicleDescription || undefined,
      fuelType: form.fuelType as FuelRecord["fuelType"],
      baselineConsumptionLPer100km: baseline,
      baselinePeriodStart: form.baselinePeriodStart,
      baselinePeriodEnd: form.baselinePeriodEnd,
      baselineSource: form.baselineSource as FuelRecord["baselineSource"],
      postInstallConsumptionLPer100km: postInstall,
      postInstallPeriodStart: form.postInstallPeriodStart || undefined,
      postInstallPeriodEnd: form.postInstallPeriodEnd || undefined,
      postInstallSource: form.postInstallSource as FuelRecord["postInstallSource"],
      fuelDeltaLPer100km: fuelDelta,
      fuelDeltaPercent: fuelDeltaPercent ? Number(fuelDeltaPercent.toFixed(2)) : undefined,
      hvacLoadReductionKw: hvacReduction,
      estimatedKwhSaved: kwhSaved ? Math.round(kwhSaved) : undefined,
      fuelCostPerLitre: costPerLitre,
      estimatedCostSavingsPerYear: costSavings ? Math.round(costSavings) : undefined,
      annualDistanceKm: annualKm,
      radshieldInstalled: form.radshieldInstalled,
      installDate: form.installDate || undefined,
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.FUEL_RECORDS), record);
      toast({ title: "Fuel record added" });
      setDialogOpen(false);
      setForm({
        organizationId: form.organizationId,
        vehicleRegistration: "",
        vehicleDescription: "",
        fuelType: "diesel",
        baselineConsumptionLPer100km: "",
        baselinePeriodStart: form.baselinePeriodStart,
        baselinePeriodEnd: form.baselinePeriodEnd,
        baselineSource: "manual",
        postInstallConsumptionLPer100km: "",
        postInstallPeriodStart: "",
        postInstallPeriodEnd: "",
        postInstallSource: "manual",
        annualDistanceKm: form.annualDistanceKm,
        fuelCostPerLitre: form.fuelCostPerLitre,
        hvacLoadReductionKw: "",
        radshieldInstalled: true,
        installDate: "",
        notes: "",
      });
    } catch (err) {
      toast({ title: "Error saving fuel record", description: String(err), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Total Fuel Saved</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSummary.litres.toLocaleString()} L</div>
            <p className="text-xs text-muted-foreground">Annual litres across all fleets</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cost Savings</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalSummary.cost.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">AUD per year</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Energy Saved</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalSummary.kwh.toLocaleString()} kWh</div>
            <p className="text-xs text-muted-foreground">Equivalent energy saved</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Records</CardTitle>
            <TrendingDown className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fuelRecords.length}</div>
            <p className="text-xs text-muted-foreground">Vehicle fuel baselines</p>
          </CardContent>
        </Card>
      </div>

      {/* Fleet Rollup */}
      {fleetRollup.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Fleet-Level Savings Rollup</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead className="text-right">Vehicles</TableHead>
                  <TableHead className="text-right">Litres Saved/yr</TableHead>
                  <TableHead className="text-right">kWh Saved/yr</TableHead>
                  <TableHead className="text-right">Cost Savings/yr</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fleetRollup.map((r) => (
                  <TableRow key={r.organizationId}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right">{r.vehicleCount}</TableCell>
                    <TableCell className="text-right">{r.litres.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{r.kwh.toLocaleString()}</TableCell>
                    <TableCell className="text-right">${r.cost.toLocaleString()}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Fuel Records Table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Fuel Baseline &amp; Delta Tracker</CardTitle>
          <div className="flex items-center gap-3">
            <Select value={orgFilter} onValueChange={setOrgFilter}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Filter by org" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Organisations</SelectItem>
                {organizations.map((o) => (
                  <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Record</Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add Fuel Baseline Record</DialogTitle>
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
                      <Label>Vehicle Registration *</Label>
                      <Input value={form.vehicleRegistration} onChange={(e) => setForm({ ...form, vehicleRegistration: e.target.value })} placeholder="e.g. ABC-123" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Vehicle Description</Label>
                      <Input value={form.vehicleDescription} onChange={(e) => setForm({ ...form, vehicleDescription: e.target.value })} placeholder="e.g. Volvo B12R Coach" />
                    </div>
                    <div className="space-y-2">
                      <Label>Fuel Type</Label>
                      <Select value={form.fuelType} onValueChange={(v) => setForm({ ...form, fuelType: v })}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {FUEL_TYPES.map((f) => (
                            <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-semibold text-sm mb-3">Baseline (Pre-Install)</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Consumption (L/100km) *</Label>
                        <Input type="number" step="0.1" value={form.baselineConsumptionLPer100km} onChange={(e) => setForm({ ...form, baselineConsumptionLPer100km: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Period Start</Label>
                        <Input type="date" value={form.baselinePeriodStart} onChange={(e) => setForm({ ...form, baselinePeriodStart: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Period End</Label>
                        <Input type="date" value={form.baselinePeriodEnd} onChange={(e) => setForm({ ...form, baselinePeriodEnd: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-semibold text-sm mb-3">Post-Install</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Consumption (L/100km)</Label>
                        <Input type="number" step="0.1" value={form.postInstallConsumptionLPer100km} onChange={(e) => setForm({ ...form, postInstallConsumptionLPer100km: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Period Start</Label>
                        <Input type="date" value={form.postInstallPeriodStart} onChange={(e) => setForm({ ...form, postInstallPeriodStart: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>Period End</Label>
                        <Input type="date" value={form.postInstallPeriodEnd} onChange={(e) => setForm({ ...form, postInstallPeriodEnd: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <p className="font-semibold text-sm mb-3">Calculations</p>
                    <div className="grid grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Annual Distance (km)</Label>
                        <Input type="number" value={form.annualDistanceKm} onChange={(e) => setForm({ ...form, annualDistanceKm: e.target.value })} placeholder="e.g. 80000" />
                      </div>
                      <div className="space-y-2">
                        <Label>Fuel Cost ($/L)</Label>
                        <Input type="number" step="0.01" value={form.fuelCostPerLitre} onChange={(e) => setForm({ ...form, fuelCostPerLitre: e.target.value })} />
                      </div>
                      <div className="space-y-2">
                        <Label>HVAC Load Reduction (kW)</Label>
                        <Input type="number" step="0.1" value={form.hvacLoadReductionKw} onChange={(e) => setForm({ ...form, hvacLoadReductionKw: e.target.value })} />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>RadShield Install Date</Label>
                      <Input type="date" value={form.installDate} onChange={(e) => setForm({ ...form, installDate: e.target.value })} />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Notes</Label>
                    <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                  </div>

                  <Button onClick={handleSubmit} className="w-full">Save Fuel Record</Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {filteredRecords.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Fuel className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No fuel records yet. Click &quot;Add Record&quot; to start tracking fuel baselines.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vehicle</TableHead>
                    <TableHead>Organisation</TableHead>
                    <TableHead className="text-right">Baseline (L/100km)</TableHead>
                    <TableHead className="text-right">Post-Install (L/100km)</TableHead>
                    <TableHead className="text-right">Delta %</TableHead>
                    <TableHead className="text-right">kWh Saved/yr</TableHead>
                    <TableHead className="text-right">Cost Saved/yr</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRecords.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-medium">{r.vehicleRegistration}</div>
                        {r.vehicleDescription && <div className="text-xs text-muted-foreground">{r.vehicleDescription}</div>}
                      </TableCell>
                      <TableCell>{r.organizationName}</TableCell>
                      <TableCell className="text-right">{r.baselineConsumptionLPer100km.toFixed(1)}</TableCell>
                      <TableCell className="text-right">
                        {r.postInstallConsumptionLPer100km !== undefined ? r.postInstallConsumptionLPer100km.toFixed(1) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.fuelDeltaPercent !== undefined ? (
                          <Badge variant={r.fuelDeltaPercent > 0 ? "default" : "destructive"}>
                            {r.fuelDeltaPercent > 0 ? "-" : "+"}{Math.abs(r.fuelDeltaPercent).toFixed(1)}%
                          </Badge>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.estimatedKwhSaved !== undefined ? r.estimatedKwhSaved.toLocaleString() : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {r.estimatedCostSavingsPerYear !== undefined ? `$${r.estimatedCostSavingsPerYear.toLocaleString()}` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Energy Savings Calculator Info */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Energy Savings Calculator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border p-4">
              <p className="font-semibold text-sm mb-2">Fuel Delta Method</p>
              <p className="text-sm text-muted-foreground">
                kWh saved = (Baseline L/100km - Post-Install L/100km) x Annual km / 100 x 10.1 kWh/L
              </p>
            </div>
            <div className="rounded-lg border p-4">
              <p className="font-semibold text-sm mb-2">HVAC Load Method</p>
              <p className="text-sm text-muted-foreground">
                kWh saved = HVAC load reduction (kW) x average daily solar hours x 365 days
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
