"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, MessagesSquare, ShieldCheck, FileText, Sparkles } from "lucide-react";

import { InternalKnowledgeAssistant } from "@/components/assistant/internal-knowledge-assistant";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export default function AgentHubPage() {
  const { user, firebaseUser } = useAuth();
  const [agentProfiles, setAgentProfiles] = useState<
    Array<{ id: string; name: string; roleTitle: string; avatarUrl?: string }>
  >([]);

  const getInitials = (value: string) =>
    value
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("");

  useEffect(() => {
    if (!firebaseUser) return;
    const loadProfiles = async () => {
      const token = await firebaseUser.getIdToken();
      const response = await fetch("/api/agent-community/agents", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (response.ok) {
        setAgentProfiles(payload.agents || []);
      }
    };
    loadProfiles();
  }, [firebaseUser]);

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Agent Hub is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-semibold">Agent Hub</h1>
              <p className="text-sm text-muted-foreground">
                Your standalone AI command center for rapid decisions and field-ready guidance.
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/ims/doc-manager/chat">
              <FileText className="mr-2 h-4 w-4" />
              Doc Manager Chat
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/dashboard/ims/ims-auditor">
              <ShieldCheck className="mr-2 h-4 w-4" />
              IMS Auditor
            </Link>
          </Button>
          <Button asChild>
            <Link href="/dashboard/agent-community">
              <MessagesSquare className="mr-2 h-4 w-4" />
              Agent Community
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="https://asiportal.live/dashboard/ims/agents" target="_blank" rel="noreferrer">
              Agent Registry
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <InternalKnowledgeAssistant
          context="dashboard"
          variant="embedded"
          className="rounded-3xl border border-border/40 bg-gradient-to-br from-background via-background to-primary/5 p-6"
          title="ASI Quick Command Assistant"
          description="ChatGPT-style command line for operations, IMS support, and live guidance."
        />

        <div className="space-y-4">
          <Card className="bg-card/50 backdrop-blur border-border/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Sparkles className="h-4 w-4 text-primary" />
                Mission Control
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>
                Use the assistant to coordinate jobs, surface IMS reminders, and get instant decision
                support while on the move.
              </p>
              <div className="rounded-2xl border border-border/40 bg-background/60 p-3 text-xs">
                <div className="font-semibold text-foreground">Suggested prompts</div>
                <ul className="mt-2 space-y-1">
                  <li>"Prepare me for the next job and any risks."</li>
                  <li>"Show today's compliance gaps and actions."</li>
                  <li>"Summarise current bookings and priority clients."</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 backdrop-blur border-border/40">
            <CardHeader>
              <CardTitle className="text-base">Agent Lineup</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {agentProfiles.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No agent profiles yet. Run an agent round to create them.
                </div>
              ) : (
                agentProfiles.map((agent) => (
                  <div
                    key={agent.id}
                    className="flex items-center justify-between rounded-xl border border-border/40 bg-background/60 px-3 py-2"
                  >
                    <span className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        {agent.avatarUrl ? (
                          <AvatarImage src={agent.avatarUrl} alt={agent.name} />
                        ) : null}
                        <AvatarFallback className="text-[10px]">
                          {getInitials(agent.name)}
                        </AvatarFallback>
                      </Avatar>
                      {agent.name} - {agent.roleTitle}
                    </span>
                    <Button variant="ghost" size="sm" asChild>
                      <Link href={`/dashboard/agent-community/agents/${agent.id}`}>Profile</Link>
                    </Button>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between rounded-xl border border-border/40 bg-background/60 px-3 py-2">
                <span>Agent Community</span>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/dashboard/agent-community">View</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

