"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Bar, BarChart, XAxis, YAxis, Line, LineChart, CartesianGrid } from "recharts";
import { Fuel, Leaf, Thermometer, Wrench, Zap, AlertTriangle, Star, Info } from "lucide-react";
import { DIESEL_CO2_FACTOR_KG_PER_LITRE } from "@/lib/types";
import type {
  FuelRecord,
  EmissionsReport,
  TelemetryReading,
  MaintenanceEvent,
  KpiSnapshot,
  ContactOrganization,
  SatisfactionSurvey,
} from "@/lib/types";
import type { DashboardMetrics } from "@/lib/dashboard-analytics";

interface KpiOverviewProps {
  fuelRecords: FuelRecord[];
  emissionsReports: EmissionsReport[];
  telemetryReadings: TelemetryReading[];
  maintenanceEvents: MaintenanceEvent[];
  snapshots: KpiSnapshot[];
  organizations: ContactOrganization[];
  surveys?: SatisfactionSurvey[];
  derivedMetrics?: DashboardMetrics;
}

const fuelChartConfig: ChartConfig = {
  litres: { label: "Litres Saved", color: "hsl(var(--chart-1))" },
};
const co2ChartConfig: ChartConfig = {
  tonnes: { label: "CO2 Avoided (t)", color: "hsl(var(--chart-2))" },
};

