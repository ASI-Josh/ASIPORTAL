"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import { storage } from "@/lib/firebaseClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cuttingApi } from "@/lib/cutting/api";
import { CUTTING_ISSUE_TAG_LABELS, PATTERN_SOURCE_LABELS } from "@/lib/types";
import type { CuttingIssueTag, CuttingPhoto, PatternSource } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Camera, CheckCircle2, Download, FileUp, Loader2, Save } from "lucide-react";

const ISSUE_TAGS: CuttingIssueTag[] = [
  "template_wrong",
  "fitment_off",
  "weeding_problem",
  "plotter_issue",
  "material_defect",
  "other",
];

const PATTERN_SOURCES: PatternSource[] = [
  "3m_marketplace",
  "summa_gosign",
  "manual_trace",
  "custom",
  "other",
];

export default function CuttingJobDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id as string;
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const svgInput = useRef<HTMLInputElement>(null);

  const [job, setJob] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [pendingSvg, setPendingSvg] = useState<string | null>(null);
  const [pendingSvgName, setPendingSvgName] = useState<string | null>(null);

  const isClient = user?.role === "client";

  useEffect(() => {
    if (!id) return;
    let mounted = true;
    Promise.all([cuttingApi.getJob(id), cuttingApi.listProfiles()])
      .then(([j, p]) => {
        if (!mounted) return;
        setJob(j.job);
        setProfiles(p.profiles);
      })
      .catch((e) =>
        toast({ title: "Couldn't load cutting job", description: e.message, variant: "destructive" }),
      )
      .finally(() => mounted && setLoading(false));
    return () => {
      mounted = false;
    };
  }, [id, toast]);

  const update = (patch: Record<string, any>) => setJob((j: any) => ({ ...j, ...patch }));

  const persist = async (patch: Record<string, any>) => {
    setSaving(true);
    try {
      const res = await cuttingApi.updateJob(id, patch);
      setJob(res.job);
      toast({ title: "Saved" });
    } catch (e: any) {
      toast({ title: "Couldn't save", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (kind: CuttingPhoto["kind"]) => {
    fileInput.current?.click();
    fileInput.current!.dataset.kind = kind;
  };

  const onFileSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    const kind = (fileInput.current?.dataset.kind as CuttingPhoto["kind"]) || "other";
    if (!file) return;
    try {
      const path = `cutting/${id}/${Date.now()}-${file.name}`;
      const ref = storageRef(storage, path);
      await uploadBytes(ref, file);
      const url = await getDownloadURL(ref);
      const newPhoto: CuttingPhoto = {
        id: `${Date.now()}`,
        url,
        kind,
        uploadedAt: { seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 } as any,
        uploadedBy: { id: user?.uid ?? "", name: user?.name ?? "" },
      };
      const photos = [...(job?.photos ?? []), newPhoto];
      await persist({ photos });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      e.target.value = "";
    }
  };

  const onSvgSelected: React.ChangeEventHandler<HTMLInputElement> = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setPendingSvg(text);
    setPendingSvgName(file.name);
    e.target.value = "";
    toast({ title: "SVG loaded", description: `${file.name} ready — click Generate .plt.` });
  };

  const generatePlt = async () => {
    if (!pendingSvg) {
      toast({
        title: "No SVG loaded",
        description: "Upload the pattern SVG first.",
        variant: "destructive",
      });
      return;
    }
    setGenerating(true);
    try {
      const res = await cuttingApi.generatePlt(id, {
        svg: pendingSvg,
        materialProfileId: job?.materialProfileId ?? undefined,
      });
      const blob = new Blob([res.hpgl], { type: "application/vnd.hp-pcl" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = res.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(link.href);
      toast({
        title: ".plt generated",
        description: `${res.pathCount} paths · ~${res.totalLengthMm.toFixed(0)}mm cut · ${res.boundingBoxMm.width.toFixed(0)}×${res.boundingBoxMm.height.toFixed(0)}mm`,
      });
      // Pre-fill consumed metres if not set yet
      if (!job?.rollConsumedMetres) {
        const metres = +(res.totalLengthMm / 1000).toFixed(2);
        update({ rollConsumedMetres: metres });
      }
    } catch (e: any) {
      toast({ title: ".plt generation failed", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const markQcPass = async () => {
    setCompleting(true);
    try {
      await cuttingApi.completeJob(id);
      const res = await cuttingApi.getJob(id);
      setJob(res.job);
      toast({ title: "QC pass — stock decremented" });
    } catch (e: any) {
      toast({ title: "Couldn't complete", description: e.message, variant: "destructive" });
    } finally {
      setCompleting(false);
    }
  };

  const toggleIssueTag = (tag: CuttingIssueTag) => {
    const current = new Set<CuttingIssueTag>(job?.issueTags ?? []);
    if (current.has(tag)) current.delete(tag);
    else current.add(tag);
    update({ issueTags: Array.from(current) });
  };

  const photosByKind = useMemo(() => {
    const groups: Record<string, CuttingPhoto[]> = { before: [], in_progress: [], after: [] };
    for (const p of (job?.photos as CuttingPhoto[]) ?? []) {
      if (p.kind in groups) groups[p.kind].push(p);
    }
    return groups;
  }, [job?.photos]);

  if (loading) return <p className="text-muted-foreground">Loading…</p>;
  if (!job) return <p className="text-destructive">Cutting job not found.</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="ghost" size="sm">
          <Link href="/cutting">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Link>
        </Button>
        <div className="flex-1">
          <h1 className="font-headline text-2xl font-semibold flex items-center gap-3">
            {job.cuttingNumber}
            <Badge variant={job.qcStatus === "pass" ? "default" : job.qcStatus === "fail" ? "destructive" : "secondary"}>
              {job.qcStatus.replace(/_/g, " ")}
            </Badge>
          </h1>
        </div>
        <Button onClick={() => persist({
          vehicle: job.vehicle,
          patternSource: job.patternSource,
          patternReference: job.patternReference,
          patternUrl: job.patternUrl,
          filmStockDescription: job.filmStockDescription,
          rollConsumedMetres: job.rollConsumedMetres,
          operatorName: job.operatorName,
          issuesText: job.issuesText,
          issueTags: job.issueTags,
          notes: job.notes,
          materialProfileId: job.materialProfileId,
        })} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save
        </Button>
      </div>

      <input ref={fileInput} type="file" accept="image/*,capture=environment" hidden onChange={onFileSelected} />
      <input ref={svgInput} type="file" accept=".svg,image/svg+xml" hidden onChange={onSvgSelected} />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Vehicle</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Year</Label>
                <Input
                  type="number"
                  value={job.vehicle?.year ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), year: e.target.value ? Number(e.target.value) : undefined } })}
                />
              </div>
              <div>
                <Label>Registration</Label>
                <Input
                  value={job.vehicle?.registration ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), registration: e.target.value } })}
                />
              </div>
              <div>
                <Label>Make</Label>
                <Input
                  value={job.vehicle?.make ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), make: e.target.value } })}
                />
              </div>
              <div>
                <Label>Model</Label>
                <Input
                  value={job.vehicle?.model ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), model: e.target.value } })}
                />
              </div>
              <div>
                <Label>Trim</Label>
                <Input
                  value={job.vehicle?.trim ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), trim: e.target.value } })}
                />
              </div>
              <div>
                <Label>VIN</Label>
                <Input
                  value={job.vehicle?.vin ?? ""}
                  onChange={(e) => update({ vehicle: { ...(job.vehicle ?? {}), vin: e.target.value } })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Pattern</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Pattern source</Label>
              <Select
                value={job.patternSource}
                onValueChange={(v) => update({ patternSource: v as PatternSource })}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PATTERN_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{PATTERN_SOURCE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Pattern reference</Label>
              <Input
                value={job.patternReference ?? ""}
                onChange={(e) => update({ patternReference: e.target.value })}
                placeholder="e.g. 3M Pattern #PP-12345"
              />
            </div>
            <div>
              <Label>Pattern URL</Label>
              <Input
                value={job.patternUrl ?? ""}
                onChange={(e) => update({ patternUrl: e.target.value })}
                placeholder="https://…"
              />
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Photos</CardTitle>
            <CardDescription>Minimum 3 (before, in-progress, after). {(job.photos ?? []).length} uploaded.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-3">
            {(["before", "in_progress", "after"] as const).map((kind) => (
              <div key={kind} className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="capitalize">{kind.replace("_", " ")}</Label>
                  <Button size="sm" variant="outline" onClick={() => handlePhotoUpload(kind)}>
                    <Camera className="h-4 w-4 mr-1" />
                    Upload
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {photosByKind[kind].map((p) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={p.id} src={p.url} alt={kind} className="rounded-md border aspect-square object-cover" />
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Material & operator</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Film type / stock description</Label>
              <Input
                value={job.filmStockDescription ?? ""}
                onChange={(e) => update({ filmStockDescription: e.target.value })}
                placeholder="APEAX PPF / APEAX WPF / …"
              />
            </div>
            <div>
              <Label>Linked stock item ID</Label>
              <Input
                value={job.filmStockItemId ?? ""}
                onChange={(e) => update({ filmStockItemId: e.target.value })}
                placeholder="(stockItems doc id — required for QC-pass decrement)"
              />
            </div>
            <div>
              <Label>Roll consumed (metres)</Label>
              <Input
                type="number"
                step="0.01"
                value={job.rollConsumedMetres ?? ""}
                onChange={(e) => update({ rollConsumedMetres: e.target.value ? Number(e.target.value) : undefined })}
              />
            </div>
            <div>
              <Label>Operator</Label>
              <Input
                value={job.operatorName ?? ""}
                onChange={(e) => update({ operatorName: e.target.value })}
              />
            </div>
            <div>
              <Label>Material profile</Label>
              <Select
                value={job.materialProfileId ?? ""}
                onValueChange={(v) => update({ materialProfileId: v || undefined })}
              >
                <SelectTrigger><SelectValue placeholder="Select profile" /></SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · {p.cuttingForceGrams}g · {p.speedMmPerSec}mm/s · {p.passCount} pass
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>HPGL output</CardTitle>
            <CardDescription>Convert SVG to .plt for the Summa S One.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" onClick={() => svgInput.current?.click()} className="w-full">
              <FileUp className="h-4 w-4 mr-2" />
              {pendingSvgName ? `Loaded: ${pendingSvgName}` : "Upload pattern SVG"}
            </Button>
            <Button onClick={generatePlt} disabled={!pendingSvg || generating} className="w-full">
              {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
              Generate & download .plt
            </Button>
            {job.lastPlotGeneratedAt ? (
              <p className="text-xs text-muted-foreground">
                Last generated: {new Date(job.lastPlotGeneratedAt._seconds * 1000).toLocaleString()}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>QC & issues</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {ISSUE_TAGS.map((tag) => {
                const active = (job.issueTags ?? []).includes(tag);
                return (
                  <Badge
                    key={tag}
                    variant={active ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleIssueTag(tag)}
                  >
                    {CUTTING_ISSUE_TAG_LABELS[tag]}
                  </Badge>
                );
              })}
            </div>
            <div>
              <Label>Issues encountered</Label>
              <Textarea
                value={job.issuesText ?? ""}
                onChange={(e) => update({ issuesText: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                value={job.notes ?? ""}
                onChange={(e) => update({ notes: e.target.value })}
                rows={3}
              />
            </div>
            {!isClient ? (
              <div className="flex justify-end">
                <Button onClick={markQcPass} disabled={completing || job.qcStatus === "pass"}>
                  {completing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                  {job.qcStatus === "pass" ? "QC passed" : "Mark QC pass + decrement stock"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
