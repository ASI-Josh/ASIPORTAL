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
import { Fuel, Leaf, Thermometer, Wrench, Zap, AlertTriangle, Star } from "lucide-react";
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

interface KpiOverviewProps {
  fuelRecords: FuelRecord[];
  emissionsReports: EmissionsReport[];
  telemetryReadings: TelemetryReading[];
  maintenanceEvents: MaintenanceEvent[];
  snapshots: KpiSnapshot[];
  organizations: ContactOrganization[];
  surveys?: SatisfactionSurvey[];
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
}: KpiOverviewProps) {
  const totalFuelSaved = useMemo(() => {
    return fuelRecords.reduce((sum, r) => {
      if (r.fuelDeltaLPer100km && r.annualDistanceKm) {
        return sum + (r.fuelDeltaLPer100km * r.annualDistanceKm) / 100;
      }
      return sum;
    }, 0);
  }, [fuelRecords]);

  const totalCo2Avoided = useMemo(() => {
    const fromFuel = totalFuelSaved * DIESEL_CO2_FACTOR_KG_PER_LITRE / 1000;
    const fromReports = emissionsReports.reduce(
      (sum, r) => sum + (r.scope1?.co2AvoidedTonnes || 0), 0
    );
    return fromReports > 0 ? fromReports : fromFuel;
  }, [totalFuelSaved, emissionsReports]);

  const totalCostSavings = useMemo(() => {
    return fuelRecords.reduce(
      (sum, r) => sum + (r.estimatedCostSavingsPerYear || 0), 0
    );
  }, [fuelRecords]);

  const vehiclesTracked = useMemo(() => {
    const regs = new Set<string>();
    fuelRecords.forEach((r) => regs.add(r.vehicleRegistration));
    telemetryReadings.forEach((r) => regs.add(r.vehicleRegistration));
    return regs.size;
  }, [fuelRecords, telemetryReadings]);

  const totalReplacementCostAvoided = useMemo(() => {
    return maintenanceEvents.reduce(
      (sum, e) => sum + (e.replacementCostAvoided || 0), 0
    );
  }, [maintenanceEvents]);

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

  const kpiCategories = [
    { label: "Fuel & Energy", status: fuelRecords.length > 0 ? "active" : "awaiting data", priority: "P0" },
    { label: "Emissions / ESG", status: emissionsReports.length > 0 ? "active" : "awaiting data", priority: "P0" },
    { label: "HVAC / Telemetry", status: telemetryReadings.length > 0 ? "active" : "awaiting data", priority: "P1" },
    { label: "Maintenance", status: maintenanceEvents.length > 0 ? "active" : "awaiting data", priority: "P1" },
    { label: "Client Satisfaction", status: surveys.length > 0 ? "active" : "awaiting data", priority: "ISO" },
  ];

  return (
    <div className="space-y-6">
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
            <p className="text-xs text-muted-foreground">Fuel savings AUD/year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Vehicles</CardTitle>
            <Fuel className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vehiclesTracked}</div>
            <p className="text-xs text-muted-foreground">Tracked across all KPIs</p>
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
            <CardTitle className="text-lg">Fuel Savings by Organisation</CardTitle>
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
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No fuel data recorded yet. Add fuel records in the Fuel &amp; Energy tab.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">CO2 Avoided Trend</CardTitle>
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
                <Badge variant={cat.status === "active" ? "default" : "outline"} className="text-xs">
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
