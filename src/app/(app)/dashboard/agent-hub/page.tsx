"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  Bot, Brain, Eye, Globe, Landmark,
  Scale, SendHorizonal, ShieldCheck, TrendingUp,
  Users, ChevronDown, ChevronUp, Package, Target, Crown, Gavel,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import ArcherWorkspace from "@/components/agent-hub/archer-workspace";
import ArcherChat from "@/components/agent-hub/archer-chat";

// ─── Agent org chart data ─────────────────────────────────────────────────────

type AgentDef = {
  id: string;
  name: string;         // Codename, e.g. "LEDGER"
  humanName?: string;   // Human correspondence name, e.g. "James Ledger"
  title: string;
  domain: string;
  icon: typeof Bot;
  color: string;        // tailwind colour class
  bgColor: string;
  borderColor: string;
  stream?: string;
  description: string;
  capabilities: string[];
  email?: string;       // Operating mailbox, e.g. "accountmanager@asi-australia.com.au"
  emailSignatureNote?: string; // Additional note for shared mailboxes, e.g. "Sales Preset Signature"
  link?: string;
  feedsTo?: string[];   // Agent IDs this one supplies intelligence to (dashed lines)
};

// ─── Director (human) — top of structure ──────────────────────────────────
// Displayed above ATHENA in the org chart. Placeholder for the human
// leadership layer; will expand into a full corp structure as ASI grows.
const DIRECTOR_DEF = {
  id: "director",
  name: "JOSHUA HYDE",
  title: "Director",
  domain: "ASI Australia",
  color: "text-yellow-300",
  bgColor: "bg-yellow-500/10",
  borderColor: "border-yellow-500/30",
};

const ATHENA_DEF: AgentDef = {
  id: "athena",
  name: "ATHENA",
  humanName: "Athena Pallas",
  title: "Chief of Staff",
  domain: "Executive Intelligence",
  icon: Brain,
  color: "text-violet-400",
  bgColor: "bg-violet-500/10",
  borderColor: "border-violet-500/30",
  description: "Cross-department synthesis, daily ops briefs, weekly company reports, strategic decisions. Jim Collins frameworks.",
  capabilities: ["Morning briefs", "Weekly company reports", "Decision briefs", "Cross-department analysis", "Strategic pattern recognition"],
};

/**
 * Build the display headline for an agent card. If the agent has a human
 * first name we merge it with the codename (e.g. "JAMES LEDGER"); otherwise
 * we use the codename alone (e.g. "CIPHER", "MERIDIAN").
 */
function buildAgentHeadline(agent: AgentDef): string {
  if (!agent.humanName) return agent.name;
  const firstName = agent.humanName.split(" ")[0];
  if (!firstName) return agent.name;
  return `${firstName.toUpperCase()} ${agent.name}`;
}

// ─── Divisional structure ──────────────────────────────────────────────────
//
// Each division is a business unit with its own colour theme and one or
// more agents. Rendered as a column on the org chart. Sub-divisions nest
// under a parent agent within the same column (e.g. Sophie Archer's R&D
// sits under James Ledger inside the Finance column).
//
// MERIDIAN is NOT in any division — she sits in the Shared Resources
// strip below the main grid and feeds intel to SENTINEL + VANGUARD.

type SuperDivisionId = "asi_services" | "apeax_distribution";

type Division = {
  id: string;
  name: string;
  subtitle: string;
  color: string;        // header text colour
  borderColor: string;  // column border
  bgColor: string;      // column background tint
  superDivision: SuperDivisionId; // top-level grouping (Services vs APEAX)
  agents: string[];     // primary agent IDs in this division (in display order)
  subDivisions?: {
    parentAgentId: string;  // the agent this sub-division reports through
    name: string;
    agents: string[];
  }[];
};

const SUPER_DIVISIONS: Record<SuperDivisionId, { label: string; subtitle: string; color: string }> = {
  asi_services: {
    label: "ASI Services / Operations",
    subtitle: "Core business operations across finance, growth, compliance, digital and people",
    color: "text-sky-300",
  },
  apeax_distribution: {
    label: "APEAX Films Distribution",
    subtitle: "Exclusive Australian distribution channel for APEAX USA film products",
    color: "text-violet-300",
  },
};

