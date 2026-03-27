"use client";

import { Leaf, Recycle, Timer, DollarSign } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface EnvData {
  glassSavedKg: number;
  replacementValueSaved: number;
  downtimeSavedHours: number;
}

interface Props {
  total: EnvData;
  filtered?: EnvData;
  selectedOrgName?: string;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatHours(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0h";
  return `${value.toFixed(1)}h`;
}

function MetricRow({ data, label }: { data: EnvData; label?: string }) {
  return (
    <div className="space-y-3">
      {label && (
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-emerald-500/10 p-2.5">
            <Recycle className="h-5 w-5 text-emerald-400" />
          </div>
          <div>
            <div className="text-xl font-bold">{data.glassSavedKg.toFixed(1)} kg</div>
            <div className="text-xs text-muted-foreground">Glass diverted from landfill</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-blue-500/10 p-2.5">
            <DollarSign className="h-5 w-5 text-blue-400" />
          </div>
          <div>
            <div className="text-xl font-bold">{formatCurrency(data.replacementValueSaved)}</div>
            <div className="text-xs text-muted-foreground">Replacement value avoided</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-amber-500/10 p-2.5">
            <Timer className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <div className="text-xl font-bold">{formatHours(data.downtimeSavedHours)}</div>
            <div className="text-xs text-muted-foreground">Client downtime avoided</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EnvironmentalImpact({ total, filtered, selectedOrgName }: Props) {
  const showFiltered = filtered && selectedOrgName;

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 overflow-hidden">
      <div className="relative px-6 py-3 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-emerald-500/10">
        <div className="flex items-center gap-2">
          <Leaf className="h-4 w-4 text-emerald-400" />
          <span className="font-headline font-semibold text-sm text-emerald-400">
            Environmental &amp; Sustainability (ISO 14001)
          </span>
        </div>
      </div>
      <CardContent className="pt-5 space-y-5">
        {showFiltered && (
          <MetricRow data={filtered} label={selectedOrgName} />
        )}

        <MetricRow
          data={total}
          label={showFiltered ? "All Organisations (Total)" : undefined}
        />

        <p className="text-xs text-muted-foreground">
          Repair over replacement — glass life extension reduces waste, cost, and vehicle downtime per ISO 14001 objectives.
        </p>
      </CardContent>
    </Card>
  );
}
