// ─── ASI OSINT Types ──────────────────────────────────────────────────────────

export type OSINTPillarId =
  | "glass-coating"
  | "bus-coach"
  | "fleet-maintenance"
  | "sustainability";

export type FindingTag = "direct-relevance" | "pivot-opportunity" | "high-urgency";
export type FindingRelevance = 1 | 2 | 3 | 4 | 5;
export type OpportunityUrgency = "immediate" | "near-term" | "watch";

export interface OSINTFinding {
  id: string;
  headline: string;
  source: string;
  url: string;
  date: string;
  summary: string;
  relevance: FindingRelevance;
  tags: FindingTag[];
  pillarId: OSINTPillarId;
}

export interface OSINTPillar {
  id: OSINTPillarId;
  name: string;
  icon: string;       // Lucide icon name
  color: string;      // Tailwind color (blue | purple | amber | emerald)
  findings: OSINTFinding[];
}

export interface OSINTOpportunity {
  rank: number;
  name: string;
  pillar: string;
  relevanceScore: number;
  action: string;
  urgency: OpportunityUrgency;
}

export interface OSINTScan {
  date: string;           // "2026-03-23"
  generatedAt: string;    // ISO 8601
  executiveSummary: string[];
  pillars: OSINTPillar[];
  opportunityMatrix: OSINTOpportunity[];
  metadata: {
    totalFindings: number;
    pillarCounts: Record<string, number>;
    highRelevanceCount: number;
    urgentCount: number;
    topOpportunity?: string;
  };
}

// Lightweight record stored in Firestore (full scan stored as separate doc)
export interface OSINTScanMeta {
  date: string;
  generatedAt: string;
  totalFindings: number;
  highRelevanceCount: number;
  urgentCount: number;
  topOpportunity: string;
  pillarCounts: Record<string, number>;
}