const DIVISIONS: Division[] = [
  {
    id: "finance",
    name: "Finance",
    subtitle: "Accounts · Cash flow · R&D funding",
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgColor: "bg-amber-500/5",
    superDivision: "asi_services",
    agents: ["ledger"],
    subDivisions: [
      {
        parentAgentId: "ledger",
        name: "R&D Sub-Division",
        agents: ["archer"],
      },
    ],
  },
  {
    id: "growth_intel",
    name: "Growth & Intelligence",
    subtitle: "Sales · Supply chain · Innovation",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgColor: "bg-emerald-500/5",
    superDivision: "asi_services",
    agents: ["vanguard", "sentinel"],
    subDivisions: [
      {
        parentAgentId: "sentinel",
        name: "Passenger Vehicle & Trade Sales",
        agents: ["mercer"],
      },
    ],
  },
  {
    id: "legal_compliance",
    name: "Legal & Compliance",
    subtitle: "IMS · Legal · Risk",
    color: "text-orange-400",
    borderColor: "border-orange-500/30",
    bgColor: "bg-orange-500/5",
    superDivision: "asi_services",
    agents: ["guardian", "blackstone"],
  },
  {
    id: "digital_infra",
    name: "Digital Infrastructure",
    subtitle: "IT · Web · Integrations",
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    bgColor: "bg-cyan-500/5",
    superDivision: "asi_services",
    agents: ["cipher"],
  },
  {
    id: "resources",
    name: "Human & AI Resources",
    subtitle: "Onboarding · Training · Inductions",
    color: "text-pink-400",
    borderColor: "border-pink-500/30",
    bgColor: "bg-pink-500/5",
    superDivision: "asi_services",
    agents: ["vesta"],
  },
  {
    id: "distribution",
    name: "Distribution",
    subtitle: "APEAX trade channel",
    color: "text-violet-400",
    borderColor: "border-violet-500/30",
    bgColor: "bg-violet-500/5",
    superDivision: "apeax_distribution",
    agents: ["shield"],
  },
];

// Agents that sit in the shared resources strip below the main divisions
const SHARED_RESOURCE_AGENT_IDS = ["meridian"];

