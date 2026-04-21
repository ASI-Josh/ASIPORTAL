"use client";

/**
 * Live chat window to Sophie Archer for R&D, grants, nominations, and
 * opportunity discussions. Mirrors the Athena chat format; adds file
 * attachments via the existing /api/agent-hub/upload endpoint so Josh
 * can drop a programme guideline PDF or a spec and Archer reads the
 * extracted summary inline.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Target, SendHorizonal, Paperclip, X, FileText, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{ fileName: string; summary?: string; downloadUrl?: string }>;
}

interface PendingAttachment {
  id: string;
  fileName: string;
  contentType: string;
  size: number;
  summary?: string;
  keyPoints?: string[];
  extractedSnippet?: string;
  downloadUrl?: string;
  warning?: string;
  uploading: boolean;
}

const ARCHER_PROMPTS = [
  "What should I nominate this week?",
  "Which pending project should I prioritise?",
  "Any grants closing in the next 30 days?",
  "Pre-feas the last nomination.",
  "What's blocked in the opportunity log?",
];

export default function ArcherChat() {
  const { user, firebaseUser } = useAuth();
  const { toast } = useToast();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const firstName = useMemo(() => {
    const raw = user?.name?.trim() || user?.email?.split("@")[0] || "there";
    return raw.split(" ")[0];
  }, [user?.name, user?.email]);

  useEffect(() => {
    if (!user) return;
    setMessages((prev) => {
      if (prev.length > 0) return prev;
      const hour = new Date().getHours();
      const greeting = hour < 12 ? "Morning" : hour < 18 ? "Afternoon" : "Evening";
      return [{
        id: "welcome",
        role: "assistant",
        content: `${greeting} ${firstName} — I'm Sophie. Drop a nomination, ask me to pre-feas something, or send me a programme doc to line up against our watchlist. What are we looking at?`,
      }];
    });
  }, [user, firstName]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);

  const historyPayload = useMemo(
    () => messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
    [messages]
  );

  const handleUpload = async (files: FileList | null) => {
    if (!files || !firebaseUser) return;
    for (const file of Array.from(files)) {
      const tempId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPending((prev) => [
        ...prev,
        {
          id: tempId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          uploading: true,
        },
      ]);
      try {
        const token = await firebaseUser.getIdToken();
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/agent-hub/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);

        // The upload endpoint writes to agentHubDocs with a summary; fetch
        // those fields so Archer sees them inline. We re-request the doc
        // to pick up the summary (already written server-side).
        const docRes = await fetch(`/api/agent-hub/docs/${data.id}`, {
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => null);
        const doc = docRes && docRes.ok ? await docRes.json() : null;

        setPending((prev) =>
          prev.map((p) =>
            p.id === tempId
              ? {
                  ...p,
                  uploading: false,
                  summary: doc?.summary || undefined,
                  keyPoints: doc?.keyPoints || undefined,
                  extractedSnippet: doc?.extractedText
                    ? String(doc.extractedText).slice(0, 800)
                    : undefined,
                  downloadUrl: doc?.downloadUrl || undefined,
                  warning: data?.warning || undefined,
                }
              : p
          )
        );
      } catch (err) {
        toast({
          title: `Upload failed: ${file.name}`,
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        setPending((prev) => prev.filter((p) => p.id !== tempId));
      }
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePending = (id: string) => {
    setPending((prev) => prev.filter((p) => p.id !== id));
  };

  const sendMessage = async (rawContent?: string) => {
    const content = (rawContent ?? input).trim();
    if (!content && pending.length === 0) return;
    if (!firebaseUser) {
      toast({ title: "Sign in first", variant: "destructive" });
      return;
    }
    if (pending.some((p) => p.uploading)) {
      toast({ title: "Hang on — attachments still uploading" });
      return;
    }

    // Build the outgoing message body. User sees just their text; Archer
    // gets an appended block with each attachment's summary + snippet so
    // she can reason about the file contents without a round-trip.
    const attachmentsForAgent = pending.map((p) => ({
      fileName: p.fileName,
      contentType: p.contentType,
      size: p.size,
      summary: p.summary,
      keyPoints: p.keyPoints,
      extractedSnippet: p.extractedSnippet,
      downloadUrl: p.downloadUrl,
    }));

    const attachmentsBlock = attachmentsForAgent.length
      ? "\n\n--- ATTACHMENTS ---\n" +
        attachmentsForAgent
          .map((a, i) => {
            const parts = [`[${i + 1}] ${a.fileName} (${a.contentType})`];
            if (a.summary) parts.push(`Summary: ${a.summary}`);
            if (a.keyPoints && a.keyPoints.length) {
              parts.push(`Key points: ${a.keyPoints.join("; ")}`);
            }
            if (a.extractedSnippet) parts.push(`Snippet: ${a.extractedSnippet}`);
            return parts.join("\n");
          })
          .join("\n---\n")
      : "";

    const messageForAgent = content + attachmentsBlock;
    const userMsg: ChatMessage = {
      id: `${Date.now()}-user`,
      role: "user",
      content: content || "(attachment only)",
      attachments: attachmentsForAgent.map((a) => ({
        fileName: a.fileName,
        summary: a.summary,
        downloadUrl: a.downloadUrl,
      })),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setPending([]);
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const res = await fetch("/api/knowledge-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: messageForAgent,
          history: historyPayload,
          context: "archer-workspace",
          agentOverride: "archer",
        }),
      });
      // Netlify returns an HTML error page on function timeout / 502,
      // which makes response.json() throw on the leading "<". Parse as
      // text first and only JSON-parse when the server replied with JSON.
      const raw = await res.text();
      let data: { answer?: string; error?: string } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        // Non-JSON body — surface a human-readable error instead of the
        // classic "Unexpected token '<'" noise.
        if (!res.ok) {
          throw new Error(
            `Server returned ${res.status} ${res.statusText || ""}`.trim() ||
              "Server error — try again."
          );
        }
        throw new Error("Server returned a non-JSON response. Try again.");
      }
      if (!res.ok) throw new Error(data.error || "Request failed.");
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-archer`,
          role: "assistant",
          content: data.answer || "Ready for your next one.",
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `${Date.now()}-error`,
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : "Request failed."}`,
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-fuchsia-500/20 overflow-hidden">
      <CardHeader className="bg-gradient-to-r from-fuchsia-500/10 to-transparent border-b border-border/30">
        <div className="flex items-center gap-3">
          <div className="rounded-xl p-2.5 bg-fuchsia-500/10 border border-fuchsia-500/30">
            <Target className="h-5 w-5 text-fuchsia-400" />
          </div>
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              SOPHIE ARCHER
              <Badge className="bg-fuchsia-500/20 text-fuchsia-400 border-fuchsia-500/30 text-[10px]">
                R&D & Grants Lead
              </Badge>
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Live context: R&D portfolio, grants pipeline, opportunity log, programme watchlist, nominations
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Quick prompts */}
        <div className="px-5 pt-4 pb-2">
          <div className="flex flex-wrap gap-2">
            {ARCHER_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                onClick={() => sendMessage(prompt)}
                disabled={loading}
                className="rounded-full border border-fuchsia-500/20 bg-fuchsia-500/5 px-3 py-1.5 text-xs text-muted-foreground hover:text-fuchsia-400 hover:border-fuchsia-500/40 transition disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="h-[400px] overflow-y-auto px-5 py-3 space-y-3">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
            >
              <div
                className={cn(
                  "max-w-[80%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm",
                  msg.role === "user"
                    ? "bg-fuchsia-600 text-white"
                    : "bg-muted/60 text-foreground border border-border/30"
                )}
              >
                {msg.role === "assistant" && (
                  <div className="flex items-center gap-1.5 mb-1">
                    <Target className="h-3 w-3 text-fuchsia-400" />
                    <span className="text-[10px] font-semibold text-fuchsia-400">SOPHIE</span>
                  </div>
                )}
                {msg.content}
                {msg.attachments && msg.attachments.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {msg.attachments.map((a) => (
                      <div
                        key={a.fileName}
                        className={cn(
                          "flex items-center gap-2 text-[11px] px-2 py-1 rounded border",
                          msg.role === "user"
                            ? "border-white/30 bg-white/10"
                            : "border-border/40 bg-card/60"
                        )}
                      >
                        <FileText className="h-3 w-3 shrink-0" />
                        {a.downloadUrl ? (
                          <a
                            href={a.downloadUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="truncate hover:underline"
                          >
                            {a.fileName}
                          </a>
                        ) : (
                          <span className="truncate">{a.fileName}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted/60 border border-border/30 rounded-2xl px-4 py-2.5 text-sm">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-3 w-3 text-fuchsia-400 animate-pulse" />
                  <span className="text-xs text-muted-foreground">SOPHIE is thinking…</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Pending attachments preview */}
        {pending.length > 0 && (
          <div className="border-t border-border/30 px-4 py-2 bg-card/30">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5">
              Attachments
            </p>
            <div className="flex flex-wrap gap-1.5">
              {pending.map((p) => (
                <div
                  key={p.id}
                  className={cn(
                    "flex items-center gap-1.5 text-[11px] px-2 py-1 rounded-full border",
                    p.uploading
                      ? "border-fuchsia-500/30 bg-fuchsia-500/5 text-muted-foreground"
                      : p.warning
                        ? "border-amber-500/40 bg-amber-500/5 text-amber-300"
                        : "border-emerald-500/30 bg-emerald-500/5 text-emerald-300"
                  )}
                >
                  {p.uploading ? (
                    <Sparkles className="h-3 w-3 animate-pulse" />
                  ) : (
                    <FileText className="h-3 w-3" />
                  )}
                  <span className="max-w-[240px] truncate">{p.fileName}</span>
                  {!p.uploading && (
                    <button
                      type="button"
                      onClick={() => removePending(p.id)}
                      className="opacity-70 hover:opacity-100"
                      aria-label="Remove attachment"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="border-t border-border/30 p-4">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
            accept=".pdf,.doc,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg"
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex gap-2"
          >
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={loading}
              onClick={() => fileInputRef.current?.click()}
              title="Attach a file"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Sophie anything about R&D, grants, or nominations…"
              disabled={loading}
              className="flex-1 rounded-xl border border-border/40 bg-background/60 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-fuchsia-500/40 disabled:opacity-50"
            />
            <Button
              type="submit"
              disabled={loading || (!input.trim() && pending.length === 0)}
              className="bg-fuchsia-600 hover:bg-fuchsia-700"
            >
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
}
