"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { Brain, Shield, TrendingUp, DollarSign, Globe, Monitor, Package, Target, Crown, Gavel, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

type AgentOverviewDef = {
  name: string;
  humanName?: string;
  role: string;
  division: string;
  icon: typeof Brain;
  color: string;
  borderColor: string;
  bgGlow: string;
  description: string;
  email?: string;
  emailSignatureNote?: string;
  isChief?: boolean;
  feedsTo?: string[];
};

const DIRECTOR = {
  name: "JOSHUA HYDE",
  title: "Director",
  color: "text-yellow-300",
  borderColor: "border-yellow-500/30",
  bgGlow: "from-yellow-500/10 via-yellow-500/5 to-transparent",
};

function buildOverviewHeadline(agent: AgentOverviewDef): string {
  if (!agent.humanName) return agent.name;
  const firstName = agent.humanName.split(" ")[0];
  if (!firstName) return agent.name;
  return `${firstName.toUpperCase()} ${agent.name}`;
}

const AGENTS: AgentOverviewDef[] = [
  {
    name: "ATHENA",
    humanName: "Athena Pallas",
    role: "Chief of Staff",
    division: "Executive",
    icon: Brain,
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
    bgGlow: "from-purple-500/10 via-purple-500/5 to-transparent",
    description: "Coordinates all agent activity, escalation routing, and strategic alignment",
    isChief: true,
  },
  {
    name: "LEDGER",
    humanName: "James Ledger",
    role: "CFO & Accounts Management",
    division: "Finance",
    icon: DollarSign,
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgGlow: "from-amber-500/10 via-amber-500/5 to-transparent",
    description: "Xero invoicing, purchase orders, stock reordering, goods received, cash flow forecasting, weekly CFO report",
    email: "accountmanager@asi-australia.com.au",
  },
  {
    name: "ARCHER",
    humanName: "Sophie Archer",
    role: "R&D & Grants Manager",
    division: "Finance",
    icon: Target,
    color: "text-fuchsia-400",
    borderColor: "border-fuchsia-500/30",
    bgGlow: "from-fuchsia-500/10 via-fuchsia-500/5 to-transparent",
    description: "R&D programme coordination, grant identification & applications, innovation funding pipeline. Reports via James Ledger.",
    email: "development@asi-australia.com.au",
    emailSignatureNote: "R&D preset signature",
  },
  {
    name: "VANGUARD",
    humanName: "Peter Vanguard",
    role: "Innovation, Technology & Supply Chain Manager",
    division: "Growth & Intelligence",
    icon: TrendingUp,
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgGlow: "from-blue-500/10 via-blue-500/5 to-transparent",
    description: "OSINT scanning, market intelligence, innovation scouting, supply chain risk monitoring",
    email: "development@asi-australia.com.au",
    emailSignatureNote: "Supplier preset signature",
  },
  {
    name: "SENTINEL",
    humanName: "David Sentinel",
    role: "Business Development & Sales Manager",
    division: "Growth & Intelligence",
    icon: TrendingUp,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgGlow: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    description: "Lead management, pipeline tracking, outreach automation, BANT scoring",
    email: "development@asi-australia.com.au",
    emailSignatureNote: "Sales preset signature",
    feedsTo: ["SHIELD"],
  },
  {
    name: "SHIELD",
    humanName: "Angela Shield",
    role: "APEAX Distribution",
    division: "Distribution",
    icon: Package,
    color: "text-violet-400",
    borderColor: "border-violet-500/30",
    bgGlow: "from-violet-500/10 via-violet-500/5 to-transparent",
    description: "APEAX trade installer vetting, orders, PO to APEAX USA, warranty registration, invoicing",
  },
  {
    name: "GUARDIAN",
    humanName: "Hanzel Guardian",
    role: "IMS Manager",
    division: "Legal & Compliance",
    icon: Shield,
    color: "text-orange-400",
    borderColor: "border-orange-500/30",
    bgGlow: "from-orange-500/10 via-orange-500/5 to-transparent",
    description: "ISO 9001/14001/45001, incidents, corrective actions, risk register, audits",
  },
  {
    name: "BLACKSTONE",
    humanName: "William Blackstone",
    role: "Legal Management",
    division: "Legal & Compliance",
    icon: Gavel,
    color: "text-amber-300",
    borderColor: "border-amber-300/30",
    bgGlow: "from-amber-300/10 via-amber-300/5 to-transparent",
    description: "Internal legal review, contract analysis, compliance interpretation, risk flagging. Internal only — ATHENA sends on behalf.",
    emailSignatureNote: "Internal only — ATHENA sends on behalf",
  },
  {
    name: "CIPHER",
    role: "IT / Web",
    division: "Digital Infrastructure",
    icon: Monitor,
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    bgGlow: "from-cyan-500/10 via-cyan-500/5 to-transparent",
    description: "Portal development, integrations, API management, system health",
  },
  {
    name: "VESTA",
    humanName: "Vesta Hearth",
    role: "Human & AI Resources Manager",
    division: "Human & AI Resources",
    icon: Users,
    color: "text-pink-400",
    borderColor: "border-pink-500/30",
    bgGlow: "from-pink-500/10 via-pink-500/5 to-transparent",
    description: "Human staff onboarding, inductions, training, requals. AI agent onboarding and protocol training.",
    email: "resources@asi-australia.com.au",
    emailSignatureNote: "Resources preset signature",
  },
  {
    name: "MERIDIAN",
    role: "Critical Intelligence",
    division: "Shared Resources",
    icon: Globe,
    color: "text-rose-400",
    borderColor: "border-rose-500/30",
    bgGlow: "from-rose-500/10 via-rose-500/5 to-transparent",
    description: "Geopolitical and institutional analysis. Feeds intel to SENTINEL and VANGUARD on demand.",
    feedsTo: ["SENTINEL", "VANGUARD"],
  },
];

