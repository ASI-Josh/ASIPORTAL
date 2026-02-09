import { Timestamp } from "firebase/firestore";

import type {
  ImsIncidentCategory,
  ImsIncidentHazard,
  ImsIncidentStatus,
  ImsRiskDomain,
} from "@/lib/types";

export const DEFAULT_INCIDENT_HAZARDS: ImsIncidentHazard[] = [
  {
    id: "vehicle_movement",
    label: "Vehicle/bus movement in work zone",
    present: false,
    riskLevel: "medium",
    controls: "Traffic management, spotter, exclusion zone.",
  },
  {
    id: "manual_handling",
    label: "Manual handling / heavy lifting",
    present: false,
    riskLevel: "medium",
    controls: "Team lift, mechanical aids, safe technique.",
  },
  {
    id: "slips_trips",
    label: "Slips, trips, uneven surfaces",
    present: false,
    riskLevel: "medium",
    controls: "Housekeeping, clear walkways, signage.",
  },
  {
    id: "working_at_height",
    label: "Working at height (steps/ladders/platforms)",
    present: false,
    riskLevel: "medium",
    controls: "Approved access equipment, 3 points of contact.",
  },
  {
    id: "chemicals",
    label: "Chemical exposure (cleaners/solvents/coatings)",
    present: false,
    riskLevel: "medium",
    controls: "SDS review, PPE, ventilation.",
  },
  {
    id: "electrical",
    label: "Electrical hazard / powered tools",
    present: false,
    riskLevel: "medium",
    controls: "Inspect leads/tools, RCD, isolate where required.",
  },
  {
    id: "glass_breakage",
    label: "Broken glass / sharp edges",
    present: false,
    riskLevel: "high",
    controls: "Cut-resistant gloves, containment, safe disposal.",
  },
  {
    id: "environmental_spill",
    label: "Environmental spill/contamination",
    present: false,
    riskLevel: "high",
    controls: "Spill kit, containment, notify site, disposal per SOP.",
  },
];

export function mergeHazards(
  current: ImsIncidentHazard[] | undefined
): ImsIncidentHazard[] {
  const hazards = current || [];
  return DEFAULT_INCIDENT_HAZARDS.map((hazard) => {
    const match = hazards.find((item) => item.id === hazard.id);
    return match ? { ...hazard, ...match } : { ...hazard };
  });
}

export function incidentStatusBadge(status: ImsIncidentStatus) {
  switch (status) {
    case "closed":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "actions_required":
      return "bg-amber-500/20 text-amber-300 border-amber-500/30";
    case "investigating":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    case "reported":
      return "bg-purple-500/20 text-purple-300 border-purple-500/30";
    default:
      return "bg-muted text-muted-foreground border-border/40";
  }
}

export function mapIncidentCategoryToDomain(category: ImsIncidentCategory): ImsRiskDomain {
  switch (category) {
    case "environment":
      return "environment";
    case "quality":
      return "quality";
    default:
      return "whs";
  }
}

export function toDateTimeLocalInput(value?: Timestamp) {
  if (!value) return "";
  const date = value.toDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

export function parseDateTimeLocalInput(value: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return Timestamp.fromDate(date);
}

