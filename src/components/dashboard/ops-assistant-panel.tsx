"use client";

import { useMemo, useState } from "react";
import { MessageSquare, Navigation, SendHorizonal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { cn } from "@/lib/utils";
import { getPublicEnv } from "@/lib/public-env";
import type { Job } from "@/lib/types";

type ChatMessage = {
  id: string;
  role: "assistant" | "user";
  content: string;
};

type OpsAssistantPanelProps = {
  variant?: "card" | "embedded";
  layout?: "standard" | "compact";
  className?: string;
};

const PROMPTS = [
  {
    id: "next_directions",
    label: "Next job directions",
    description: "Open map for the next scheduled job.",
  },
  {
    id: "today_schedule",
    label: "Summarise today's schedule",
    description: "List scheduled jobs for today.",
  },
  {
    id: "prep_prestart",
    label: "Prestart reminder",
    description: "Generate a quick prestart checklist reminder.",
  },
];

const buildDateTime = (job: Job) => {
  const baseDate =
    job.scheduledDate?.toDate?.() ||
    job.booking?.preferredDate?.toDate?.() ||
    null;
  if (!baseDate) return null;
  const date = new Date(baseDate);
  const time = job.booking?.preferredTime;
  if (time) {
    const [hours, minutes] = time.split(":").map((val) => Number.parseInt(val, 10));
    if (Number.isFinite(hours) && Number.isFinite(minutes)) {
      date.setHours(hours, minutes, 0, 0);
    }
  } else {
    date.setHours(23, 59, 0, 0);
  }
  return date;
};

const isSameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() &&
  a.getMonth() === b.getMonth() &&
  a.getDate() === b.getDate();

export function OpsAssistantPanel({
  variant = "card",
  layout = "standard",
  className,
}: OpsAssistantPanelProps) {
  const { user } = useAuth();
  const { jobs } = useJobs();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hi! I can help with directions, schedules, and quick admin tasks. Try a prompt below.",
    },
  ]);
  const [input, setInput] = useState("");
  const [activeMapJob, setActiveMapJob] = useState<Job | null>(null);

  const mapsApiKey = getPublicEnv("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY") || "";

  const nextJob = useMemo(() => {
    const now = new Date();
    return jobs
      .filter((job) => {
        if (job.status === "completed" || job.status === "closed" || job.status === "cancelled") {
          return false;
        }
        if (user?.uid && job.assignedTechnicianIds?.length) {
          if (!job.assignedTechnicianIds.includes(user.uid)) return false;
        }
        const dateTime = buildDateTime(job);
        return dateTime ? dateTime >= now : false;
      })
      .map((job) => ({ job, dateTime: buildDateTime(job) }))
      .filter((entry) => entry.dateTime)
      .sort((a, b) => (a.dateTime?.valueOf() || 0) - (b.dateTime?.valueOf() || 0))[0]?.job;
  }, [jobs, user?.uid]);

  const todaySchedule = useMemo(() => {
    const today = new Date();
    return jobs
      .map((job) => ({ job, dateTime: buildDateTime(job) }))
      .filter(({ dateTime }) => dateTime && isSameDay(dateTime, today))
      .sort((a, b) => (a.dateTime?.valueOf() || 0) - (b.dateTime?.valueOf() || 0))
      .map(({ job, dateTime }) => ({
        id: job.id,
        label: `${job.jobNumber} • ${job.clientName}`,
        time: dateTime?.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit" }),
      }));
  }, [jobs]);

  const mapQuery = useMemo(() => {
    if (!activeMapJob?.siteLocation?.address) return "";
    return encodeURIComponent(activeMapJob.siteLocation.address);
  }, [activeMapJob]);

  const mapEmbedUrl =
    mapsApiKey && mapQuery
      ? `https://www.google.com/maps/embed/v1/place?key=${mapsApiKey}&q=${mapQuery}`
      : "";

  const directionsUrl = mapQuery
    ? `https://www.google.com/maps/dir/?api=1&destination=${mapQuery}`
    : "";

  const pushAssistantMessage = (content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: `${Date.now()}-assistant`, role: "assistant", content },
    ]);
  };

  const handleQuickPrompt = (promptId: string) => {
    if (promptId === "next_directions") {
      if (nextJob?.siteLocation?.address) {
        setActiveMapJob(nextJob);
        pushAssistantMessage(
          `Next job is ${nextJob.jobNumber} for ${nextJob.clientName}. Map loaded below.`
        );
      } else {
        pushAssistantMessage("No upcoming job with a mapped address was found.");
      }
      return;
    }
    if (promptId === "today_schedule") {
      if (todaySchedule.length === 0) {
        pushAssistantMessage("No jobs scheduled for today.");
      } else {
        pushAssistantMessage(
          todaySchedule
            .map((item) => `${item.time || "Scheduled"} — ${item.label}`)
            .join("\n")
        );
      }
      return;
    }
    if (promptId === "prep_prestart") {
      pushAssistantMessage(
        "Prestart reminder: tools, consumables, device charging, and vehicle safety checks."
      );
      return;
    }
  };

  const handleSend = () => {
    if (!input.trim()) return;
    const value = input.trim();
    setMessages((prev) => [...prev, { id: `${Date.now()}-user`, role: "user", content: value }]);
    setInput("");
    if (/direction|navigate|next job/i.test(value)) {
      handleQuickPrompt("next_directions");
      return;
    }
    if (/today|schedule/i.test(value)) {
      handleQuickPrompt("today_schedule");
      return;
    }
    pushAssistantMessage(
      "Got it. This assistant will be connected to the Ops agent soon for full task automation."
    );
  };

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
            <MessageSquare className="h-4 w-4 text-primary" />
            Operations Assistant
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Chat-style quick actions for directions, schedules, and admin support.
          </p>
        </div>
      </Header>
      <Content className={cn("space-y-4", layout === "compact" && "space-y-3")}>
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em] text-muted-foreground/70">
          <span>Quick prompts</span>
          <span className="text-[10px] tracking-[0.18em]">Ops Assist</span>
        </div>
        <div
          className={cn(
            "flex flex-wrap gap-2",
            layout === "compact" && "gap-1.5",
            "items-center"
          )}
        >
          {PROMPTS.map((prompt) => (
            <button
              key={prompt.id}
              type="button"
              onClick={() => handleQuickPrompt(prompt.id)}
              className="rounded-full border border-border/40 bg-gradient-to-r from-muted/50 to-muted/20 px-3 py-1 text-xs text-muted-foreground hover:text-foreground hover:border-primary/40 transition"
              title={prompt.description}
            >
              {prompt.label}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-border/40 bg-background/60">
          <ScrollArea className={cn(layout === "compact" ? "h-40" : "h-64", "px-4 py-3")}>
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
            </div>
          </ScrollArea>
          <div className="flex items-center gap-2 border-t border-border/40 px-3 py-2">
            <Input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask the assistant to do something..."
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button onClick={handleSend}>
              <SendHorizonal className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {activeMapJob && mapEmbedUrl ? (
          <div className="space-y-3 rounded-2xl border border-border/40 bg-muted/20 p-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <div>
                <p className="font-medium">
                  {activeMapJob.jobNumber} • {activeMapJob.clientName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {activeMapJob.siteLocation?.address || "Address unavailable"}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (directionsUrl) window.open(directionsUrl, "_blank", "noopener,noreferrer");
                }}
                disabled={!directionsUrl}
              >
                <Navigation className="mr-2 h-4 w-4" />
                Open directions
              </Button>
            </div>
            <iframe
              title="Next job map"
              className={cn(
                "w-full rounded-xl border border-border/40",
                layout === "compact" ? "h-44" : "h-56"
              )}
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              src={mapEmbedUrl}
            />
            {!mapsApiKey ? (
              <p className="text-xs text-destructive">
                Add NEXT_PUBLIC_GOOGLE_MAPS_API_KEY to enable map preview.
              </p>
            ) : null}
          </div>
        ) : null}
      </Content>
    </Wrapper>
  );
}
