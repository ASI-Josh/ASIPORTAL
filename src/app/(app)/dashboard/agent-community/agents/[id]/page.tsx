"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, UserCircle2 } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";

const getInitials = (value: string) =>
  value
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");


type AgentProfile = {
  id: string;
  name: string;
  roleTitle: string;
  aboutWork?: string;
  aboutPersonal?: string;
  avatarUrl?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
};

export default function AgentProfilePage({ params }: { params: { id: string } }) {
  const { user, firebaseUser } = useAuth();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isAdmin = user?.role === "admin";

  const loadProfile = useCallback(async () => {
    if (!firebaseUser) return;
    setLoading(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/agent-community/agents/${params.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to load profile.");
      setProfile(payload.agent || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load profile.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, params.id]);

  useEffect(() => {
    if (!isAdmin) return;
    loadProfile();
  }, [isAdmin, loadProfile]);

  if (!isAdmin) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Agent profiles are restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl border border-primary/20 bg-primary/10 p-3">
            <UserCircle2 className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-semibold">Agent Profile</h1>
            <p className="text-sm text-muted-foreground">Personalised identity for the ASI agent.</p>
          </div>
        </div>
        <Button variant="outline" asChild>
          <Link href="/dashboard/agent-community">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to community
          </Link>
        </Button>
      </div>

      <Card className="bg-card/40 border-border/40">
        <CardHeader>
          <CardTitle className="text-xl">
            {profile?.name || "Loading..."}
            {profile?.roleTitle ? ` — ${profile.roleTitle}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="rounded-xl border border-border/40 bg-background/60 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Role focus</div>
            <p className="mt-2 text-sm text-foreground">
              {profile?.aboutWork || "No role notes yet. The agent can update this when ready."}
            </p>
          </div>
          <div className="rounded-xl border border-border/40 bg-background/60 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Personal perspective</div>
            <p className="mt-2 text-sm text-foreground">
              {profile?.aboutPersonal || "No personal notes yet. The agent can add this when ready."}
            </p>
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <span>Created: {profile?.createdAt ? new Date(profile.createdAt).toLocaleString() : "-"}</span>
            <span>Updated: {profile?.updatedAt ? new Date(profile.updatedAt).toLocaleString() : "-"}</span>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card className="border border-destructive/40 bg-destructive/10">
          <CardContent className="p-4 text-xs text-destructive">{error}</CardContent>
        </Card>
      )}

      {loading && (
        <Card className="bg-card/40 border-border/40">
          <CardContent className="p-4 text-xs text-muted-foreground">Loading profile...</CardContent>
        </Card>
      )}
    </div>
  );
}