// Division display order for the compact overview widget
const DIVISION_ORDER = [
  "Finance",
  "Growth & Intelligence",
  "Distribution",
  "Legal & Compliance",
  "Digital Infrastructure",
  "Human & AI Resources",
  "Shared Resources",
];

type Heartbeat = {
  agentId: string;
  status: "online" | "busy" | "idle" | "error" | "unknown";
  activity?: string | null;
  lastActiveAt?: string;
};

const STALE_MINUTES = 15;

function formatLastActive(iso?: string): string {
  if (!iso) return "never";
  try {
    const diffMs = Date.now() - new Date(iso).getTime();
    if (diffMs < 60_000) return "just now";
    const mins = Math.floor(diffMs / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  } catch {
    return "unknown";
  }
}

function StatusDot({ status }: { status: Heartbeat["status"] }) {
  const colorMap: Record<Heartbeat["status"], string> = {
    online: "bg-emerald-400",
    busy: "bg-amber-400",
    idle: "bg-sky-400",
    error: "bg-red-400",
    unknown: "bg-zinc-500",
  };
  const isActive = status === "online" || status === "busy";
  return (
    <span className="relative flex h-2.5 w-2.5">
      {isActive && (
        <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${colorMap[status]} opacity-75`} />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${colorMap[status]}`} />
    </span>
  );
}

export function AgentOverview() {
  const [heartbeats, setHeartbeats] = useState<Record<string, Heartbeat>>({});

  // Live subscribe to agent heartbeats from Firestore
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.AGENT_HEARTBEATS),
      (snap) => {
        const map: Record<string, Heartbeat> = {};
        snap.docs.forEach((d) => {
          const data = d.data() as Partial<Heartbeat>;
          const lastActiveAt = String(data.lastActiveAt || "");
          let status: Heartbeat["status"] = (data.status as Heartbeat["status"]) || "unknown";
          // Mark stale heartbeats as unknown (offline visual)
          if (lastActiveAt) {
            try {
              const diffMs = Date.now() - new Date(lastActiveAt).getTime();
              if (diffMs > STALE_MINUTES * 60_000) status = "unknown";
            } catch {
              // keep status as-is
            }
          }
          map[d.id.toUpperCase()] = {
            agentId: d.id,
            status,
            activity: data.activity || null,
            lastActiveAt,
          };
        });
        // CIPHER is always online — it's the portal itself
        map["CIPHER"] = {
          agentId: "cipher",
          status: "online",
          activity: "Portal online",
          lastActiveAt: new Date().toISOString(),
        };
        setHeartbeats(map);
      },
      () => {
        // On error, mark all as unknown
        const map: Record<string, Heartbeat> = {};
        for (const a of AGENTS) map[a.name] = { agentId: a.name.toLowerCase(), status: "unknown" };
        map["CIPHER"] = { agentId: "cipher", status: "online", lastActiveAt: new Date().toISOString() };
        setHeartbeats(map);
      }
    );
    return () => unsub();
  }, []);

  const getHeartbeat = (name: string): Heartbeat =>
    heartbeats[name] || { agentId: name.toLowerCase(), status: "unknown" };

  const chief = AGENTS.find((a) => a.isChief)!;
  const nonChief = AGENTS.filter((a) => !a.isChief);

  // Group agents by division, preserving DIVISION_ORDER
  const agentsByDivision = new Map<string, AgentOverviewDef[]>();
  for (const divisionName of DIVISION_ORDER) {
    agentsByDivision.set(divisionName, []);
  }
  for (const agent of nonChief) {
    if (!agentsByDivision.has(agent.division)) {
      agentsByDivision.set(agent.division, []);
    }
    agentsByDivision.get(agent.division)!.push(agent);
  }

  const chiefHeadline = buildOverviewHeadline(chief);

  return (
    <div className="space-y-4">
      {/* DIRECTOR — human leadership, above ATHENA */}
      <Card className={`bg-card/40 backdrop-blur-lg ${DIRECTOR.borderColor} border overflow-hidden`}>
        <div className={`px-4 py-2 bg-gradient-to-r ${DIRECTOR.bgGlow} border-b ${DIRECTOR.borderColor}`}>
          <div className="flex items-center justify-center gap-2">
            <Crown className={`h-4 w-4 ${DIRECTOR.color}`} />
            <span className={`font-headline font-semibold text-xs ${DIRECTOR.color}`}>
              Director
            </span>
          </div>
        </div>
        <CardContent className="py-3">
          <div className="flex flex-col items-center text-center gap-1">
            <span className={`font-headline font-bold text-lg tracking-wide ${DIRECTOR.color}`}>
              {DIRECTOR.name}
            </span>
            <p className="text-[10px] text-muted-foreground">Executive leadership · ASI Australia</p>
          </div>
        </CardContent>
      </Card>

      {/* ATHENA — Chief of Staff */}
      <Card className={`bg-card/50 backdrop-blur-lg ${chief.borderColor} border overflow-hidden`}>
        <div className={`relative px-6 py-2.5 bg-gradient-to-r ${chief.bgGlow} border-b ${chief.borderColor}`}>
          <div className="flex items-center justify-center gap-2">
            <Brain className={`h-4 w-4 ${chief.color}`} />
            <span className={`font-headline font-semibold text-sm ${chief.color}`}>
              Agent Division Overview
            </span>
          </div>
        </div>
        <CardContent className="py-5">
          <div className="flex flex-col items-center text-center gap-3">
            <div className={`rounded-xl bg-background/60 p-4 ${chief.color}`}>
              <chief.icon className="h-8 w-8" />
            </div>
            <div>
              <div className="flex items-center justify-center gap-2">
                <StatusDot status={getHeartbeat(chief.name).status} />
                <span className={`font-headline font-bold text-xl tracking-wide ${chief.color}`}>
                  {chiefHeadline}
                </span>
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                  {chief.role}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{chief.description}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {AGENTS.length - 1} divisions reporting ·
                <span className="ml-1">Last active {formatLastActive(getHeartbeat(chief.name).lastActiveAt)}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Divisions — grouped by division with section headers */}
      {Array.from(agentsByDivision.entries()).map(([divisionName, divisionAgents]) => {
        if (divisionAgents.length === 0) return null;
        const isSharedResources = divisionName === "Shared Resources";

        return (
          <div key={divisionName} className="space-y-2">
            {/* Division header strip */}
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-border/40" />
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                {divisionName}
              </p>
              <div className="h-px flex-1 bg-border/40" />
            </div>

            {/* Agent cards within this division */}
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {divisionAgents.map((agent) => {
                const headline = buildOverviewHeadline(agent);
                return (
                  <Card
                    key={agent.name}
                    className={`bg-card/50 backdrop-blur-lg ${agent.borderColor} border overflow-hidden ${
                      isSharedResources ? "border-dashed" : ""
                    }`}
                  >
                    <div className={`px-4 py-2 bg-gradient-to-r ${agent.bgGlow} border-b ${agent.borderColor}`}>
                      <div className="flex items-center gap-2">
                        <agent.icon className={`h-3.5 w-3.5 ${agent.color}`} />
                        <span className={`font-headline font-semibold text-xs ${agent.color}`}>
                          {agent.role}
                        </span>
                      </div>
                    </div>
                    <CardContent className="flex items-start gap-3 py-4">
                      <div className={`rounded-lg bg-background/60 p-2.5 ${agent.color}`}>
                        <agent.icon className="h-5 w-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <StatusDot status={getHeartbeat(agent.name).status} />
                          <span className={`font-headline font-bold tracking-wide ${agent.color}`}>
                            {headline}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                          {agent.description}
                        </p>
                        {agent.feedsTo && agent.feedsTo.length > 0 && (
                          <div className="mt-2">
                            <p className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">
                              Feeds intel →
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {agent.feedsTo.map((targetName) => {
                                const target = AGENTS.find((a) => a.name === targetName);
                                if (!target) return null;
                                return (
                                  <span
                                    key={targetName}
                                    className={`rounded border border-dashed px-1.5 py-0.5 text-[9px] font-semibold ${target.borderColor} ${target.color}`}
                                  >
                                    {buildOverviewHeadline(target)}
                                  </span>
                                );
                              })}
                            </div>
                          </div>
                        )}
                        {(agent.email || agent.emailSignatureNote) && (
                          <div className="mt-2 pt-2 border-t border-border/30">
                            {agent.email ? (
                              <p className={`text-[10px] font-medium truncate ${agent.color}`}>{agent.email}</p>
                            ) : (
                              <p className="text-[10px] font-medium text-muted-foreground italic">Internal only</p>
                            )}
                            {agent.emailSignatureNote && (
                              <p className="text-[9px] text-muted-foreground italic">{agent.emailSignatureNote}</p>
                            )}
                          </div>
                        )}
                        <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
                          <span className="capitalize">{getHeartbeat(agent.name).status}</span>
                          <span>·</span>
                          <span>Last active {formatLastActive(getHeartbeat(agent.name).lastActiveAt)}</span>
                        </div>
                        {getHeartbeat(agent.name).activity && (
                          <p className="text-[10px] text-muted-foreground mt-0.5 italic truncate">
                            {getHeartbeat(agent.name).activity}
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
