"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { cuttingApi } from "@/lib/cutting/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Plus, Save } from "lucide-react";

type Draft = {
  name: string;
  filmType: string;
  cuttingForceGrams: number;
  speedMmPerSec: number;
  bladeDepthMm: number;
  passCount: number;
  toolNumber: number;
};

const EMPTY_DRAFT: Draft = {
  name: "",
  filmType: "",
  cuttingForceGrams: 120,
  speedMmPerSec: 400,
  bladeDepthMm: 0.25,
  passCount: 1,
  toolNumber: 1,
};

export default function MaterialProfilesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [saving, setSaving] = useState(false);

  const isAdmin = user?.role === "admin";

  const refresh = async () => {
    const r = await cuttingApi.listProfiles();
    setProfiles(r.profiles);
  };

  useEffect(() => {
    refresh()
      .catch((e) => toast({ title: "Couldn't load", description: e.message, variant: "destructive" }))
      .finally(() => setLoading(false));
  }, [toast]);

  const handleCreate = async () => {
    if (!draft.name.trim()) {
      toast({ title: "Name required", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await cuttingApi.createProfile({ ...draft, isActive: true });
      setDraft(EMPTY_DRAFT);
      await refresh();
      toast({ title: "Profile created" });
    } catch (e: any) {
      toast({ title: "Create failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    try {
      await cuttingApi.updateProfile(id, { isActive: !isActive });
      await refresh();
    } catch (e: any) {
      toast({ title: "Update failed", description: e.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cutting">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
        <h1 className="font-headline text-2xl font-semibold">Material profiles</h1>
      </div>

      {isAdmin ? (
        <Card>
          <CardHeader>
            <CardTitle>New profile</CardTitle>
            <CardDescription>Cutting parameters per film. Used by the HPGL output module.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="APEAX PPF Standard" />
            </div>
            <div>
              <Label>Film type</Label>
              <Input value={draft.filmType} onChange={(e) => setDraft({ ...draft, filmType: e.target.value })} placeholder="APEAX PPF" />
            </div>
            <div>
              <Label>Cutting force (g)</Label>
              <Input type="number" value={draft.cuttingForceGrams} onChange={(e) => setDraft({ ...draft, cuttingForceGrams: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Speed (mm/s)</Label>
              <Input type="number" value={draft.speedMmPerSec} onChange={(e) => setDraft({ ...draft, speedMmPerSec: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Blade depth (mm)</Label>
              <Input type="number" step="0.01" value={draft.bladeDepthMm} onChange={(e) => setDraft({ ...draft, bladeDepthMm: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Pass count</Label>
              <Input type="number" value={draft.passCount} onChange={(e) => setDraft({ ...draft, passCount: Number(e.target.value) })} />
            </div>
            <div>
              <Label>Tool number</Label>
              <Input type="number" value={draft.toolNumber} onChange={(e) => setDraft({ ...draft, toolNumber: Number(e.target.value) })} />
            </div>
            <div className="md:col-span-3">
              <Button onClick={handleCreate} disabled={saving}>
                {saving ? "Saving…" : (<><Plus className="h-4 w-4 mr-2" /> Create profile</>)}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground text-sm">Loading…</p>
          ) : profiles.length === 0 ? (
            <p className="text-muted-foreground text-sm">No profiles yet.</p>
          ) : (
            <ul className="space-y-3">
              {profiles.map((p) => (
                <li key={p.id} className="flex flex-col gap-1 rounded-md border p-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="font-medium">
                      {p.name}{" "}
                      <Badge variant={p.isActive ? "default" : "secondary"} className="ml-2">
                        {p.isActive ? "active" : "inactive"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.filmType ? `${p.filmType} · ` : ""}
                      {p.cuttingForceGrams}g · {p.speedMmPerSec}mm/s · blade {p.bladeDepthMm ?? "—"}mm · {p.passCount} pass · tool {p.toolNumber ?? 1}
                    </div>
                  </div>
                  {isAdmin ? (
                    <Button size="sm" variant="outline" onClick={() => toggleActive(p.id, p.isActive)}>
                      <Save className="h-4 w-4 mr-2" />
                      {p.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
