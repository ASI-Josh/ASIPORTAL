// Mock data kept for backwards compatibility (CRM pipeline now uses real Firestore data)
export const PIPELINE_STAGES: { id: string; title: string }[] = [
  { id: "identified", title: "Identified" },
  { id: "researched", title: "Researched" },
  { id: "contacted", title: "Contacted" },
  { id: "engaged", title: "Engaged" },
  { id: "qualified", title: "Qualified" },
  { id: "proposal_sent", title: "Proposal Sent" },
  { id: "negotiation", title: "Negotiation" },
  { id: "won", title: "Won" },
  { id: "lost", title: "Lost" },
  { id: "nurture", title: "Nurture" },
];

export const mockLeads: unknown[] = [];

export const mockJobsDisplay = [
  { id: "JOB-001", title: "Windshield Repair", client: "John Doe", status: "completed" as const, assigned: "Tech 1" },
  { id: "JOB-002", title: "Film Installation", client: "Jane Smith", status: "in_progress" as const, assigned: "Tech 2" },
];

export const revenueData = [
  { month: "Jan", revenue: 4000 },
  { month: "Feb", revenue: 3000 },
  { month: "Mar", revenue: 5000 },
  { month: "Apr", revenue: 4500 },
  { month: "May", revenue: 6000 },
  { month: "Jun", revenue: 5500 },
  { month: "Jul", revenue: 7000 },
];