const AGENTS: AgentDef[] = [
  {
    id: "vanguard",
    name: "VANGUARD",
    humanName: "Peter Vanguard",
    title: "Innovation, Technology & Supply Chain Manager",
    domain: "External Intelligence",
    icon: Eye,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    stream: "supply_chain",
    description: "External OSINT scanning, supply chain lead qualification & full lifecycle, market mode assessment, innovation scouting.",
    capabilities: ["Daily OSINT scans (4 pillars)", "BANT-Plus scoring", "Supply chain pipeline", "Market mode assessment"],
    email: "development@asi-australia.com.au",
    emailSignatureNote: "Supplier preset signature",
  },
  {
    id: "sentinel",
    name: "SENTINEL",
    humanName: "David Sentinel",
    title: "Business Development & Sales Manager",
    domain: "Revenue · HV/Bus/Coach/Fleet",
    icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    stream: "sales",
    description: "Heavy vehicle, bus/coach and commercial fleet sales. Direct report: Emily Mercer (Passenger & Trade). Lead qualification, client outreach, proposals, discovery, revenue conversion across HV markets.",
    capabilities: ["HV/Bus/Coach pipeline", "Fleet sales", "Outreach sequences", "Proposal support"],
    email: "development@asi-australia.com.au",
    emailSignatureNote: "Sales preset signature",
    feedsTo: ["shield"],
  },
  {
    id: "mercer",
    name: "MERCER",
    humanName: "Emily Mercer",
    title: "Passenger Vehicle & Trade Sales Specialist",
    domain: "Revenue · Light Vehicle/Trade",
    icon: TrendingUp,
    color: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/30",
    stream: "sales",
    description: "Passenger vehicle and trade sales specialist. Reports to David Sentinel. Owns light vehicle market engagement and trade channel sales support — the consumer-facing and trade-segment slice of the sales stream.",
    capabilities: ["Passenger vehicle pipeline", "Trade sales", "Consumer engagement", "Light vehicle strategy"],
    email: "development@asi-australia.com.au",
    emailSignatureNote: "MERCER preset signature (light vehicle / trade)",
  },
  {
    id: "archer",
    name: "ARCHER",
    humanName: "Sophie Archer",
    title: "R&D & Grants Manager",
    domain: "Innovation & Funding",
    icon: Target,
    color: "text-fuchsia-400",
    bgColor: "bg-fuchsia-500/10",
    borderColor: "border-fuchsia-500/30",
    stream: "rnd_grants",
    description: "R&D programme register, grant identification & applications, innovation funding pipeline, capability gap analysis, modernisation pathways. Intake from management meetings (SENTINEL / VANGUARD signals). Approval chain: Archer designs → ATHENA review → Director sign-off.",
    capabilities: ["R&D project register", "Grants pipeline", "Opportunity log", "Modernisation pathways"],
    email: "development@asi-australia.com.au",
    emailSignatureNote: "R&D preset signature",
  },
  {
    id: "ledger",
    name: "LEDGER",
    humanName: "James Ledger",
    title: "CFO & Accounts Management",
    domain: "Finance",
    icon: Landmark,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    description: "Xero invoicing, job close-out, cost auditing, financial reporting, GST, cash flow forecasting, supplier payments, weekly CFO report to ATHENA.",
    capabilities: ["Full Xero operations (46 endpoints)", "Job close-out", "Cash flow forecasting", "Weekly CFO report"],
    email: "accountmanager@asi-australia.com.au",
    link: "/dashboard/crm",
  },
  {
    id: "guardian",
    name: "GUARDIAN",
    humanName: "Hanzel Guardian",
    title: "IMS Manager",
    domain: "Compliance",
    icon: ShieldCheck,
    color: "text-orange-400",
    bgColor: "bg-orange-500/10",
    borderColor: "border-orange-500/30",
    description: "IMS audits (ISO 9001/14001/45001), document control, incidents, CAPAs, risk register.",
    capabilities: ["Internal audits", "Document control", "Incident management", "CAPA tracking", "Risk register"],
    link: "/dashboard/ims",
  },
  {
    id: "blackstone",
    name: "BLACKSTONE",
    humanName: "William Blackstone",
    title: "Legal Management",
    domain: "Legal",
    icon: Gavel,
    color: "text-amber-300",
    bgColor: "bg-amber-300/10",
    borderColor: "border-amber-300/30",
    description: "Internal legal review, contract analysis, compliance interpretation, risk flagging. Internal-only — ATHENA sends on behalf for external comms.",
    capabilities: ["Contract review", "Compliance interpretation", "Legal research", "Risk flagging"],
    emailSignatureNote: "Internal only — ATHENA sends on behalf",
  },
  {
    id: "vesta",
    name: "VESTA",
    humanName: "Vesta Hearth",
    title: "Human & AI Resources Manager",
    domain: "People Ops",
    icon: Users,
    color: "text-pink-400",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/30",
    description: "Human staff onboarding, inductions, training, requals. AI agent onboarding, induction and protocol training for new agents as they come online.",
    capabilities: ["Human onboarding", "Training & requals", "AI agent induction", "Role documentation"],
    email: "resources@asi-australia.com.au",
    emailSignatureNote: "Resources preset signature",
  },
  {
    id: "cipher",
    name: "CIPHER",
    title: "IT & Digital",
    domain: "Digital",
    icon: Globe,
    color: "text-cyan-400",
    bgColor: "bg-cyan-500/10",
    borderColor: "border-cyan-500/30",
    description: "Website, SEO, IT infrastructure, tech integration.",
    capabilities: ["Website management", "SEO strategy", "IT infrastructure", "Tech integration"],
  },
  {
    id: "meridian",
    name: "MERIDIAN",
    title: "Critical Intelligence",
    domain: "Intelligence",
    icon: Scale,
    color: "text-rose-400",
    bgColor: "bg-rose-500/10",
    borderColor: "border-rose-500/30",
    description: "Geopolitical & institutional analysis. Supplies intel to SENTINEL (sales) and VANGUARD (supply chain).",
    capabilities: ["Geopolitical analysis", "Institutional intelligence", "Policy impact assessment"],
    feedsTo: ["sentinel", "vanguard"],
  },
  {
    id: "shield",
    name: "SHIELD",
    humanName: "Angela Shield",
    title: "APEAX Distribution Agent",
    domain: "Trade Channel Ops",
    icon: Package,
    color: "text-violet-400",
    bgColor: "bg-violet-500/10",
    borderColor: "border-violet-500/30",
    description: "Exclusive APEAX AU distribution. Trade installer vetting, quoting, orders, PO to APEAX USA, GUARDIAN QA hold, warranty registration, invoicing, close-out.",
    capabilities: ["Trade vetting", "Order validation", "APEAX USA PO", "Warranty registration", "Installer invoicing"],
  },
];

