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
import { useSearchParams } from "next/navigation";
import { collection, onSnapshot } from "firebase/firestore";
import {
  ArrowDown,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileText,
  FolderTree,
  Layers,
  Loader2,
  SendHorizonal,
  ShieldAlert,
  ShieldCheck,
  Eye,
  FlaskConical,
  X,
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
import {
  RND_FOLDERS,
  RND_FOLDER_LABELS,
  getAustralianFinancialYear,
  compareFinancialYearsDesc,
  type RndFolder,
} from "@/lib/rnd/filing";

// ─── Chat types ───────────────────────────────────────────────────────────────

import type { ProposedAction } from "@/lib/assistant/internal-knowledge-schema";

type ProposedActionState =
  | { status: "pending" }
  | { status: "confirming" }
  | { status: "confirmed"; result?: unknown }
  | { status: "dismissed" }
  | { status: "error"; message: string };

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
  proposedActions?: Array<{ action: ProposedAction; state: ProposedActionState }>;
};

const ACTION_LABELS: Record<ProposedAction["kind"], { verb: string; subject: (a: ProposedAction) => string }> = {
  create_ims_document_draft: {
    verb: "Create draft",
    subject: (a) =>
      a.kind === "create_ims_document_draft"
        ? `${a.payload.type.replace("_", " ")} — ${a.payload.title}`
        : "",
  },
  update_ims_document: {
    verb: "Update document",
    subject: (a) => (a.kind === "update_ims_document" ? a.payload.id : ""),
  },
  submit_ims_document_for_review: {
    verb: "Submit for review",
    subject: (a) => (a.kind === "submit_ims_document_for_review" ? a.payload.id : ""),
  },
  approve_ims_document: {
    verb: "Approve (Director only)",
    subject: (a) => (a.kind === "approve_ims_document" ? a.payload.id : ""),
  },
  activate_ims_document: {
    verb: "Activate (Director only)",
    subject: (a) => (a.kind === "activate_ims_document" ? a.payload.id : ""),
  },
  obsolete_ims_document: {
    verb: "Obsolete (Director only)",
    subject: (a) => (a.kind === "obsolete_ims_document" ? a.payload.id : ""),
  },
};

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

  // R&D — projects + nominations for the R&D Projects tree
  const [rndProjects, setRndProjects] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  const [rndNominations, setRndNominations] = useState<Array<Record<string, unknown> & { id: string }>>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.RND_PROJECTS),
      (snap) => {
        setRndProjects(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      () => setRndProjects([])
    );
    return () => unsub();
  }, []);
  useEffect(() => {
    const unsub = onSnapshot(
      collection(db, COLLECTIONS.RND_PROJECT_NOMINATIONS),
      (snap) => {
        setRndNominations(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      () => setRndNominations([])
    );
    return () => unsub();
  }, []);

  // Deep-link target — the Archer workspace sends users here with
  // ?rndProject=<id> so the tree auto-expands on that project. We scroll
  // to the R&D Projects card and open the node on first render.
  const searchParams = useSearchParams();
  const rndProjectTarget = searchParams?.get("rndProject") || null;
  const rndNominationTarget = searchParams?.get("rndNomination") || null;
  const rndTreeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if ((rndProjectTarget || rndNominationTarget) && rndTreeRef.current) {
      rndTreeRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [rndProjectTarget, rndNominationTarget]);

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
      const data = (await res.json()) as {
        answer?: string;
        proposedActions?: ProposedAction[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || "Request failed.");
      const proposedActions = (data.proposedActions || []).map((action) => ({
        action,
        state: { status: "pending" as const },
      }));
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-assistant`,
          role: "assistant",
          content: data.answer || "Ready.",
          proposedActions: proposedActions.length > 0 ? proposedActions : undefined,
        },
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

  // Confirm a single proposed action — POSTs to the assistant-action
  // route, which re-validates the payload, role-gates Director-only
  // actions, and writes through to Firestore. Updates only the entry
  // for the given (messageId, actionIndex) so other actions in the
  // same message stay clickable.
  const confirmAction = async (messageId: string, actionIndex: number) => {
    if (!firebaseUser) return;
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.proposedActions) return m;
        const next = m.proposedActions.map((entry, i) =>
          i === actionIndex ? { ...entry, state: { status: "confirming" as const } } : entry
        );
        return { ...m, proposedActions: next };
      })
    );
    try {
      const token = await firebaseUser.getIdToken();
      const target = messages.find((m) => m.id === messageId)?.proposedActions?.[actionIndex];
      if (!target) throw new Error("Action no longer in state.");
      const res = await fetch("/api/assistant-action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: target.action }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed.");
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.proposedActions) return m;
          const next = m.proposedActions.map((entry, i) =>
            i === actionIndex
              ? { ...entry, state: { status: "confirmed" as const, result: data.result } }
              : entry
          );
          return { ...m, proposedActions: next };
        })
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Action failed.";
      setMessages((prev) =>
        prev.map((m) => {
          if (m.id !== messageId || !m.proposedActions) return m;
          const next = m.proposedActions.map((entry, i) =>
            i === actionIndex ? { ...entry, state: { status: "error" as const, message } } : entry
          );
          return { ...m, proposedActions: next };
        })
      );
    }
  };

  const dismissAction = (messageId: string, actionIndex: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId || !m.proposedActions) return m;
        const next = m.proposedActions.map((entry, i) =>
          i === actionIndex ? { ...entry, state: { status: "dismissed" as const } } : entry
        );
        return { ...m, proposedActions: next };
      })
    );
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
                <div key={msg.id} className={cn("flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
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
                  {msg.role === "assistant" && msg.proposedActions && msg.proposedActions.length > 0 && (
                    <div className="mt-2 max-w-[80%] w-full space-y-2">
                      {msg.proposedActions.map((entry, idx) => {
                        const meta = ACTION_LABELS[entry.action.kind];
                        const subject = meta.subject(entry.action);
                        return (
                          <div
                            key={`${msg.id}-action-${idx}`}
                            className={cn(
                              "rounded-xl border px-3 py-2 text-xs flex items-center gap-3",
                              entry.state.status === "confirmed"
                                ? "border-green-500/40 bg-green-500/10"
                                : entry.state.status === "error"
                                  ? "border-red-500/40 bg-red-500/10"
                                  : entry.state.status === "dismissed"
                                    ? "border-border/30 bg-background/40 opacity-50"
                                    : "border-orange-500/30 bg-orange-500/5"
                            )}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-foreground">{meta.verb}</div>
                              {subject && (
                                <div className="text-muted-foreground truncate">{subject}</div>
                              )}
                              {entry.state.status === "confirmed" && (
                                <div className="text-green-400 mt-1 flex items-center gap-1">
                                  <CheckCircle2 className="h-3 w-3" /> Action committed.
                                </div>
                              )}
                              {entry.state.status === "error" && (
                                <div className="text-red-400 mt-1">{entry.state.message}</div>
                              )}
                            </div>
                            {entry.state.status === "pending" && (
                              <div className="flex items-center gap-1.5 shrink-0">
                                <Button
                                  size="sm"
                                  className="h-7 px-3 bg-orange-600 hover:bg-orange-700 text-white text-xs"
                                  onClick={() => confirmAction(msg.id, idx)}
                                >
                                  Confirm
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => dismissAction(msg.id, idx)}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                            {entry.state.status === "confirming" && (
                              <Loader2 className="h-4 w-4 animate-spin text-orange-400 shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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

      {/* R&D Projects filing tree — every R&D project's IMS-controlled docs
          live here, grouped by Australian FY. This is the filing side; the
          Archer workspace handles the register view + pre-feas workflow. */}
      <div ref={rndTreeRef}>
        <RndProjectsTree
          projects={rndProjects}
          nominations={rndNominations}
          imsDocs={imsDocs}
          expandProjectId={rndProjectTarget}
          expandNominationId={rndNominationTarget}
        />
      </div>

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

// ─── R&D Projects Tree ────────────────────────────────────────────────────

interface RndDocBag {
  project: Record<string, unknown> & { id: string };
  fy: string;
  docsByFolder: Partial<Record<RndFolder, NormalisedDoc[]>>;
}

function RndProjectsTree({
  projects,
  nominations,
  imsDocs,
  expandProjectId,
  expandNominationId,
}: {
  projects: Array<Record<string, unknown> & { id: string }>;
  nominations: Array<Record<string, unknown> & { id: string }>;
  imsDocs: NormalisedDoc[];
  expandProjectId: string | null;
  expandNominationId: string | null;
}) {
  // Index R&D-tagged IMS documents by projectId + folder.
  const docsByProject = useMemo(() => {
    const map = new Map<string, Partial<Record<RndFolder, NormalisedDoc[]>>>();
    for (const doc of imsDocs) {
      const raw = doc.raw as Record<string, unknown>;
      const projectId = typeof raw.rndProjectId === "string" ? raw.rndProjectId : null;
      if (!projectId) continue;
      const folder = (typeof raw.rndFolder === "string" ? raw.rndFolder : "project_filing") as RndFolder;
      if (!RND_FOLDERS.includes(folder)) continue;
      const bucket = map.get(projectId) || {};
      const list = bucket[folder] || [];
      list.push(doc);
      bucket[folder] = list;
      map.set(projectId, bucket);
    }
    return map;
  }, [imsDocs]);

  const docsByNomination = useMemo(() => {
    const map = new Map<string, Partial<Record<RndFolder, NormalisedDoc[]>>>();
    for (const doc of imsDocs) {
      const raw = doc.raw as Record<string, unknown>;
      const nomId = typeof raw.rndNominationId === "string" ? raw.rndNominationId : null;
      if (!nomId) continue;
      const folder = (typeof raw.rndFolder === "string" ? raw.rndFolder : "project_filing") as RndFolder;
      if (!RND_FOLDERS.includes(folder)) continue;
      const bucket = map.get(nomId) || {};
      const list = bucket[folder] || [];
      list.push(doc);
      bucket[folder] = list;
      map.set(nomId, bucket);
    }
    return map;
  }, [imsDocs]);

  // Projects grouped by FY (newest first). Each project's FY comes from
  // its createdAt; fall back to current FY if missing.
  const projectsByFY = useMemo(() => {
    const buckets = new Map<string, RndDocBag[]>();
    for (const p of projects) {
      const createdAt = (p.createdAt as { toDate?: () => Date } | string | null | undefined);
      const date =
        createdAt && typeof createdAt === "object" && typeof createdAt.toDate === "function"
          ? createdAt.toDate()
          : typeof createdAt === "string"
            ? new Date(createdAt)
            : new Date();
      const fy =
        typeof p.rndFinancialYear === "string"
          ? p.rndFinancialYear
          : getAustralianFinancialYear(date);
      const bag: RndDocBag = {
        project: p,
        fy,
        docsByFolder: docsByProject.get(p.id) || {},
      };
      const list = buckets.get(fy) || [];
      list.push(bag);
      buckets.set(fy, list);
    }
    const fys = Array.from(buckets.keys()).sort(compareFinancialYearsDesc);
    return fys.map((fy) => ({
      fy,
      bags: (buckets.get(fy) || []).sort((a, b) =>
        String(a.project.projectNumber || a.project.id).localeCompare(
          String(b.project.projectNumber || b.project.id)
        )
      ),
    }));
  }, [projects, docsByProject]);

  const activeNominations = useMemo(
    () =>
      nominations
        .filter((n) => {
          const status = String(n.status || "");
          return ["submitted", "in_prefeas", "prefeas_complete"].includes(status);
        })
        .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""))),
    [nominations]
  );

  const totalProjects = projects.length;
  const totalDocs = imsDocs.filter((d) => {
    const raw = d.raw as Record<string, unknown>;
    return typeof raw.rndProjectId === "string" || typeof raw.rndNominationId === "string";
  }).length;

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-fuchsia-500/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FolderTree className="h-5 w-5 text-fuchsia-400" />
          R&amp;D Projects
          <Badge variant="outline" className="text-[10px] ml-2">
            {totalProjects} project{totalProjects === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {totalDocs} IMS doc{totalDocs === 1 ? "" : "s"}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-muted-foreground">
          Every R&amp;D project document lives in the IMS — tagged with its project, folder, and
          financial year. Tree below is grouped by Australian FY (1 Jul – 30 Jun). Pre-feas
          working docs sit under the nomination they belong to until approval converts the
          nomination to a project.
        </p>

        {activeNominations.length > 0 && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs font-semibold text-amber-400 mb-2 flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5" />
              Pre-feas in progress ({activeNominations.length})
            </p>
            <div className="space-y-2">
              {activeNominations.map((n) => (
                <NominationNode
                  key={n.id}
                  nomination={n}
                  docsByFolder={docsByNomination.get(n.id) || {}}
                  defaultOpen={expandNominationId === n.id}
                />
              ))}
            </div>
          </div>
        )}

        {projectsByFY.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No R&amp;D projects filed yet. Approve a nomination in the Archer workspace to
            create the first project and its filing folders.
          </p>
        ) : (
          <div className="space-y-2">
            {projectsByFY.map(({ fy, bags }) => (
              <FyNode
                key={fy}
                fy={fy}
                bags={bags}
                defaultOpen={
                  projectsByFY[0].fy === fy ||
                  bags.some((b) => b.project.id === expandProjectId)
                }
                expandProjectId={expandProjectId}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FyNode({
  fy,
  bags,
  defaultOpen,
  expandProjectId,
}: {
  fy: string;
  bags: RndDocBag[];
  defaultOpen?: boolean;
  expandProjectId: string | null;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <div className="rounded-lg border border-border/40 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-card/40 transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <span className="text-fuchsia-400">{fy}</span>
          <span className="text-muted-foreground font-normal text-xs">
            ({bags.length} project{bags.length === 1 ? "" : "s"})
          </span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border/40 px-3 py-2 space-y-1.5">
          {bags.map((bag) => (
            <ProjectNode
              key={bag.project.id}
              bag={bag}
              defaultOpen={bag.project.id === expandProjectId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ProjectNode({ bag, defaultOpen }: { bag: RndDocBag; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const p = bag.project;
  const title = String(p.title || "Untitled project");
  const number = String(p.projectNumber || p.id.slice(0, 8));
  const phase = String(p.phase || "scoping");
  const status = String(p.status || "active");
  const docCount = Object.values(bag.docsByFolder).reduce((s, arr) => s + (arr?.length || 0), 0);

  return (
    <div className="rounded border border-border/30 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-primary/5 transition-colors"
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FolderTree className="h-3.5 w-3.5 text-fuchsia-400 shrink-0" />
          <span className="text-xs text-muted-foreground font-mono shrink-0">{number}</span>
          <span className="text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[9px] capitalize">
            {phase.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="text-[9px] capitalize">
            {status.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="text-[9px]">
            {docCount} doc{docCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </button>
      {open && (
        <div className="border-t border-border/30 px-3 py-2 space-y-1">
          {RND_FOLDERS.map((folder) => (
            <FolderNode
              key={folder}
              folder={folder}
              docs={bag.docsByFolder[folder] || []}
              rndProjectId={bag.project.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NominationNode({
  nomination,
  docsByFolder,
  defaultOpen,
}: {
  nomination: Record<string, unknown> & { id: string };
  docsByFolder: Partial<Record<RndFolder, NormalisedDoc[]>>;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const title = String(nomination.title || "Untitled nomination");
  const status = String(nomination.status || "submitted");
  const docCount = Object.values(docsByFolder).reduce((s, arr) => s + (arr?.length || 0), 0);

  return (
    <div className="rounded border border-amber-500/20 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-amber-500/10 transition-colors"
      >
        <div className="min-w-0 flex-1 flex items-center gap-2">
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          <FlaskConical className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <span className="text-sm truncate">{title}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Badge variant="outline" className="text-[9px] capitalize">
            {status.replace(/_/g, " ")}
          </Badge>
          <Badge variant="outline" className="text-[9px]">
            {docCount} doc{docCount === 1 ? "" : "s"}
          </Badge>
        </div>
      </button>
      {open && (
        <div className="border-t border-amber-500/20 px-3 py-2 space-y-1">
          {RND_FOLDERS.map((folder) => (
            <FolderNode
              key={folder}
              folder={folder}
              docs={docsByFolder[folder] || []}
              rndNominationId={nomination.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FolderNode({
  folder,
  docs,
  rndProjectId,
  rndNominationId,
}: {
  folder: RndFolder;
  docs: NormalisedDoc[];
  rndProjectId?: string;
  rndNominationId?: string;
}) {
  const [open, setOpen] = useState(docs.length > 0);
  const tagParam = rndProjectId
    ? `?rndProjectId=${rndProjectId}&rndFolder=${folder}`
    : rndNominationId
      ? `?rndNominationId=${rndNominationId}&rndFolder=${folder}`
      : "";
  return (
    <div className="rounded border border-border/20 bg-background/40">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-primary/5 transition-colors"
      >
        <span className="flex items-center gap-2">
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          <FileText className="h-3 w-3 text-muted-foreground" />
          <span>{RND_FOLDER_LABELS[folder]}</span>
          <span className="text-muted-foreground">({docs.length})</span>
        </span>
        <Link
          href={`/dashboard/ims/doc-manager${tagParam}`}
          className="text-[10px] text-primary hover:underline opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          + Add doc
        </Link>
      </button>
      {open && (
        <div className="border-t border-border/20 px-5 py-1 space-y-0.5">
          {docs.length === 0 ? (
            <p className="text-[10px] italic text-muted-foreground py-1">
              Empty —{" "}
              <Link
                href={`/dashboard/ims/doc-manager${tagParam}`}
                className="text-primary hover:underline"
              >
                create the first doc
              </Link>
            </p>
          ) : (
            docs
              .sort((a, b) => a.docId.localeCompare(b.docId))
              .map((d) => <DocLine key={d.id} doc={d} />)
          )}
        </div>
      )}
    </div>
  );
}
