"use client";

import { Leaf, Recycle, Timer, DollarSign } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface Props {
  glassSavedKg: number;
  replacementValueSaved: number;
  downtimeSavedHours: number;
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

export function EnvironmentalImpact({ glassSavedKg, replacementValueSaved, downtimeSavedHours }: Props) {
  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Leaf className="h-4 w-4 text-emerald-400" />
          Environmental &amp; Sustainability (ISO 14001)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-emerald-500/10 p-2.5">
              <Recycle className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <div className="text-xl font-bold">{glassSavedKg.toFixed(1)} kg</div>
              <div className="text-xs text-muted-foreground">Glass diverted from landfill</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-500/10 p-2.5">
              <DollarSign className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <div className="text-xl font-bold">{formatCurrency(replacementValueSaved)}</div>
              <div className="text-xs text-muted-foreground">Replacement value avoided</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-amber-500/10 p-2.5">
              <Timer className="h-5 w-5 text-amber-400" />
            </div>
            <div>
              <div className="text-xl font-bold">{formatHours(downtimeSavedHours)}</div>
              <div className="text-xs text-muted-foreground">Client downtime avoided</div>
            </div>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Repair over replacement — glass life extension reduces waste, cost, and vehicle downtime per ISO 14001 objectives.
        </p>
      </CardContent>
    </Card>
  );
}
