"use client";

import { useEffect, useState } from "react";
import { Brain, Shield, TrendingUp, DollarSign, Globe, Monitor } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const AGENTS = [
  {
    name: "ATHENA",
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
    role: "Supply Chain",
    division: "Procurement & Logistics",
    icon: TrendingUp,
    color: "text-blue-400",
    borderColor: "border-blue-500/30",
    bgGlow: "from-blue-500/10 via-blue-500/5 to-transparent",
    description: "OSINT scanning, market intelligence, supply chain risk monitoring",
  },
  {
    name: "SENTINEL",
    role: "Sales",
    division: "Revenue & CRM",
    icon: TrendingUp,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    bgGlow: "from-emerald-500/10 via-emerald-500/5 to-transparent",
    description: "Lead management, pipeline tracking, outreach automation, BANT scoring",
  },
  {
    name: "LEDGER",
    role: "Accounts",
    division: "Finance & Procurement",
    icon: DollarSign,
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    bgGlow: "from-amber-500/10 via-amber-500/5 to-transparent",
    description: "Xero invoicing, purchase orders, stock reordering, goods received",
  },
  {
    name: "GUARDIAN",
    role: "IMS",
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
];

function StatusDot({ online }: { online: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {online && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
      )}
      <span
        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
          online ? "bg-emerald-400" : "bg-zinc-500"
        }`}
      />
    </span>
  );
}

export function AgentOverview() {
  const [agentStatus, setAgentStatus] = useState<Record<string, boolean>>({});

  // Check MCP server connectivity as a proxy for agent availability
  useEffect(() => {
    const checkStatus = async () => {
      const statuses: Record<string, boolean> = {};
      // All agents route through the MCP server — if it responds, agents are reachable
      try {
        const res = await fetch("/api/mcp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", method: "tools/list", id: "status-check" }),
        });
        const online = res.ok;
        // ATHENA, LEDGER, GUARDIAN, VANGUARD, SENTINEL all use MCP
        for (const agent of AGENTS) {
          statuses[agent.name] = online;
        }
      } catch {
        for (const agent of AGENTS) {
          statuses[agent.name] = false;
        }
      }
      // CIPHER is always online if the portal is serving this page
      statuses["CIPHER"] = true;
      setAgentStatus(statuses);
    };

    checkStatus();
    const interval = setInterval(checkStatus, 60_000); // Recheck every 60s
    return () => clearInterval(interval);
  }, []);

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
                <StatusDot online={agentStatus[chief.name] ?? false} />
                <span className={`font-headline font-bold text-xl ${chief.color}`}>{chief.name}</span>
                <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                  {chief.role}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">{chief.description}</p>
              <p className="text-xs text-muted-foreground mt-2">6 divisions reporting</p>
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
                <div className="flex items-center gap-2">
                  <StatusDot online={agentStatus[agent.name] ?? false} />
                  <span className={`font-headline font-bold ${agent.color}`}>{agent.name}</span>
                  <Badge variant="secondary" className="text-xs">
                    {agent.role}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  {agent.description}
                </p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
