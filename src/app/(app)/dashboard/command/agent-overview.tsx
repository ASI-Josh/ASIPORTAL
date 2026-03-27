"use client";

import { Bot, Brain, Shield, TrendingUp, DollarSign, Globe, Monitor } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const AGENTS = [
  {
    name: "ATHENA",
    role: "Chief of Staff",
    division: "Orchestration",
    icon: Brain,
    color: "text-purple-400",
    borderColor: "border-purple-500/30",
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
    description: "OSINT scanning, market intelligence, supply chain risk monitoring",
  },
  {
    name: "SENTINEL",
    role: "Sales",
    division: "Revenue & CRM",
    icon: TrendingUp,
    color: "text-emerald-400",
    borderColor: "border-emerald-500/30",
    description: "Lead management, pipeline tracking, outreach automation, BANT scoring",
  },
  {
    name: "LEDGER",
    role: "Accounts",
    division: "Finance & Procurement",
    icon: DollarSign,
    color: "text-amber-400",
    borderColor: "border-amber-500/30",
    description: "Xero invoicing, purchase orders, stock reordering, goods received",
  },
  {
    name: "GUARDIAN",
    role: "IMS",
    division: "Quality, Safety & Compliance",
    icon: Shield,
    color: "text-red-400",
    borderColor: "border-red-500/30",
    description: "ISO 9001/14001/45001, incidents, corrective actions, risk register, audits",
  },
  {
    name: "CIPHER",
    role: "IT / Web",
    division: "Digital Infrastructure",
    icon: Monitor,
    color: "text-cyan-400",
    borderColor: "border-cyan-500/30",
    description: "Portal development, integrations, API management, system health",
  },
  {
    name: "MERIDIAN",
    role: "Geo-Intel",
    division: "Geographic Intelligence",
    icon: Globe,
    color: "text-orange-400",
    borderColor: "border-orange-500/30",
    description: "Location analytics, route optimisation, regional coverage mapping",
  },
];

export function AgentOverview() {
  const chief = AGENTS.find((a) => a.isChief)!;
  const divisions = AGENTS.filter((a) => !a.isChief);

  return (
    <div className="space-y-4">
      {/* ATHENA - Chief of Staff */}
      <Card className={`bg-card/50 backdrop-blur-lg ${chief.borderColor} border`}>
        <CardContent className="flex items-center gap-4 py-4">
          <div className={`rounded-lg bg-background/60 p-3 ${chief.color}`}>
            <chief.icon className="h-6 w-6" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className={`font-headline font-bold text-lg ${chief.color}`}>{chief.name}</span>
              <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30">
                {chief.role}
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground">{chief.description}</p>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>6 divisions</div>
            <div>reporting</div>
          </div>
        </CardContent>
      </Card>

      {/* Division Heads */}
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
        {divisions.map((agent) => (
          <Card
            key={agent.name}
            className={`bg-card/50 backdrop-blur-lg ${agent.borderColor} border`}
          >
            <CardContent className="flex items-start gap-3 py-4">
              <div className={`rounded-lg bg-background/60 p-2.5 ${agent.color}`}>
                <agent.icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
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
