"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  Bot, Brain, Eye, Globe, Landmark, MessagesSquare,
  Scale, SendHorizonal, ShieldCheck, TrendingUp,
  Users, ChevronDown, ChevronUp, Package,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── Agent org chart data ─────────────────────────────────────────────────────

type AgentDef = {
  id: string;
  name: string;
  title: string;
  domain: string;
  icon: typeof Bot;
  color: string;       // tailwind colour class
  bgColor: string;
  borderColor: string;
  stream?: string;
  description: string;
  capabilities: string[];
  link?: string;
};

const ATHENA_DEF: AgentDef = {
  id: "athena",
  name: "ATHENA",
  title: "Chief of Staff",
  domain: "Executive Intelligence",
  icon: Brain,
  color: "text-violet-400",
  bgColor: "bg-violet-500/10",
  borderColor: "border-violet-500/30",
  description: "Cross-department synthesis, daily ops briefs, weekly company reports, strategic decisions. Jim Collins frameworks.",
  capabilities: ["Morning briefs", "Weekly company reports", "Decision briefs", "Cross-department analysis", "Strategic pattern recognition"],
};

const AGENTS: AgentDef[] = [
  {
    id: "vanguard",
    name: "VANGUARD",
    title: "Supply Chain Growth Engine",
    domain: "External Intelligence",
    icon: Eye,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/30",
    stream: "supply_chain",
    description: "External OSINT scanning, supply chain lead qualification & full lifecycle, market mode assessment.",
    capabilities: ["Daily OSINT scans (4 pillars)", "BANT-Plus scoring", "Supply chain pipeline", "Market mode assessment"],
  },
  {
    id: "sentinel",
    name: "SENTINEL",
    title: "Sales Consultant",
    domain: "Revenue",
    icon: TrendingUp,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/30",
    stream: "sales",
    description: "Sales lead qualification, client outreach, proposals, discovery, revenue conversion.",
    capabilities: ["Sales pipeline", "Lead qualification", "Outreach sequences", "Proposal support"],
  },
  {
    id: "ledger",
    name: "LEDGER",
    title: "Accounts Team",
    domain: "Finance",
    icon: Landmark,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    description: "Xero invoicing, job close-out, cost auditing, financial reporting, GST.",
    capabilities: ["Xero invoicing", "Job close-out", "Cost auditing", "Financial reports"],
    link: "/dashboard/crm",
  },
  {
    id: "guardian",
    name: "GUARDIAN",
    title: "Lead Auditor",
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
    description: "Geopolitical & institutional analysis.",
    capabilities: ["Geopolitical analysis", "Institutional intelligence", "Policy impact assessment"],
  },
  {
    id: "shield",
    name: "SHIELD",
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
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Good morning, Josh. I'm ATHENA — your Chief of Staff. I have real-time access to all departments via the portal. What do you need?",
    },
  ]);
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
            <Link href="/dashboard/agent-community"><MessagesSquare className="mr-2 h-4 w-4" />Community</Link>
          </Button>
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
            <span className="text-base font-semibold">AI Organisation Chart</span>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5">{AGENTS.length + 1} agents</Badge>
          </div>
          {orgExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </button>

        {orgExpanded && (
          <CardContent className="pt-0 pb-6">
            {/* ATHENA — top of chart */}
            <div className="flex justify-center mb-6">
              <div className={cn("w-full max-w-md rounded-xl border-2 p-4 text-center", ATHENA_DEF.borderColor, ATHENA_DEF.bgColor)}>
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Brain className={cn("h-6 w-6", ATHENA_DEF.color)} />
                  <span className={cn("text-lg font-bold", ATHENA_DEF.color)}>{ATHENA_DEF.name}</span>
                </div>
                <p className="text-sm font-medium">{ATHENA_DEF.title}</p>
                <p className="text-xs text-muted-foreground mt-1">{ATHENA_DEF.domain}</p>
              </div>
            </div>

            {/* Connector line */}
            <div className="flex justify-center mb-6">
              <div className="w-px h-8 bg-border/60" />
            </div>

            {/* Horizontal connector */}
            <div className="hidden md:block mx-auto mb-6" style={{ maxWidth: "calc(100% - 60px)" }}>
              <div className="h-px bg-border/60" />
            </div>

            {/* Agent cards grid */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
              {AGENTS.map((agent) => {
                const Icon = agent.icon;
                return (
                  <div key={agent.id} className={cn("rounded-xl border p-4 transition-all hover:scale-[1.02]", agent.borderColor, agent.bgColor)}>
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={cn("h-5 w-5", agent.color)} />
                      <span className={cn("text-sm font-bold", agent.color)}>{agent.name}</span>
                    </div>
                    <p className="text-xs font-medium mb-1">{agent.title}</p>
                    <p className="text-[10px] text-muted-foreground mb-3">{agent.domain}{agent.stream ? ` · ${agent.stream}` : ""}</p>
                    <div className="space-y-1">
                      {agent.capabilities.slice(0, 3).map((cap) => (
                        <div key={cap} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                          <div className={cn("h-1 w-1 rounded-full", agent.color.replace("text-", "bg-"))} />
                          {cap}
                        </div>
                      ))}
                    </div>
                    {agent.link && (
                      <Link href={agent.link} className={cn("block mt-3 text-[10px] font-semibold hover:underline", agent.color)}>
                        Open workspace →
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>

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
