"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, CartesianGrid } from "recharts";
import { Leaf, Fuel, Thermometer, DollarSign, Recycle, Shield, ArrowRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { DIESEL_CO2_FACTOR_KG_PER_LITRE } from "@/lib/types";
import { calculateDashboardMetrics } from "@/lib/dashboard-analytics";
import type {
  FuelRecord,
  EmissionsReport,
  TelemetryReading,
  MaintenanceEvent,
  ContactOrganization,
  Inspection,
} from "@/lib/types";

const savingsChartConfig: ChartConfig = {
  value: { label: "Value", color: "hsl(var(--chart-1))" },
};

export default function ClientKpiPage() {
  const { user } = useAuth();
  const { jobs, worksRegister } = useJobs();
  const orgId = user?.organizationId;

  const [organization, setOrganization] = useState<ContactOrganization | null>(null);
  const [fuelRecords, setFuelRecords] = useState<FuelRecord[]>([]);
  const [emissionsReports, setEmissionsReports] = useState<EmissionsReport[]>([]);
  const [telemetryReadings, setTelemetryReadings] = useState<TelemetryReading[]>([]);
  const [maintenanceEvents, setMaintenanceEvents] = useState<MaintenanceEvent[]>([]);
  const [inspections, setInspections] = useState<Inspection[]>([]);

  // Load org profile
  useEffect(() => {
    if (!orgId) return;
    return onSnapshot(doc(db, COLLECTIONS.CONTACT_ORGANIZATIONS, orgId), (snap) => {
      setOrganization(snap.exists() ? { id: snap.id, ...(snap.data() as Omit<ContactOrganization, "id">) } : null);
    });
  }, [orgId]);

  // Load KPI data for this org only
  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, COLLECTIONS.FUEL_RECORDS), where("organizationId", "==", orgId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setFuelRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FuelRecord, "id">) })));
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, COLLECTIONS.EMISSIONS_REPORTS), where("organizationId", "==", orgId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setEmissionsReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmissionsReport, "id">) })));
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, COLLECTIONS.TELEMETRY_READINGS), where("organizationId", "==", orgId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setTelemetryReadings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TelemetryReading, "id">) })));
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, COLLECTIONS.MAINTENANCE_EVENTS), where("organizationId", "==", orgId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setMaintenanceEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MaintenanceEvent, "id">) })));
    });
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    const q = query(collection(db, COLLECTIONS.INSPECTIONS), where("organizationId", "==", orgId), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setInspections(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Inspection, "id">) })));
    });
  }, [orgId]);

  const orgName = organization?.name || user?.organizationName || "your organisation";

  // Existing environmental metrics from dashboard-analytics
  const metrics = useMemo(
    () => calculateDashboardMetrics({ jobs, inspections, worksRegister, organizations: organization ? [organization] : [] }),
    [jobs, inspections, worksRegister, organization]
  );

  // Fuel savings for this org
  const fuelSummary = useMemo(() => {
    const totalLitres = fuelRecords.reduce((s, r) => {
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) return s + (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
      return s;
    }, 0);
    const totalCost = fuelRecords.reduce((s, r) => s + (r.estimatedCostSavingsPerYear || 0), 0);
    const totalKwh = fuelRecords.reduce((s, r) => s + (r.estimatedKwhSaved || 0), 0);
    return { totalLitres: Math.round(totalLitres), totalCost: Math.round(totalCost), totalKwh: Math.round(totalKwh), count: fuelRecords.length };
  }, [fuelRecords]);

  // Emissions summary
  const emissionsSummary = useMemo(() => {
    const co2 = emissionsReports.reduce((s, r) => s + (r.scope1?.co2AvoidedTonnes || 0), 0);
    const waste = emissionsReports.reduce((s, r) => s + (r.waste?.totalWasteAvoidedKg || 0), 0);
    // Fallback to fuel-based calculation if no reports
    const fuelBasedCo2 = fuelSummary.totalLitres * DIESEL_CO2_FACTOR_KG_PER_LITRE / 1000;
    return {
      co2Tonnes: co2 > 0 ? co2 : fuelBasedCo2,
      wasteKg: waste > 0 ? waste : metrics.glassSavedKg,
    };
  }, [emissionsReports, fuelSummary, metrics.glassSavedKg]);

  // Temperature reduction
  const avgTempReduction = useMemo(() => {
    const temps = telemetryReadings.filter((r) => r.temperature?.deltaTempC);
    if (temps.length === 0) return null;
    return temps.reduce((s, r) => s + (r.temperature?.deltaTempC || 0), 0) / temps.length;
  }, [telemetryReadings]);

  // Maintenance cost avoided
  const maintenanceSavings = useMemo(() => {
    return maintenanceEvents.reduce((s, e) => s + (e.replacementCostAvoided || 0), 0);
  }, [maintenanceEvents]);

  // Benefits chart data
  const benefitsData = useMemo(() => {
    const items = [];
    if (fuelSummary.totalCost > 0) items.push({ name: "Fuel Savings", value: fuelSummary.totalCost });
    if (metrics.replacementValueSaved > 0) items.push({ name: "Glass Protection", value: Math.round(metrics.replacementValueSaved) });
    if (maintenanceSavings > 0) items.push({ name: "Maintenance Avoided", value: maintenanceSavings });
    return items;
  }, [fuelSummary, metrics.replacementValueSaved, maintenanceSavings]);

  const totalValueDelivered = fuelSummary.totalCost + Math.round(metrics.replacementValueSaved) + maintenanceSavings;

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          Performance &amp; Sustainability
        </h2>
        <p className="text-muted-foreground">
          {orgName} — service outcomes, environmental impact, and fleet protection benefits.
        </p>
      </div>

      {/* Hero Value Card */}
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="py-6">
          <div className="grid gap-6 md:grid-cols-3 text-center">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Value Delivered</p>
              <p className="text-3xl font-bold text-primary">
                ${totalValueDelivered.toLocaleString()}
              </p>
              <p className="text-xs text-muted-foreground">Annual savings across all programs</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Carbon Reduction</p>
              <p className="text-3xl font-bold text-green-400">
                {emissionsSummary.co2Tonnes.toFixed(1)} t
              </p>
              <p className="text-xs text-muted-foreground">CO2 emissions avoided per year</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground mb-1">Fleet Assets Protected</p>
              <p className="text-3xl font-bold">
                {fuelSummary.count || metrics.operations.jobsCompleted}
              </p>
              <p className="text-xs text-muted-foreground">Vehicles with active protection</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Fuel Savings</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{fuelSummary.totalLitres.toLocaleString()} L</div>
            <p className="text-xs text-muted-foreground">
              ${fuelSummary.totalCost.toLocaleString()} saved per year
            </p>
            {fuelSummary.totalKwh > 0 && (
              <p className="text-xs text-muted-foreground">{fuelSummary.totalKwh.toLocaleString()} kWh energy saved</p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Environmental Impact</CardTitle>
            <Leaf className="h-4 w-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">{emissionsSummary.co2Tonnes.toFixed(1)} t CO2</div>
            <p className="text-xs text-muted-foreground">
              {emissionsSummary.wasteKg.toFixed(1)} kg waste diverted from landfill
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cabin Comfort</CardTitle>
            <Thermometer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {avgTempReduction !== null ? `${avgTempReduction.toFixed(1)} °C` : `${metrics.downtimeSavedHours.toFixed(0)}h`}
            </div>
            <p className="text-xs text-muted-foreground">
              {avgTempReduction !== null ? "Average cabin temperature reduction" : "Downtime avoided"}
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Asset Protection</CardTitle>
            <Shield className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${Math.round(metrics.replacementValueSaved + maintenanceSavings).toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">Replacement &amp; repair costs avoided</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Sections */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Value Breakdown Chart */}
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="text-lg">Value Breakdown</CardTitle>
            <CardDescription>Annual savings by category</CardDescription>
          </CardHeader>
          <CardContent>
            {benefitsData.length > 0 ? (
              <ChartContainer config={savingsChartConfig} className="h-[250px] w-full">
                <BarChart data={benefitsData} layout="vertical" margin={{ left: 10, right: 30 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tickFormatter={(v) => `$${v.toLocaleString()}`} />
                  <YAxis dataKey="name" type="category" width={120} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="value" fill="var(--color-value)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[250px] text-muted-foreground text-sm">
                Value data will appear as your fleet protection program progresses.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Sustainability Summary */}
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Recycle className="h-5 w-5 text-emerald-400" />
              Sustainability Report
            </CardTitle>
            <CardDescription>Your organisation&apos;s environmental contribution</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold text-green-400">{emissionsSummary.co2Tonnes.toFixed(2)}</p>
                <p className="text-xs text-muted-foreground">Tonnes CO2 avoided</p>
              </div>
              <div className="rounded-lg border p-3 text-center">
                <p className="text-2xl font-bold">{metrics.glassSavedKg.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">kg glass saved</p>
              </div>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-sm font-medium mb-1">How this is calculated</p>
              <p className="text-xs text-muted-foreground">
                CO2 reduction is based on verified diesel savings from your fleet multiplied by the Australian
                National Greenhouse Accounts factor ({DIESEL_CO2_FACTOR_KG_PER_LITRE} kg CO2 per litre). Glass
                saved is measured from avoided replacement events tracked through your service records.
              </p>
            </div>
            {emissionsReports.length > 0 && (
              <div className="flex items-center gap-2">
                <Badge variant="default">ASRS Ready</Badge>
                <span className="text-xs text-muted-foreground">Scope 1 data available for your reporting</span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Links */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
          <CardContent className="py-4">
            <Link href="/client/works-register" className="flex items-center justify-between">
              <div>
                <p className="font-medium">Works Register</p>
                <p className="text-xs text-muted-foreground">Full history of completed works</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
          <CardContent className="py-4">
            <Link href="/client/inspections" className="flex items-center justify-between">
              <div>
                <p className="font-medium">Inspections</p>
                <p className="text-xs text-muted-foreground">Vehicle inspection reports</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
        <Card className="bg-card/50 backdrop-blur hover:border-primary/50 transition-colors">
          <CardContent className="py-4">
            <Link href="/client/athena" className="flex items-center justify-between">
              <div>
                <p className="font-medium">Ask Athena</p>
                <p className="text-xs text-muted-foreground">AI assistant for your fleet data</p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
