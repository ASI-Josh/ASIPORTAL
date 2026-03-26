"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import Link from "next/link";
import {
  ArrowDown, ClipboardCheck, FileText, Layers, SendHorizonal,
  ShieldAlert, ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

// ─── IMS structure data ───────────────────────────────────────────────────────

const IMS_PROCEDURES = [
  "Context & Interested Parties",
  "Scope & Process Mapping",
  "Leadership & Commitment",
  "Risk & Opportunity Management",
  "Quality Objectives & Planning",
  "Document Control",
  "Control of Records",
  "Competence, Training & Awareness",
  "Communication",
  "Operational Planning & Control",
  "Customer Requirements Review",
  "Design & Development (if applicable)",
  "Control of External Providers",
  "Production & Service Provision",
  "Identification & Traceability",
  "Property Belonging to Customers",
  "Preservation & Handling",
  "Monitoring & Measurement Resources",
  "Release of Products & Services",
  "Nonconforming Outputs",
  "Performance Evaluation & KPI Review",
  "Internal Audit",
  "Management Review",
  "Corrective Action",
  "Continual Improvement",
  "Change Management",
];

const TECHNICAL_PROCEDURES = [
  "Crack Repair",
  "Scratch Removal",
  "Trim Repair",
  "Film Installation",
  "Lens Restoration",
];

// ─── Chat types ───────────────────────────────────────────────────────────────

type ChatMessage = { id: string; role: "assistant" | "user"; content: string };

const GUARDIAN_PROMPTS = [
  "What's the current IMS status?",
  "List open corrective actions.",
  "Run an audit on document control.",
  "Draft a quality policy for ASI.",
  "What risks are open in the register?",
  "Prep me for management review.",
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ImsHubPage() {
  const { user, firebaseUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "I'm GUARDIAN — your IMS Lead Auditor (ISO 9001, 14001, 45001). I can help you build procedures, run audits, manage incidents, track CAPAs, and maintain the risk register. What would you like to work on?",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const historyPayload = useMemo(() => {
    return messages.slice(-10).map((m) => ({ role: m.role, content: m.content }));
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
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
        body: JSON.stringify({ message: text, history: historyPayload, context: "dashboard", agentOverride: "guardian" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-assistant`, role: "assistant", content: data.answer || "Ready." },
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
          <Layers className="h-8 w-8 text-sky-400" />
        </div>
        <div>
          <h1 className="text-3xl font-headline font-bold">ASI IMS</h1>
          <p className="text-muted-foreground">
            Integrated Management System — ISO 9001 / 14001 / 45001
          </p>
        </div>
      </div>

      {/* GUARDIAN Chat — admin only */}
      {user?.role === "admin" && (
        <Card className="bg-card/50 backdrop-blur-lg border-orange-500/20 overflow-hidden">
          <CardHeader className="bg-gradient-to-r from-orange-500/10 to-transparent border-b border-border/30 py-3">
            <div className="flex items-center gap-3">
              <div className="rounded-xl p-2 bg-orange-500/10 border border-orange-500/30">
                <ShieldCheck className="h-5 w-5 text-orange-400" />
              </div>
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  GUARDIAN
                  <Badge className="bg-orange-500/20 text-orange-400 border-orange-500/30 text-[10px]">Lead Auditor</Badge>
                </CardTitle>
                <p className="text-xs text-muted-foreground">IMS development, auditing, and continual improvement</p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {/* Quick prompts */}
            <div className="px-5 pt-3 pb-2 flex flex-wrap gap-2">
              {GUARDIAN_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  disabled={loading}
                  className="rounded-full border border-orange-500/20 bg-orange-500/5 px-3 py-1.5 text-xs text-muted-foreground hover:text-orange-400 hover:border-orange-500/40 transition disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="h-[300px] overflow-y-auto px-5 py-3 space-y-3">
              {messages.map((msg) => (
                <div key={msg.id} className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}>
                  <div className={cn(
                    "max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-orange-600 text-white"
                      : "bg-muted/60 text-foreground border border-border/30"
                  )}>
                    {msg.role === "assistant" && (
                      <div className="flex items-center gap-1.5 mb-1">
                        <ShieldCheck className="h-3 w-3 text-orange-400" />
                        <span className="text-[10px] font-semibold text-orange-400">GUARDIAN</span>
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
                      <ShieldCheck className="h-3 w-3 text-orange-400 animate-pulse" />
                      <span className="text-xs text-muted-foreground">GUARDIAN is analysing...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Input */}
            <div className="border-t border-border/30 p-4">
              <form onSubmit={(e) => { e.preventDefault(); sendMessage(input); }} className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask GUARDIAN about IMS, audits, procedures, incidents..."
                  disabled={loading}
                  className="flex-1 rounded-xl border border-border/40 bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/40 disabled:opacity-50"
                />
                <Button type="submit" disabled={loading || !input.trim()} className="bg-orange-600 hover:bg-orange-700 text-white rounded-xl px-4">
                  <SendHorizonal className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {/* IMS Structure */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4 md:p-6">
          <div className="grid gap-6">
            <Card className="bg-background/60 border-border/40">
              <CardHeader>
                <CardTitle className="text-base">Policies</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Quality Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Environmental Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Safety Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <ArrowDown className="h-6 w-6 text-muted-foreground" />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">IMS Procedures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {IMS_PROCEDURES.map((item) => (
                    <div key={item} className="flex items-center justify-between text-sm">
                      <span>{item}</span>
                      <Badge variant="secondary">Draft</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Technical Procedures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {TECHNICAL_PROCEDURES.map((item) => (
                    <div key={item} className="flex items-center justify-between text-sm">
                      <span>{item}</span>
                      <Badge variant="secondary">Draft</Badge>
                    </div>
                  ))}
                  <Link href="/dashboard/ims/library" className="flex items-center gap-2 text-sm text-primary hover:underline">
                    <FileText className="h-4 w-4" />
                    View active procedures
                  </Link>
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Registers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Link href="/dashboard/ims/documents" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Document Register</Link>
                  <Link href="/dashboard/works-register" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Works Register</Link>
                  <Link href="/dashboard/ims/prestart-register" className="flex items-center gap-2 hover:text-primary"><ClipboardCheck className="h-4 w-4 text-primary" />Prestart Register</Link>
                  <Link href="/dashboard/ims/corrective-actions" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Corrective Action Register</Link>
                  <Link href="/dashboard/ims/incidents" className="flex items-center gap-2 hover:text-primary"><ShieldAlert className="h-4 w-4 text-primary" />Incident Register</Link>
                  <Link href="/dashboard/ims/risk-register" className="flex items-center gap-2 hover:text-primary"><ShieldAlert className="h-4 w-4 text-primary" />Risk & Opportunities Register</Link>
                  <Link href="/dashboard/goods-received" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Goods Received Register</Link>
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Forms & Tools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Link href="/dashboard/daily-prestart" className="flex items-center gap-2 hover:text-primary"><ClipboardCheck className="h-4 w-4 text-primary" />Daily Prestart Checklist</Link>
                  <Link href="/dashboard/ims/library" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />IMS Library (Technician)</Link>
                  <Link href="/dashboard/ims/doc-manager/chat" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Doc Manager Chat</Link>
                  <Link href="/dashboard/ims/doc-manager" className="flex items-center gap-2 hover:text-primary"><FileText className="h-4 w-4 text-primary" />Doc Manager</Link>
                  <Link href="/dashboard/ims/ims-auditor" className="flex items-center gap-2 hover:text-primary"><ClipboardCheck className="h-4 w-4 text-primary" />Internal Audit Workspace</Link>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>IMS Filing Structure</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Use this hub to keep policies, procedures, registers, and forms in one controlled
            structure. Each register links to live records for traceability.
          </p>
          <p>
            GUARDIAN manages document control, internal audits, corrective actions, and risk register
            across ISO 9001 (Quality), ISO 14001 (Environmental), and ISO 45001 (WHS).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
