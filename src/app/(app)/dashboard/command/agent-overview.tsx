"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import { Brain, Shield, TrendingUp, DollarSign, Globe, Monitor, Package, Target } from "lucide-react";
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
};

const AGENTS: AgentOverviewDef[] = [
  {
    name: "ATHENA",
    humanName: "Athena Pallas",
    role: "Chief of Staff",
    division: "Orchestration",
    icon: Brain,
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
    bgGlow: "from-purple-500/10 via-purple-500/5 to-transparent",
    description: "Coordinates all agent activity, escalation routing, and strategic alignment",
    isChief: true,
  },
  {
    name: "VANGUARD",
    humanName: "Peter Vanguard",
    role: "Innovation, Technology & Supply Chain Manager",
    division: "Innovation & Supply Chain",
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
    division: "Revenue & CRM",
    icon: TrendingUp,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgGlow: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    description: "Lead management, pipeline tracking, outreach automation, BANT scoring",
    email: "development@asi-australia.com.au",
    emailSignatureNote: "Sales preset signature",
  },
  {
    name: "ARCHER",
    humanName: "Sophie Archer",
    role: "R&D & Grants Manager",
    division: "Innovation & Funding",
    icon: Target,
    color: "text-fuchsia-400",
    borderColor: "border-fuchsia-500/30",
    bgGlow: "from-fuchsia-500/10 via-fuchsia-500/5 to-transparent",
    description: "R&D programme coordination, grant identification & applications, innovation funding pipeline, compliance reporting",
    email: "development@asi-australia.com.au",
    emailSignatureNote: "R&D preset signature",
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
    name: "GUARDIAN",
    humanName: "Hanzel Guardian",
    role: "IMS Lead Auditor",
    division: "Quality, Safety & Compliance",
    icon: Shield,
    color: "text-red-400",
    borderColor: "border-red-500/30",
    bgGlow: "from-red-500/10 via-red-500/5 to-transparent",
    description: "ISO 9001/14001/45001, incidents, corrective actions, risk register, audits",
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
    name: "MERIDIAN",
    role: "Geo-Intel",
    division: "Geographic Intelligence",
    icon: Globe,
    color: "text-orange-400",
    borderColor: "border-orange-500/30",
    bgGlow: "from-orange-500/10 via-orange-500/5 to-transparent",
    description: "Location analytics, route optimisation, regional coverage mapping",
  },
  {
    name: "SHIELD",
    humanName: "Angela Shield",
    role: "APEAX Distribution",
    division: "Trade Channel Operations",
    icon: Package,
    color: "text-violet-400",
    borderColor: "border-violet-500/30",
    bgGlow: "from-violet-500/10 via-violet-500/5 to-transparent",
    description: "APEAX trade installer vetting, orders, PO to APEAX USA, warranty registration, invoicing",
  },
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
  const divisions = AGENTS.filter((a) => !a.isChief);

  return (
    <div className="space-y-4">
      {/* ATHENA - Chief of Staff — Centred */}
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
                <span className={`font-headline font-bold text-xl ${chief.color}`}>{chief.name}</span>
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                  {chief.role}
                </Badge>
              </div>
              {chief.humanName && (
                <p className="text-xs text-muted-foreground mt-1 italic">{chief.humanName}</p>
              )}
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{chief.description}</p>
              <p className="text-xs text-muted-foreground mt-2">
                {AGENTS.length - 1} divisions reporting ·
                <span className="ml-1">Last active {formatLastActive(getHeartbeat(chief.name).lastActiveAt)}</span>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Division Heads */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {divisions.map((agent) => (
          <Card
            key={agent.name}
            className={`bg-card/50 backdrop-blur-lg ${agent.borderColor} border overflow-hidden`}
          >
            <div className={`px-4 py-2 bg-gradient-to-r ${agent.bgGlow} border-b ${agent.borderColor}`}>
              <div className="flex items-center gap-2">
                <agent.icon className={`h-3.5 w-3.5 ${agent.color}`} />
                <span className={`font-headline font-semibold text-xs ${agent.color}`}>
                  {agent.division}
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
                  <span className={`font-headline font-bold ${agent.color}`}>{agent.name}</span>
                  {agent.humanName && (
                    <span className="text-[10px] text-muted-foreground italic">· {agent.humanName}</span>
                  )}
                </div>
                <Badge variant="secondary" className="text-[10px] mt-1">
                  {agent.role}
                </Badge>
                <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                  {agent.description}
                </p>
                {agent.email && (
                  <div className="mt-2 pt-2 border-t border-border/30">
                    <p className={`text-[10px] font-medium truncate ${agent.color}`}>{agent.email}</p>
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
        ))}
      </div>
    </div>
  );
}
