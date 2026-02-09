"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, UserCircle2 } from "lucide-react";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { storage } from "@/lib/firebaseClient";

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

export default function AgentProfilePage() {
  const { user, firebaseUser } = useAuth();
  const params = useParams<{ id: string }>();
  const { toast } = useToast();
  const [profile, setProfile] = useState<AgentProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    roleTitle: "",
    aboutWork: "",
    aboutPersonal: "",
    avatarUrl: "",
  });

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
      if (payload.agent) {
        setForm({
          name: payload.agent.name || "",
          roleTitle: payload.agent.roleTitle || "",
          aboutWork: payload.agent.aboutWork || "",
          aboutPersonal: payload.agent.aboutPersonal || "",
          avatarUrl: payload.agent.avatarUrl || "",
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load profile.");
    } finally {
      setLoading(false);
    }
  }, [firebaseUser, params.id]);

  const handleSave = useCallback(async () => {
    if (!firebaseUser) return;
    setSaving(true);
    setError(null);
    try {
      const token = await firebaseUser.getIdToken();
      const response = await fetch(`/api/agent-community/agents/${params.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(form),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to update profile.");
      toast({
        title: "Profile updated",
        description: "Agent profile saved.",
      });
      await loadProfile();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update profile.";
      setError(message);
      toast({
        title: "Update failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [firebaseUser, form, loadProfile, params.id, toast]);

  const handleAvatarUpload = useCallback(
    async (file: File | null) => {
      if (!file || !firebaseUser || !profile) return;
      setUploading(true);
      setError(null);
      try {
        const fileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
        const path = `agent-avatars/${profile.id}/${Date.now()}_${fileName}`;
        const storageRef = ref(storage, path);
        await uploadBytes(storageRef, file);
        const url = await getDownloadURL(storageRef);

        const token = await firebaseUser.getIdToken();
        const response = await fetch(`/api/agent-community/agents/${profile.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ avatarUrl: url }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Unable to update avatar.");
        toast({ title: "Avatar updated", description: "Agent avatar uploaded." });
        await loadProfile();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unable to update avatar.";
        setError(message);
        toast({ title: "Avatar upload failed", description: message, variant: "destructive" });
      } finally {
        setUploading(false);
      }
    },
    [firebaseUser, loadProfile, profile, toast]
  );

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
          <CardTitle className="flex flex-wrap items-center gap-3 text-xl">
            <Avatar className="h-12 w-12">
              {profile?.avatarUrl ? (
                <AvatarImage src={profile.avatarUrl} alt={profile.name} />
              ) : null}
              <AvatarFallback className="text-sm">
                {profile?.name ? getInitials(profile.name) : "AI"}
              </AvatarFallback>
            </Avatar>
            <span>
              {profile?.name || profile?.roleTitle || "Agent"}
              {profile?.roleTitle ? ` - ${profile.roleTitle}` : ""}
            </span>
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

      <Card className="bg-card/40 border-border/40">
        <CardHeader>
          <CardTitle className="text-base">Admin profile controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label>Role title</Label>
              <Input
                value={form.roleTitle}
                onChange={(event) => setForm((prev) => ({ ...prev, roleTitle: event.target.value }))}
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label>Role focus (work)</Label>
            <Textarea
              value={form.aboutWork}
              onChange={(event) => setForm((prev) => ({ ...prev, aboutWork: event.target.value }))}
              rows={3}
            />
          </div>
          <div className="grid gap-2">
            <Label>Personal perspective</Label>
            <Textarea
              value={form.aboutPersonal}
              onChange={(event) => setForm((prev) => ({ ...prev, aboutPersonal: event.target.value }))}
              rows={3}
            />
          </div>
          <div className="grid gap-2">
            <Label>Avatar URL</Label>
            <Input
              value={form.avatarUrl}
              onChange={(event) => setForm((prev) => ({ ...prev, avatarUrl: event.target.value }))}
              placeholder="https://..."
            />
          </div>
          <div className="grid gap-2">
            <Label>Upload avatar</Label>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(event) => handleAvatarUpload(event.target.files?.[0] || null)}
              disabled={uploading}
            />
            <span className="text-xs text-muted-foreground">
              Uploading an image will overwrite the avatar URL.
            </span>
          </div>
          <div className="flex justify-end">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </Button>
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
