"use client";

/**
 * IMS Filing — the IMS hub page.
 *
 * Rebuilt 2026-04-10 to kill the 27-procedure hardcoded mock data that a
 * previous GPT-driven build dropped in and claimed was real. Every doc list
 * on this page now reads live from Firestore via the canonical documentService.
 * Every register link now shows a live count. The GUARDIAN chat panel is
 * unchanged — that was real and working.
 *
 * Gone:
 *   - Hardcoded IMS_PROCEDURES array (27 fake "Draft" procedures)
 *   - Hardcoded TECHNICAL_PROCEDURES array (5 fake "Draft" techs)
 *   - Hardcoded Policies card (3 fake "Draft" badges)
 *   - Doc Manager Chat link (page deleted)
 *
 * Added:
 *   - Live policy list from imsDocuments where type === "policy"
 *   - Live IMS procedures list from imsDocuments where type === "ims_procedure"
 *   - Live technical procedures list from imsDocuments where type === "technical_procedure"
 *   - Live counts on each register card from the respective Firestore collections
 *   - Click-through from every doc to the branded viewer at /dashboard/ims/documents/[id]/view
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot } from "firebase/firestore";
import {
  ArrowDown,
  ClipboardCheck,
  FileText,
  Layers,
  SendHorizonal,
  ShieldAlert,
  ShieldCheck,
  Eye,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import {
  subscribeAllDocuments,
  type NormalisedDoc,
  type ApprovalState,
} from "@/lib/ims/documentService";
import { cn } from "@/lib/utils";

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

const STATUS_STYLE: Record<ApprovalState, string> = {
  draft: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  under_review: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  approved: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  active: "bg-green-500/20 text-green-300 border-green-500/30",
  obsolete: "bg-red-500/20 text-red-300 border-red-500/30",
};

function DocLine({ doc }: { doc: NormalisedDoc }) {
  return (
    <Link
      href={`/dashboard/ims/documents/${doc.id}/view`}
      className="flex items-center justify-between gap-2 text-sm py-1 px-1 -mx-1 rounded hover:bg-primary/10 transition-colors group"
    >
      <span className="truncate flex-1 min-w-0 text-muted-foreground group-hover:text-foreground">
        <span className="text-primary font-mono text-xs mr-2">{doc.docId}</span>
        {doc.title}
      </span>
      <Badge variant="outline" className={cn("text-[10px] border", STATUS_STYLE[doc.approvalStatus])}>
        {doc.approvalStatus.replace("_", " ")}
      </Badge>
    </Link>
  );
}

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

  // Live IMS documents
  const [imsDocs, setImsDocs] = useState<NormalisedDoc[]>([]);
  useEffect(() => {
    const unsub = subscribeAllDocuments((docs) => setImsDocs(docs));
    return () => unsub();
  }, []);

  // Live register counts — one subscription per collection so the hub shows
  // real totals without any client-side joins
  const [counts, setCounts] = useState({
    incidents: 0,
    capas: 0,
    risks: 0,
    worksRegister: 0,
    prestart: 0,
    goodsReceived: 0,
  });

  useEffect(() => {
    const collections: Array<[keyof typeof counts, string]> = [
      ["incidents", COLLECTIONS.IMS_INCIDENTS],
      ["capas", COLLECTIONS.IMS_CORRECTIVE_ACTIONS],
      ["risks", COLLECTIONS.IMS_RISK_REGISTER],
      ["worksRegister", COLLECTIONS.WORKS_REGISTER],
      ["prestart", COLLECTIONS.PRESTART_CHECKS],
      ["goodsReceived", COLLECTIONS.GOODS_RECEIVED],
    ];
    const unsubs = collections.map(([key, coll]) =>
      onSnapshot(
        collection(db, coll),
        (snap) => setCounts((prev) => ({ ...prev, [key]: snap.size })),
        () => {
          /* permission errors are expected for some roles — ignore */
        }
      )
    );
    return () => unsubs.forEach((u) => u());
  }, []);

  // Grouped live document lists
  const policies = useMemo(
    () => imsDocs.filter((d) => d.type === "policy").sort((a, b) => a.docId.localeCompare(b.docId)),
    [imsDocs]
  );
  const imsProcedures = useMemo(
    () => imsDocs.filter((d) => d.type === "ims_procedure" || d.type === "procedure").sort((a, b) => a.docId.localeCompare(b.docId)),
    [imsDocs]
  );
  const technicalProcedures = useMemo(
    () => imsDocs.filter((d) => d.type === "technical_procedure" || d.type === "work_instruction").sort((a, b) => a.docId.localeCompare(b.docId)),
    [imsDocs]
  );
  const manuals = useMemo(
    () => imsDocs.filter((d) => d.type === "manual").sort((a, b) => a.docId.localeCompare(b.docId)),
    [imsDocs]
  );

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

      {/* IMS Structure — all live data from canonical service */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4 md:p-6">
          <div className="grid gap-6">
            {/* Policies row */}
            <Card className="bg-background/60 border-border/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>Policies</span>
                  <Badge variant="outline" className="text-[10px]">
                    {policies.length} total
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                {policies.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No policies drafted yet. GUARDIAN can create them via the chat above.
                  </p>
                ) : (
                  policies.map((d) => <DocLine key={d.id} doc={d} />)
                )}
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <ArrowDown className="h-6 w-6 text-muted-foreground" />
            </div>

            {/* 4-column grid: IMS Procs / Tech Procs / Registers / Forms */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              {/* IMS Procedures */}
              <Card className="bg-background/60 border-border/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>IMS Procedures</span>
                    <Badge variant="outline" className="text-[10px]">
                      {imsProcedures.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 max-h-[400px] overflow-y-auto">
                  {imsProcedures.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      None yet. ISO 9001/14001/45001 requires 20+ controlled procedures.
                    </p>
                  ) : (
                    imsProcedures.map((d) => <DocLine key={d.id} doc={d} />)
                  )}
                </CardContent>
              </Card>

              {/* Technical Procedures */}
              <Card className="bg-background/60 border-border/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center justify-between">
                    <span>Technical Procedures</span>
                    <Badge variant="outline" className="text-[10px]">
                      {technicalProcedures.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 max-h-[400px] overflow-y-auto">
                  {technicalProcedures.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      None yet.
                    </p>
                  ) : (
                    technicalProcedures.map((d) => <DocLine key={d.id} doc={d} />)
                  )}
                  <Link
                    href="/dashboard/ims/library"
                    className="flex items-center gap-2 text-xs text-primary hover:underline pt-2 mt-2 border-t border-border/30"
                  >
                    <FileText className="h-3 w-3" />
                    Active procedures library
                  </Link>
                </CardContent>
              </Card>

              {/* Registers with live counts */}
              <Card className="bg-background/60 border-border/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Registers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <Link href="/dashboard/ims/documents" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Document Register
                    </span>
                    <Badge variant="outline" className="text-[10px]">{imsDocs.length}</Badge>
                  </Link>
                  <Link href="/dashboard/works-register" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Works Register
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.worksRegister}</Badge>
                  </Link>
                  <Link href="/dashboard/ims/prestart-register" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                      Prestart Register
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.prestart}</Badge>
                  </Link>
                  <Link href="/dashboard/ims/corrective-actions" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Corrective Actions
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.capas}</Badge>
                  </Link>
                  <Link href="/dashboard/ims/incidents" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 text-primary" />
                      Incidents
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.incidents}</Badge>
                  </Link>
                  <Link href="/dashboard/ims/risk-register" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <ShieldAlert className="h-3.5 w-3.5 text-primary" />
                      Risk & Opportunities
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.risks}</Badge>
                  </Link>
                  <Link href="/dashboard/goods-received" className="flex items-center justify-between hover:text-primary py-1">
                    <span className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-primary" />
                      Goods Received
                    </span>
                    <Badge variant="outline" className="text-[10px]">{counts.goodsReceived}</Badge>
                  </Link>
                </CardContent>
              </Card>

              {/* Forms & Tools */}
              <Card className="bg-background/60 border-border/40">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Forms & Tools</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Link href="/dashboard/daily-prestart" className="flex items-center gap-2 hover:text-primary py-1">
                    <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                    Daily Prestart Checklist
                  </Link>
                  <Link href="/dashboard/ims/library" className="flex items-center gap-2 hover:text-primary py-1">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    IMS Library (Technician view)
                  </Link>
                  <Link href="/dashboard/ims/documents" className="flex items-center gap-2 hover:text-primary py-1">
                    <Eye className="h-3.5 w-3.5 text-primary" />
                    Document Register
                  </Link>
                  <Link href="/dashboard/ims/doc-manager" className="flex items-center gap-2 hover:text-primary py-1">
                    <FileText className="h-3.5 w-3.5 text-primary" />
                    Doc Manager (admin)
                  </Link>
                  <Link href="/dashboard/ims/ims-auditor" className="flex items-center gap-2 hover:text-primary py-1">
                    <ClipboardCheck className="h-3.5 w-3.5 text-primary" />
                    IMS Auditor
                  </Link>
                  {manuals.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-border/30">
                      <p className="text-xs text-muted-foreground mb-1">IMS Manual(s)</p>
                      {manuals.map((d) => <DocLine key={d.id} doc={d} />)}
                    </div>
                  )}
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
            Every document, register, and form on this page is live from Firestore.
            Click any document to open the branded viewer. Every status badge reflects
            the real current state — no mock data.
          </p>
          <p>
            GUARDIAN manages document control, internal audits, corrective actions, and the risk register
            across ISO 9001 (Quality), ISO 14001 (Environmental), and ISO 45001 (WHS). Use the chat above
            to schedule audits, draft procedures, investigate incidents, and close out CAPAs.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
