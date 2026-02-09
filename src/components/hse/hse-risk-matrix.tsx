"use client";

import { cn } from "@/lib/utils";
import {
  HSE_CONSEQUENCE,
  HSE_LIKELIHOOD,
  hseRiskLevelFromScore,
  hseRiskScore,
} from "@/lib/hse-risk";
import type { RiskAssessmentRiskLevel } from "@/lib/types";

const cellStyles: Record<RiskAssessmentRiskLevel, string> = {
  low: "bg-emerald-500/10 text-emerald-200/90",
  medium: "bg-amber-500/10 text-amber-200/90",
  high: "bg-orange-500/10 text-orange-200/90",
  critical: "bg-red-500/10 text-red-200/90",
};

export function HseRiskMatrix() {
  const likelihoodRows = [...HSE_LIKELIHOOD].sort((a, b) => b.value - a.value);

  return (
    <div className="overflow-x-auto rounded-lg border border-border/50 bg-card/40">
      <div className="min-w-[680px]">
        <div className="grid grid-cols-6 border-b border-border/50">
          <div className="p-2 text-xs font-medium text-muted-foreground">
            Likelihood \ Consequence
          </div>
          {HSE_CONSEQUENCE.map((consequence) => (
            <div key={consequence.value} className="p-2 text-center text-xs font-medium">
              {consequence.value}
              <div className="text-[10px] text-muted-foreground">{consequence.short}</div>
            </div>
          ))}
        </div>

        {likelihoodRows.map((likelihood) => (
          <div key={likelihood.value} className="grid grid-cols-6 border-b border-border/50">
            <div className="p-2 text-xs font-medium">
              {likelihood.value}
              <div className="text-[10px] text-muted-foreground">{likelihood.short}</div>
            </div>
            {HSE_CONSEQUENCE.map((consequence) => {
              const score = hseRiskScore(likelihood.value, consequence.value);
              const level = hseRiskLevelFromScore(score);
              return (
                <div
                  key={`${likelihood.value}-${consequence.value}`}
                  className={cn(
                    "p-2 text-center text-xs border-l border-border/50",
                    cellStyles[level]
                  )}
                >
                  <div className="font-semibold">{score}</div>
                  <div className="text-[10px] uppercase tracking-wide opacity-80">{level}</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