export function KpiOverview({
  fuelRecords,
  emissionsReports,
  telemetryReadings,
  maintenanceEvents,
  surveys = [],
  derivedMetrics,
}: KpiOverviewProps) {
  const totalFuelSaved = useMemo(() => {
    return fuelRecords.reduce((sum, r) => {
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) {
        return sum + (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
      }
      return sum;
    }, 0);
  }, [fuelRecords]);

  // Derived environmental impact from completed jobs (fallback when the
  // dedicated KPI collections are empty). Mirrors the main dashboard feed.
  const derivedCo2Tonnes = useMemo(() => {
    if (!derivedMetrics) return 0;
    // Glass saved → CO2 avoided: ~0.8 kg CO2 per kg of glass production avoided (industry avg).
    return (derivedMetrics.glassSavedKg * 0.8) / 1000;
  }, [derivedMetrics]);

  const totalCo2Avoided = useMemo(() => {
    const fromFuel = totalFuelSaved * DIESEL_CO2_FACTOR_KG_PER_LITRE / 1000;
    const fromReports = emissionsReports.reduce(
      (sum, r) => sum + (r.scope1?.co2AvoidedTonnes || 0), 0
    );
    if (fromReports > 0) return fromReports;
    if (fromFuel > 0) return fromFuel;
    return derivedCo2Tonnes;
  }, [totalFuelSaved, emissionsReports, derivedCo2Tonnes]);

  const totalCostSavings = useMemo(() => {
    const fromFuel = fuelRecords.reduce(
      (sum, r) => sum + (r.estimatedCostSavingsPerYear || 0), 0
    );
    if (fromFuel > 0) return fromFuel;
    // Fallback: value of replaced panels avoided via ASI repair work.
    return derivedMetrics?.replacementValueSaved || 0;
  }, [fuelRecords, derivedMetrics]);

  const vehiclesTracked = useMemo(() => {
    const regs = new Set<string>();
    fuelRecords.forEach((r) => regs.add(r.vehicleRegistration));
    telemetryReadings.forEach((r) => regs.add(r.vehicleRegistration));
    return regs.size;
  }, [fuelRecords, telemetryReadings]);

  const totalReplacementCostAvoided = useMemo(() => {
    const fromEvents = maintenanceEvents.reduce(
      (sum, e) => sum + (e.replacementCostAvoided || 0), 0
    );
    if (fromEvents > 0) return fromEvents;
    return derivedMetrics?.replacementValueSaved || 0;
  }, [maintenanceEvents, derivedMetrics]);

  const avgTempDelta = useMemo(() => {
    const temps = telemetryReadings.filter((r) => r.temperature?.deltaTempC);
    if (temps.length === 0) return 0;
    return temps.reduce((sum, r) => sum + (r.temperature?.deltaTempC || 0), 0) / temps.length;
  }, [telemetryReadings]);

  // Client satisfaction (ISO 9001)
  const avgSatisfaction = useMemo(() => {
    if (surveys.length === 0) return null;
    return surveys.reduce((s, r) => s + r.overallSatisfaction, 0) / surveys.length;
  }, [surveys]);

  const recommendRate = useMemo(() => {
    if (surveys.length === 0) return null;
    const recommenders = surveys.filter((s) => s.wouldRecommend).length;
    return (recommenders / surveys.length) * 100;
  }, [surveys]);

  // ASRS deadline countdown
  const asrsDeadline = new Date("2026-07-01");
  const today = new Date();
  const daysUntilAsrs = Math.ceil(
    (asrsDeadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  // Fuel savings by org for chart
  const fuelByOrg = useMemo(() => {
    const byOrg: Record<string, number> = {};
    fuelRecords.forEach((r) => {
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) {
        const saved = (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
        byOrg[r.organizationName] = (byOrg[r.organizationName] || 0) + saved;
      }
    });
    return Object.entries(byOrg)
      .map(([name, litres]) => ({ name: name.length > 15 ? name.slice(0, 15) + "..." : name, litres: Math.round(litres) }))
      .sort((a, b) => b.litres - a.litres)
      .slice(0, 10);
  }, [fuelRecords]);

  // CO2 trend by period for chart
  const co2Trend = useMemo(() => {
    return emissionsReports
      .filter((r) => r.scope1?.co2AvoidedTonnes)
      .sort((a, b) => a.periodStart.localeCompare(b.periodStart))
      .map((r) => ({
        period: r.periodStart.slice(0, 7),
        tonnes: Number(r.scope1.co2AvoidedTonnes.toFixed(2)),
      }));
  }, [emissionsReports]);

  const derivedJobsCompleted = derivedMetrics?.operations.jobsCompleted || 0;
  const isUsingDerivedFeed =
    fuelRecords.length === 0 && emissionsReports.length === 0 && maintenanceEvents.length === 0 && derivedJobsCompleted > 0;

  const kpiCategories = [
    { label: "Fuel & Energy", status: fuelRecords.length > 0 ? "active" : "awaiting data", priority: "P0" },
    { label: "Emissions / ESG", status: emissionsReports.length > 0 ? "active" : (derivedMetrics?.glassSavedKg ? "derived" : "awaiting data"), priority: "P0" },
    { label: "HVAC / Telemetry", status: telemetryReadings.length > 0 ? "active" : "awaiting data", priority: "P1" },
    { label: "Maintenance", status: maintenanceEvents.length > 0 ? "active" : (derivedMetrics?.replacementValueSaved ? "derived" : "awaiting data"), priority: "P1" },
    { label: "Client Satisfaction", status: surveys.length > 0 ? "active" : "awaiting data", priority: "ISO" },
  ];

  return (
    <div className="space-y-6">
      {/* Derived-feed notice: shown when KPI collections are empty but completed
          jobs exist — explains why tiles below are populated from operational data. */}
      {isUsingDerivedFeed && (
        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="flex items-start gap-3 py-4">
            <Info className="h-5 w-5 text-blue-400 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-blue-400">Showing derived impact from completed jobs</p>
              <p className="text-xs text-muted-foreground mt-1">
                Fuel, emissions, and maintenance collections are empty. These tiles are calculated from the {derivedJobsCompleted} completed job{derivedJobsCompleted !== 1 ? "s" : ""} (panel weights + replacement-cost savings). Capture fuel baselines or file emissions reports in the tabs below to swap in the dedicated KPI feed.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ASRS Deadline Banner */}
      <Card className="border-orange-500/50 bg-orange-500/10">
        <CardContent className="flex items-center gap-4 py-4">
          <AlertTriangle className="h-6 w-6 text-orange-500 shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-orange-400">
              ASRS Group 2 Reporting Deadline
            </p>
            <p className="text-sm text-muted-foreground">
              Mandatory Scope 1 emissions data due by 1 July 2026
            </p>
          </div>
          <Badge variant={daysUntilAsrs <= 30 ? "destructive" : daysUntilAsrs <= 90 ? "default" : "secondary"} className="text-lg px-4 py-1">
            {daysUntilAsrs} days
          </Badge>
        </CardContent>
      </Card>

      {/* KPI Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Fuel Saved</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalFuelSaved.toLocaleString(undefined, { maximumFractionDigits: 0 })} L</div>
            <p className="text-xs text-muted-foreground">Total diesel saved annually</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">CO2 Avoided</CardTitle>
            <Leaf className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalCo2Avoided.toFixed(1)} t</div>
            <p className="text-xs text-muted-foreground">Tonnes CO2 per year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cost Savings</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalCostSavings.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <p className="text-xs text-muted-foreground">
              {fuelRecords.length > 0 ? "Fuel savings AUD/year" : "Replacement value saved (derived from jobs)"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">{vehiclesTracked > 0 ? "Vehicles" : "Jobs Completed"}</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vehiclesTracked > 0 ? vehiclesTracked : derivedJobsCompleted}</div>
            <p className="text-xs text-muted-foreground">
              {vehiclesTracked > 0 ? "Tracked across all KPIs" : "Completed jobs feeding derived KPIs"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Temp Reduction</CardTitle>
            <Thermometer className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgTempDelta.toFixed(1)} &deg;C</div>
            <p className="text-xs text-muted-foreground">Avg cabin temp reduction</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Cost Avoided</CardTitle>
            <Wrench className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalReplacementCostAvoided.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
            <p className="text-xs text-muted-foreground">Replacement cost avoided</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Satisfaction</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgSatisfaction !== null ? `${avgSatisfaction.toFixed(1)}/5` : "—"}</div>
            <p className="text-xs text-muted-foreground">Avg client rating (ISO 9001)</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Recommend</CardTitle>
            <Star className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{recommendRate !== null ? `${recommendRate.toFixed(0)}%` : "—"}</div>
            <p className="text-xs text-muted-foreground">{surveys.length} survey{surveys.length !== 1 ? "s" : ""} received</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {fuelByOrg.length > 0 ? "Fuel Savings by Organisation" : "Top Clients by Jobs Completed"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {fuelByOrg.length > 0 ? (
              <ChartContainer config={fuelChartConfig} className="h-[300px] w-full">
                <BarChart data={fuelByOrg} layout="vertical" margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="litres" fill="var(--color-litres)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : derivedMetrics && derivedMetrics.topClients.length > 0 ? (
              <ChartContainer config={fuelChartConfig} className="h-[300px] w-full">
                <BarChart
                  data={derivedMetrics.topClients.slice(0, 10).map((c) => ({
                    name: c.name.length > 15 ? c.name.slice(0, 15) + "..." : c.name,
                    litres: c.jobs,
                  }))}
                  layout="vertical"
                  margin={{ left: 10, right: 10 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={100} fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="litres" fill="var(--color-litres)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No fuel data or completed jobs yet. Add fuel records in the Fuel &amp; Energy tab.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {co2Trend.length > 0 ? "CO2 Avoided Trend" : "Operational Delivery (derived)"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {co2Trend.length > 0 ? (
              <ChartContainer config={co2ChartConfig} className="h-[300px] w-full">
                <LineChart data={co2Trend} margin={{ left: 10, right: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="period" fontSize={12} />
                  <YAxis fontSize={12} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="tonnes" stroke="var(--color-tonnes)" strokeWidth={2} dot />
                </LineChart>
              </ChartContainer>
            ) : derivedMetrics ? (
              <div className="grid grid-cols-2 gap-3 h-[300px] content-center">
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-3xl font-bold">{derivedMetrics.operations.jobsCompleted}</p>
                  <p className="text-xs text-muted-foreground">Jobs completed</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-3xl font-bold text-green-400">{derivedMetrics.glassSavedKg.toFixed(0)}</p>
                  <p className="text-xs text-muted-foreground">kg glass saved</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-3xl font-bold">{derivedMetrics.downtimeSavedHours.toFixed(0)}h</p>
                  <p className="text-xs text-muted-foreground">Downtime avoided</p>
                </div>
                <div className="rounded-lg border p-3 text-center">
                  <p className="text-3xl font-bold text-green-400">{derivedCo2Tonnes.toFixed(2)}t</p>
                  <p className="text-xs text-muted-foreground">CO2 avoided (est.)</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No emissions reports yet. Add reports in the Emissions / ESG tab.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* KPI Category Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">KPI Module Status</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {kpiCategories.map((cat) => (
              <div key={cat.label} className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium text-sm">{cat.label}</p>
                  <Badge variant={cat.priority === "P0" ? "destructive" : "secondary"} className="mt-1 text-xs">
                    {cat.priority}
                  </Badge>
                </div>
                <Badge
                  variant={cat.status === "active" ? "default" : cat.status === "derived" ? "secondary" : "outline"}
                  className="text-xs"
                >
                  {cat.status}
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
