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
import { DIESEL_CO2_FACTOR_KG_PER_LITRE } from "@/lib/types";
import { Plus, Leaf, Download, FileText, Recycle } from "lucide-react";
import type { EmissionsReport, FuelRecord, ContactOrganization } from "@/lib/types";

interface EmissionsEsgTabProps {
  emissionsReports: EmissionsReport[];
  fuelRecords: FuelRecord[];
  organizations: ContactOrganization[];
}

export function EmissionsEsgTab({ emissionsReports, fuelRecords, organizations }: EmissionsEsgTabProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  const [form, setForm] = useState({
    organizationId: "",
    reportingPeriod: "annual" as string,
    periodStart: "",
    periodEnd: "",
    dieselSavedLitres: "",
    glassAvoidedKg: "",
    filmDisposalsAvoidedKg: "",
    notes: "",
  });

  // Real-time Scope 1 calculator
  const scope1Preview = useMemo(() => {
    const litres = parseFloat(form.dieselSavedLitres) || 0;
    const co2Kg = litres * DIESEL_CO2_FACTOR_KG_PER_LITRE;
    return { litres, co2Kg, co2Tonnes: co2Kg / 1000 };
  }, [form.dieselSavedLitres]);

  // Waste preview
  const wastePreview = useMemo(() => {
    const glass = parseFloat(form.glassAvoidedKg) || 0;
    const film = parseFloat(form.filmDisposalsAvoidedKg) || 0;
    return { glass, film, total: glass + film };
  }, [form.glassAvoidedKg, form.filmDisposalsAvoidedKg]);

  // Auto-calculate diesel saved from fuel records for an org
  const autoCalcLitres = useMemo(() => {
    if (!form.organizationId) return 0;
    return fuelRecords
      .filter((r) => r.organizationId === form.organizationId)
      .reduce((sum, r) => {
        if (r.fuelDeltaLPer100km && r.annualDistanceKm) {
          return sum + (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
        }
        return sum;
      }, 0);
  }, [fuelRecords, form.organizationId]);

  // Summary stats
  const totalCo2 = useMemo(() => {
    return emissionsReports.reduce((s, r) => s + (r.scope1?.co2AvoidedTonnes || 0), 0);
  }, [emissionsReports]);

  const totalWaste = useMemo(() => {
    return emissionsReports.reduce((s, r) => s + (r.waste?.totalWasteAvoidedKg || 0), 0);
  }, [emissionsReports]);

  const handleSubmit = async () => {
    if (!form.organizationId || !form.periodStart || !form.periodEnd) {
      toast({ title: "Missing fields", description: "Organisation and period are required.", variant: "destructive" });
      return;
    }

    const org = organizations.find((o) => o.id === form.organizationId);
    const litres = parseFloat(form.dieselSavedLitres) || 0;
    const co2Kg = litres * DIESEL_CO2_FACTOR_KG_PER_LITRE;
    const glassKg = parseFloat(form.glassAvoidedKg) || 0;
    const filmKg = parseFloat(form.filmDisposalsAvoidedKg) || 0;

    const report: Omit<EmissionsReport, "id"> = {
      organizationId: form.organizationId,
      organizationName: org?.name || "",
      reportingPeriod: form.reportingPeriod as EmissionsReport["reportingPeriod"],
      periodStart: form.periodStart,
      periodEnd: form.periodEnd,
      scope1: {
        dieselSavedLitres: litres,
        co2AvoidedKg: Number(co2Kg.toFixed(2)),
        co2AvoidedTonnes: Number((co2Kg / 1000).toFixed(4)),
        calculationMethod: `diesel_saved (${litres}L) x ${DIESEL_CO2_FACTOR_KG_PER_LITRE} kg CO2/L (Australian NGA factor)`,
      },
      waste: {
        glassAvoidedKg: glassKg,
        filmDisposalsAvoidedKg: filmKg,
        totalWasteAvoidedKg: glassKg + filmKg,
      },
      status: "draft",
      notes: form.notes || undefined,
      createdAt: serverTimestamp() as any,
      updatedAt: serverTimestamp() as any,
      createdBy: user?.uid || "",
    };

    try {
      await addDoc(collection(db, COLLECTIONS.EMISSIONS_REPORTS), report);
      toast({ title: "Emissions report created" });
      setDialogOpen(false);
    } catch (err) {
      toast({ title: "Error saving report", description: String(err), variant: "destructive" });
    }
  };

  const handleAsrsExport = () => {
    if (emissionsReports.length === 0) {
      toast({ title: "No data to export", variant: "destructive" });
      return;
    }

    const headers = [
      "Organisation",
      "Period Start",
      "Period End",
      "Reporting Period",
      "Diesel Saved (L)",
      "CO2 Avoided (kg)",
      "CO2 Avoided (t)",
      "Calculation Method",
      "Glass Waste Avoided (kg)",
      "Film Waste Avoided (kg)",
      "Total Waste Avoided (kg)",
      "Status",
    ];

    const rows = emissionsReports.map((r) => [
      r.organizationName,
      r.periodStart,
      r.periodEnd,
      r.reportingPeriod,
      r.scope1?.dieselSavedLitres || 0,
      r.scope1?.co2AvoidedKg || 0,
      r.scope1?.co2AvoidedTonnes || 0,
      r.scope1?.calculationMethod || "",
      r.waste?.glassAvoidedKg || 0,
      r.waste?.filmDisposalsAvoidedKg || 0,
      r.waste?.totalWasteAvoidedKg || 0,
      r.status,
    ]);

    const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${c}"`).join(","))].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ASI_ASRS_Scope1_Export_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: "ASRS export downloaded" });
  };

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">CO2 Avoided</CardTitle>
            <Leaf className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCo2.toFixed(2)} t</div>
            <p className="text-xs text-muted-foreground">Tonnes CO2 (Scope 1)</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Waste Avoided</CardTitle>
            <Recycle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalWaste.toFixed(1)} kg</div>
            <p className="text-xs text-muted-foreground">Glass + film diverted from landfill</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Reports</CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{emissionsReports.length}</div>
            <p className="text-xs text-muted-foreground">Emissions reports filed</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">ASRS Export</CardTitle>
            <Download className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Button size="sm" variant="outline" onClick={handleAsrsExport} className="w-full">
              <Download className="h-4 w-4 mr-1" /> Export CSV
            </Button>
            <p className="text-xs text-muted-foreground mt-1">ASRS Group 2 compliant</p>
          </CardContent>
        </Card>
      </div>

      {/* Scope 1 Calculator */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Scope 1 Emissions Calculator</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">Diesel Saved</p>
              <p className="text-3xl font-bold">{scope1Preview.litres.toLocaleString()} L</p>
            </div>
            <div className="rounded-lg border p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">x {DIESEL_CO2_FACTOR_KG_PER_LITRE} kg CO2/L</p>
              <p className="text-3xl font-bold">{scope1Preview.co2Kg.toLocaleString(undefined, { maximumFractionDigits: 1 })} kg</p>
            </div>
            <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-center">
              <p className="text-sm text-muted-foreground mb-1">CO2 Avoided</p>
              <p className="text-3xl font-bold text-green-400">{scope1Preview.co2Tonnes.toFixed(2)} t</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Factor: Australian National Greenhouse Accounts (NGA) — {DIESEL_CO2_FACTOR_KG_PER_LITRE} kg CO2 per litre of diesel consumed (Scope 1 direct emissions).
          </p>
        </CardContent>
      </Card>

      {/* Reports Table + Add Dialog */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg">Emissions Reports</CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm"><Plus className="h-4 w-4 mr-1" /> Add Report</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Create Emissions Report</DialogTitle>
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
                    <Label>Reporting Period</Label>
                    <Select value={form.reportingPeriod} onValueChange={(v) => setForm({ ...form, reportingPeriod: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="quarterly">Quarterly</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Period Start *</Label>
                    <Input type="date" value={form.periodStart} onChange={(e) => setForm({ ...form, periodStart: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Period End *</Label>
                    <Input type="date" value={form.periodEnd} onChange={(e) => setForm({ ...form, periodEnd: e.target.value })} />
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Scope 1 — Diesel Combustion</p>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Label className="flex-1">Diesel Saved (litres)</Label>
                      {autoCalcLitres > 0 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setForm({ ...form, dieselSavedLitres: Math.round(autoCalcLitres).toString() })}
                        >
                          Auto-fill from fuel records ({Math.round(autoCalcLitres).toLocaleString()} L)
                        </Button>
                      )}
                    </div>
                    <Input type="number" value={form.dieselSavedLitres} onChange={(e) => setForm({ ...form, dieselSavedLitres: e.target.value })} />
                    {scope1Preview.litres > 0 && (
                      <p className="text-sm text-green-400">
                        = {scope1Preview.co2Tonnes.toFixed(2)} tonnes CO2 avoided ({scope1Preview.co2Kg.toFixed(1)} kg)
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t pt-4">
                  <p className="font-semibold text-sm mb-3">Waste Avoidance (Circular Economy)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Glass Avoided (kg)</Label>
                      <Input type="number" step="0.1" value={form.glassAvoidedKg} onChange={(e) => setForm({ ...form, glassAvoidedKg: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Film Disposals Avoided (kg)</Label>
                      <Input type="number" step="0.1" value={form.filmDisposalsAvoidedKg} onChange={(e) => setForm({ ...form, filmDisposalsAvoidedKg: e.target.value })} />
                    </div>
                  </div>
                  {wastePreview.total > 0 && (
                    <p className="text-sm text-green-400 mt-2">
                      = {wastePreview.total.toFixed(1)} kg total waste diverted from landfill
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>Notes</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
                </div>

                <Button onClick={handleSubmit} className="w-full">Save Emissions Report</Button>
              </div>
            </DialogContent>
          </Dialog>
        </CardHeader>
        <CardContent>
          {emissionsReports.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Leaf className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No emissions reports yet. Create your first report to start tracking Scope 1 data.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Organisation</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Diesel Saved (L)</TableHead>
                  <TableHead className="text-right">CO2 Avoided (t)</TableHead>
                  <TableHead className="text-right">Waste Avoided (kg)</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {emissionsReports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.organizationName}</TableCell>
                    <TableCell>{r.periodStart} to {r.periodEnd}</TableCell>
                    <TableCell className="text-right">{r.scope1?.dieselSavedLitres?.toLocaleString() || 0}</TableCell>
                    <TableCell className="text-right">{r.scope1?.co2AvoidedTonnes?.toFixed(2) || 0}</TableCell>
                    <TableCell className="text-right">{r.waste?.totalWasteAvoidedKg?.toFixed(1) || 0}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "submitted" ? "default" : r.status === "reviewed" ? "secondary" : "outline"}>
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