// ─── Chat types ───────────────────────────────────────────────────────────────

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

const ATHENA_PROMPTS = [
  "Give me the morning brief.",
  "What needs my attention today?",
  "Company overview — where are we at?",
  "What's at risk this week?",
  "Prep me for the weekly report.",
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function AgentHubPage() {
  const { user, firebaseUser } = useAuth();
  const firstName = useMemo(() => {
    const raw = user?.name?.trim() || user?.email?.split("@")[0] || "there";
    return raw.split(" ")[0];
  }, [user?.name, user?.email]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  // Personalised welcome — re-evaluates once auth resolves so Bobby/Jay don't
  // see the founder's name on sign-in.
  useEffect(() => {
    if (!user) return;
    const hour = new Date().getHours();
    const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      return [{
        id: "welcome",
        role: "assistant",
        content: `${greeting}, ${firstName}. I'm ATHENA — ASI's Chief of Staff. I have real-time access to all departments via the portal and can help you assign, track, or close out work. What do you need?`,
      }];
    });
  }, [user, firstName]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [orgExpanded, setOrgExpanded] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const historyPayload = useMemo(() => {
    return messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || !firebaseUser) return;
    const text = content.trim();
    setMessages((prev) => [...prev, { id: `${Date.now()}-user`, role: "user", content: text }]);
    setInput("");
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/knowledge-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          context: "dashboard",
          agentOverride: "athena",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-assistant`, role: "assistant", content: data.answer || "Ready for your next question." },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-error`, role: "assistant", content: `Error: ${err instanceof Error ? err.message : "Request failed."}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur"><CardContent className="p-6 text-muted-foreground">Agent Hub is restricted to ASI administrators.</CardContent></Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
            <Bot className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-headline font-semibold">Agent Hub</h1>
            <p className="text-sm text-muted-foreground">ASI&apos;s AI workforce — organisation chart and executive command</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/ims"><ShieldCheck className="mr-2 h-4 w-4" />IMS</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/osint"><Eye className="mr-2 h-4 w-4" />OSINT</Link>
          </Button>
        </div>
      </div>

      {/* Org Chart */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20 overflow-hidden">
        <button
          onClick={() => setOrgExpanded(!orgExpanded)}
          className="w-full flex items-center justify-between px-6 py-4 hover:bg-muted/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <span className="text-base font-semibold">ASI Organisation Chart</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{DIVISIONS.length} divisions · {AGENTS.length} agents</Badge>
          </div>
          {orgExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {orgExpanded && (
          <CardContent className="pt-0 pb-6">
            {/* DIRECTOR — human leadership, top of chart */}
            <div className="flex justify-center mb-3">
              <div className={cn("w-full max-w-sm rounded-xl border-2 p-3 text-center", DIRECTOR_DEF.borderColor, DIRECTOR_DEF.bgColor)}>
                <div className="flex items-center justify-center gap-2">
                  <Crown className={cn("h-5 w-5", DIRECTOR_DEF.color)} />
                  <span className={cn("text-base font-bold tracking-wide", DIRECTOR_DEF.color)}>{DIRECTOR_DEF.name}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{DIRECTOR_DEF.title} · {DIRECTOR_DEF.domain}</p>
              </div>
            </div>

            {/* Director → ATHENA connector */}
            <div className="flex justify-center mb-3">
              <div className="w-px h-6 bg-border/60" />
            </div>

            {/* ATHENA — Chief of Staff */}
            <div className="flex justify-center mb-3">
              <div className={cn("w-full max-w-md rounded-xl border-2 p-4 text-center", ATHENA_DEF.borderColor, ATHENA_DEF.bgColor)}>
                <div className="flex items-center justify-center gap-2 mb-1">
                  <Brain className={cn("h-6 w-6", ATHENA_DEF.color)} />
                  <span className={cn("text-lg font-bold tracking-wide", ATHENA_DEF.color)}>
                    {buildAgentHeadline(ATHENA_DEF)}
                  </span>
                </div>
                <p className="text-sm font-medium">{ATHENA_DEF.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{ATHENA_DEF.domain}</p>
              </div>
            </div>

            {/* ATHENA → Divisions connector */}
            <div className="flex justify-center mb-3">
              <div className="w-px h-6 bg-border/60" />
            </div>
            <div className="hidden md:block mx-auto mb-4" style={{ maxWidth: "calc(100% - 60px)" }}>
              <div className="h-px bg-border/60" />
            </div>

            {/* ── Super-division groups ── */}
            {/* ASI Services / Operations and APEAX Films Distribution each */}
            {/* get a header band above their division columns. */}
            {(Object.keys(SUPER_DIVISIONS) as SuperDivisionId[]).map((superDivId) => {
              const superDiv = SUPER_DIVISIONS[superDivId];
              const divisionsInGroup = DIVISIONS.filter((d) => d.superDivision === superDivId);
              if (divisionsInGroup.length === 0) return null;

              return (
                <div key={superDivId} className="mb-6 last:mb-0">
                  {/* Super-division header band */}
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-px flex-1 bg-border/50" />
                    <div className="text-center">
                      <p className={cn("text-[11px] font-bold uppercase tracking-widest", superDiv.color)}>
                        {superDiv.label}
                      </p>
                      <p className="text-[9px] text-muted-foreground italic mt-0.5">
                        {superDiv.subtitle}
                      </p>
                    </div>
                    <div className="h-px flex-1 bg-border/50" />
                  </div>

                  {/* Division columns within this super-division */}
                  <div
                    className={cn(
                      "grid gap-4",
                      divisionsInGroup.length === 1
                        ? "md:grid-cols-1"
                        : "md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
                    )}
                  >
                    {divisionsInGroup.map((division) => {
                // Primary agents for this division
                const primaryAgents = division.agents
                  .map((id) => AGENTS.find((a) => a.id === id))
                  .filter((a): a is AgentDef => Boolean(a));

                return (
                  <div
                    key={division.id}
                    className={cn(
                      "flex flex-col rounded-xl border-2 p-3",
                      division.borderColor,
                      division.bgColor
                    )}
                  >
                    {/* Division header */}
                    <div className="mb-3 pb-2 border-b border-border/30">
                      <p className={cn("text-xs font-bold uppercase tracking-widest", division.color)}>
                        {division.name}
                      </p>
                      <p className="text-[9px] text-muted-foreground italic mt-0.5">
                        {division.subtitle}
                      </p>
                    </div>

                    {/* Primary agent cards in this division */}
                    <div className="space-y-3">
                      {primaryAgents.map((agent) => {
                        const Icon = agent.icon;
                        const headline = buildAgentHeadline(agent);

                        // Any sub-divisions that nest under this agent
                        const nestedSubs = (division.subDivisions || []).filter(
                          (sub) => sub.parentAgentId === agent.id
                        );

                        return (
                          <div key={agent.id}>
                            {/* Agent card */}
                            <div
                              className={cn(
                                "flex flex-col rounded-lg border p-3 transition-all hover:scale-[1.01]",
                                agent.borderColor,
                                agent.bgColor
                              )}
                            >
                              <div className="flex items-start gap-2 mb-1.5">
                                <Icon className={cn("h-4 w-4 shrink-0 mt-0.5", agent.color)} />
                                <span className={cn("text-xs font-bold tracking-wide leading-tight", agent.color)}>
                                  {headline}
                                </span>
                              </div>
                              <p className="text-[10px] font-medium mb-2 leading-snug">
                                {agent.title}
                              </p>
                              <div className="space-y-0.5 mb-2">
                                {agent.capabilities.slice(0, 3).map((cap) => (
                                  <div key={cap} className="flex items-center gap-1 text-[9px] text-muted-foreground">
                                    <div className={cn("h-1 w-1 rounded-full", agent.color.replace("text-", "bg-"))} />
                                    {cap}
                                  </div>
                                ))}
                              </div>
                              {agent.feedsTo && agent.feedsTo.length > 0 && (
                                <div className="mb-2">
                                  <p className="text-[8px] uppercase tracking-wider text-muted-foreground mb-0.5">
                                    Feeds →
                                  </p>
                                  <div className="flex flex-wrap gap-1">
                                    {agent.feedsTo.map((targetId) => {
                                      const target = AGENTS.find((a) => a.id === targetId);
                                      if (!target) return null;
                                      return (
                                        <span
                                          key={targetId}
                                          className={cn(
                                            "rounded border border-dashed px-1 py-0.5 text-[8px] font-semibold",
                                            target.borderColor,
                                            target.color
                                          )}
                                        >
                                          {buildAgentHeadline(target)}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}
                              {(agent.email || agent.emailSignatureNote) && (
                                <div className="mt-auto pt-1.5 border-t border-border/30">
                                  {agent.email ? (
                                    <p className={cn("text-[9px] font-medium truncate", agent.color)}>
                                      {agent.email}
                                    </p>
                                  ) : (
                                    <p className="text-[9px] font-medium text-muted-foreground italic">
                                      Internal only
                                    </p>
                                  )}
                                  {agent.emailSignatureNote && (
                                    <p className="text-[8px] text-muted-foreground italic leading-snug">
                                      {agent.emailSignatureNote}
                                    </p>
                                  )}
                                </div>
                              )}
                              {agent.link && (
                                <Link
                                  href={agent.link}
                                  className={cn("block mt-1.5 text-[9px] font-semibold hover:underline", agent.color)}
                                >
                                  Open workspace →
                                </Link>
                              )}
                            </div>

                            {/* Sub-division nested underneath this agent */}
                            {nestedSubs.map((sub) => {
                              const subAgents = sub.agents
                                .map((id) => AGENTS.find((a) => a.id === id))
                                .filter((a): a is AgentDef => Boolean(a));
                              return (
                                <div key={sub.name} className="ml-3 mt-2 pl-3 border-l-2 border-dashed border-border/40">
                                  <p className="text-[8px] uppercase tracking-wider text-muted-foreground mb-1.5">
                                    ↳ {sub.name}
                                  </p>
                                  <div className="space-y-2">
                                    {subAgents.map((subAgent) => {
                                      const SubIcon = subAgent.icon;
                                      return (
                                        <div
                                          key={subAgent.id}
                                          className={cn(
                                            "flex flex-col rounded-lg border p-2.5",
                                            subAgent.borderColor,
                                            subAgent.bgColor
                                          )}
                                        >
                                          <div className="flex items-start gap-2 mb-1">
                                            <SubIcon className={cn("h-3.5 w-3.5 shrink-0 mt-0.5", subAgent.color)} />
                                            <span className={cn("text-[11px] font-bold tracking-wide leading-tight", subAgent.color)}>
                                              {buildAgentHeadline(subAgent)}
                                            </span>
                                          </div>
                                          <p className="text-[9px] font-medium mb-1 leading-snug">
                                            {subAgent.title}
                                          </p>
                                          {subAgent.email && (
                                            <div className="mt-auto pt-1 border-t border-border/30">
                                              <p className={cn("text-[9px] font-medium truncate", subAgent.color)}>
                                                {subAgent.email}
                                              </p>
                                              {subAgent.emailSignatureNote && (
                                                <p className="text-[8px] text-muted-foreground italic leading-snug">
                                                  {subAgent.emailSignatureNote}
                                                </p>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
                    </div>
                  </div>
                );
              })}

            {/* Shared Resources strip — cross-functional agents serving multiple divisions */}
            {SHARED_RESOURCE_AGENT_IDS.length > 0 && (
              <div className="mt-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-px flex-1 bg-border/40" />
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                    Shared Intelligence Resources
                  </p>
                  <div className="h-px flex-1 bg-border/40" />
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {SHARED_RESOURCE_AGENT_IDS.map((agentId) => {
                    const agent = AGENTS.find((a) => a.id === agentId);
                    if (!agent) return null;
                    const Icon = agent.icon;
                    return (
                      <div
                        key={agent.id}
                        className={cn(
                          "flex flex-col rounded-xl border-2 border-dashed p-3",
                          agent.borderColor,
                          agent.bgColor
                        )}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Icon className={cn("h-4 w-4 shrink-0", agent.color)} />
                          <span className={cn("text-xs font-bold tracking-wide", agent.color)}>
                            {buildAgentHeadline(agent)}
                          </span>
                        </div>
                        <p className="text-[10px] font-medium mb-1">{agent.title}</p>
                        <p className="text-[9px] text-muted-foreground mb-2 leading-snug">
                          {agent.description}
                        </p>
                        {agent.feedsTo && agent.feedsTo.length > 0 && (
                          <div className="mt-auto pt-2 border-t border-border/30">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
                              Feeds intel to →
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {agent.feedsTo.map((targetId) => {
                                const target = AGENTS.find((a) => a.id === targetId);
                                if (!target) return null;
                                return (
                                  <span
                                    key={targetId}
                                    className={cn(
                                      "rounded border border-dashed px-1.5 py-0.5 text-[9px] font-semibold",
                                      target.borderColor,
                                      target.color
                                    )}
                                  >
                                    {buildAgentHeadline(target)}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Rules */}
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">No overlap.</span> Each agent owns their domain exclusively. No shared pipeline stages, no duplicate work.
              </div>
              <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">Weekly reports.</span> Every agent pushes their report to ATHENA via <code className="text-primary">push_department_report</code>. ATHENA compiles Friday.
              </div>
              <div className="rounded-lg border border-border/30 bg-muted/20 p-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground">MCP connected.</span> All agents interface through ASI Portal MCP at <code className="text-primary">asiportal.live/api/mcp</code>.
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── Agent Workspaces ─────────────────────────────────────────── */}
      {/* Individual agent operational workspaces live here. When Vesta,  */}
      {/* Blackstone, or new agents get their own workspaces, they slot   */}
      {/* into this section alongside Archer's.                           */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-px flex-1 bg-border/40" />
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
            Agent Workspaces
          </p>
          <div className="h-px flex-1 bg-border/40" />
        </div>
        <ArcherWorkspace />
        <ArcherChat />
      </div>

      {/* ATHENA Chat */}
      <Card className="bg-card/50 backdrop-blur-lg border-violet-500/20 overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-violet-500/10 to-transparent border-b border-border/30">
          <div className="flex items-center gap-3">
            <div className={cn("rounded-xl p-2.5", ATHENA_DEF.bgColor, ATHENA_DEF.borderColor, "border")}>
              <Brain className={cn("h-5 w-5", ATHENA_DEF.color)} />
            </div>
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                ATHENA
                <Badge className="bg-violet-500/20 text-violet-400 border-violet-500/30 text-[10px]">Chief of Staff</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground">Executive intelligence — connected to all departments via MCP</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {/* Quick prompts */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex flex-wrap gap-2">
              {ATHENA_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={loading}
                  className="rounded-full border border-violet-500/20 bg-violet-500/5 px-3 py-1.5 text-xs text-muted-foreground hover:text-violet-400 hover:border-violet-500/40 transition disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="h-[400px] overflow-y-auto px-5 py-3 space-y-3">
            {messages.map((msg) => (
              <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm",
                  msg.role === "user"
                    ? "bg-violet-600 text-white"
                    : "bg-muted/60 text-foreground border border-border/30"
                )}>
                  {msg.role === "assistant" && (
                    <div className="flex items-center gap-1.5 mb-1">
                      <Brain className="h-3 w-3 text-violet-400" />
                      <span className="text-[10px] font-semibold text-violet-400">ATHENA</span>
                    </div>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-muted/60 border border-border/30 rounded-2xl px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <Brain className="h-3 w-3 text-violet-400 animate-pulse" />
                    <span className="text-xs text-muted-foreground">ATHENA is thinking...</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-border/30 p-4">
            <form
              onSubmit={(e) => { e.preventDefault(); sendMessage(input); }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask ATHENA anything..."
                disabled={loading}
                className="flex-1 rounded-xl border border-border/40 bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40 disabled:opacity-50"
              />
              <Button
                type="submit"
                disabled={loading || !input.trim()}
                className="bg-violet-600 hover:bg-violet-700 text-white rounded-xl px-4"
              >
                <SendHorizonal className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
