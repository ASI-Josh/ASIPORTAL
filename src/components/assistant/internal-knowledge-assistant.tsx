"use client";

import { useMemo, useState } from "react";
import { Bot, SendHorizonal, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type InternalKnowledgeAssistantProps = {
  context?: "dashboard" | "job";
  jobId?: string;
  variant?: "card" | "embedded";
  className?: string;
  compact?: boolean;
  title?: string;
  description?: string;
};

const DASHBOARD_PROMPTS = [
  "Summarise today’s workload for my role.",
  "List open inspections or approvals I should review.",
  "Give me IMS or QA reminders for today’s work.",
];

const JOB_PROMPTS = [
  "Summarise this job and any risks or missing details.",
  "Show the relevant technical procedure for this job.",
  "Check for QA/IMS compliance gaps before close-off.",
];

export function InternalKnowledgeAssistant({
  context = "dashboard",
  jobId,
  variant = "card",
  className,
  compact = false,
  title,
  description,
}: InternalKnowledgeAssistantProps) {
  const { user, firebaseUser } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hey! I’m your internal ASI knowledge assistant. Ask me about procedures, QA support, or operational guidance.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionSuggestions, setActionSuggestions] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);

  const isStaff = user?.role === "admin" || user?.role === "technician";
  const prompts = context === "job" ? JOB_PROMPTS : DASHBOARD_PROMPTS;
  const displayTitle = title || "Internal Knowledge Assistant";
  const displayDescription =
    description ||
    (user?.role === "admin"
      ? "Business, IMS, and technical guidance with live ASI data."
      : "Technical procedures, QA support, and customer-service guidance.");

  const historyPayload = useMemo(() => {
    return messages.slice(-8).map((message) => ({
      role: message.role,
      content: message.content,
    }));
  }, [messages]);

  const sendMessage = async (content: string) => {
    if (!content.trim() || !firebaseUser) return;
    setError(null);
    setWarnings([]);
    const text = content.trim();
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-user`, role: "user", content: text },
    ]);
    setInput("");
    setLoading(true);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/knowledge-assistant", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          message: text,
          history: historyPayload,
          context,
          jobId,
        }),
      });
      const payload = (await response.json()) as {
        answer?: string;
        followUps?: string[];
        warnings?: string[];
        actionSuggestions?: string[];
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error || "Assistant request failed.");
      }
      const answer = payload.answer || "I’m ready for another question.";
      setMessages((prev) => [
        ...prev,
        { id: `${Date.now()}-assistant`, role: "assistant", content: answer },
      ]);
      setActionSuggestions(payload.actionSuggestions || []);
      setWarnings(payload.warnings || []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assistant request failed.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  if (!isStaff) return null;

  const Wrapper: React.ElementType = variant === "card" ? Card : "div";
  const Header: React.ElementType = variant === "card" ? CardHeader : "div";
  const Content: React.ElementType = variant === "card" ? CardContent : "div";

  return (
    <Wrapper
      className={cn(
        variant === "card" && "bg-card/50 backdrop-blur-lg border-border/20",
        className
      )}
    >
      <Header className={cn("space-y-1", variant === "card" ? "" : "flex items-center justify-between")}>
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Bot className="h-4 w-4 text-primary" />
            {displayTitle}
          </CardTitle>
          <p className="text-xs text-muted-foreground">{displayDescription}</p>
        </div>
      </Header>
      <Content className={cn("space-y-4", compact && "space-y-3")}>
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
          <span>Quick prompts</span>
          <span className="text-[10px] tracking-[0.18em]">ASI Knowledge</span>
        </div>
        <div className={cn("flex flex-wrap gap-2", compact && "gap-1.5")}>
          {prompts.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => sendMessage(prompt)}
              className="rounded-full border border-border/40 bg-gradient-to-r from-muted/50 to-muted/20 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
            >
              {prompt}
            </button>
          ))}
        </div>

        {warnings.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            {warnings.map((warning) => (
              <div key={warning}>- {warning}</div>
            ))}
          </div>
        )}

        <div className="rounded-2xl border border-border/40 bg-background/60">
          <ScrollArea className={cn(compact ? "h-48" : "h-72", "px-4 py-3")}>
            <div className="space-y-3">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "flex",
                    message.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  <div
                    className={cn(
                      "max-w-[75%] whitespace-pre-line rounded-2xl px-4 py-2 text-sm",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    )}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3 w-3 animate-pulse" />
                  Thinking...
                </div>
              )}
            </div>
          </ScrollArea>
          <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask the assistant to help..."
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  sendMessage(input);
                }
              }}
            />
            <Button onClick={() => sendMessage(input)} disabled={loading}>
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {actionSuggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {actionSuggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => sendMessage(suggestion)}
                className="rounded-full border border-border/40 px-3 py-1 text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
              >
                {suggestion}
              </button>
            ))}
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </Content>
    </Wrapper>
  );
}
