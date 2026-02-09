import type { RiskAssessmentRiskLevel } from "@/lib/types";

export type RiskMatrixRating = 1 | 2 | 3 | 4 | 5;

export const HSE_LIKELIHOOD: Array<{ value: RiskMatrixRating; label: string; short: string }> = [
  { value: 1, label: "Rare", short: "Rare" },
  { value: 2, label: "Unlikely", short: "Unlikely" },
  { value: 3, label: "Possible", short: "Possible" },
  { value: 4, label: "Likely", short: "Likely" },
  { value: 5, label: "Almost Certain", short: "A. Certain" },
];

export const HSE_CONSEQUENCE: Array<{ value: RiskMatrixRating; label: string; short: string }> = [
  { value: 1, label: "Insignificant", short: "Insig." },
  { value: 2, label: "Minor", short: "Minor" },
  { value: 3, label: "Moderate", short: "Mod." },
  { value: 4, label: "Major", short: "Major" },
  { value: 5, label: "Severe", short: "Severe" },
];

export function clampRiskRating(value: number): RiskMatrixRating {
  if (value <= 1) return 1;
  if (value >= 5) return 5;
  return value as RiskMatrixRating;
}

export function hseRiskScore(likelihood: number, consequence: number) {
  const l = clampRiskRating(likelihood);
  const c = clampRiskRating(consequence);
  return l * c;
}

export function hseRiskLevelFromScore(score: number): RiskAssessmentRiskLevel {
  if (score >= 17) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}

export function hseDefaultRatingsForLevel(level: RiskAssessmentRiskLevel): {
  likelihood: RiskMatrixRating;
  consequence: RiskMatrixRating;
} {
  switch (level) {
    case "low":
      return { likelihood: 2, consequence: 2 };
    case "medium":
      return { likelihood: 3, consequence: 3 };
    case "high":
      return { likelihood: 4, consequence: 4 };
    case "critical":
      return { likelihood: 5, consequence: 5 };
    default:
      return { likelihood: 3, consequence: 3 };
  }
}

