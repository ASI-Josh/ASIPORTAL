"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Building2, Globe, Linkedin, Phone, Mail,
  TrendingUp, Send, Lightbulb, FileText, PlusCircle,
  Calendar, CheckCircle2, AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import type { Lead, PipelineStage, OutreachEvent, OutreachEventType } from "@/lib/types";

const STAGE_CONFIG: Record<PipelineStage, { label: string; color: string; bg: string }> = {
  identified:    { label: "Identified",    color: "text-zinc-400",    bg: "bg-zinc-500/15" },
  researched:    { label: "Researched",    color: "text-violet-400",  bg: "bg-violet-500/15" },
  contacted:     { label: "Contacted",     color: "text-blue-400",    bg: "bg-blue-500/15" },
  engaged:       { label: "Engaged",       color: "text-cyan-400",    bg: "bg-cyan-500/15" },
  qualified:     { label: "Qualified",     color: "text-teal-400",    bg: "bg-teal-500/15" },
  proposal_sent: { label: "Proposal Sent", color: "text-amber-400",   bg: "bg-amber-500/15" },
  negotiation:   { label: "Negotiation",   color: "text-orange-400",  bg: "bg-orange-500/15" },
  won:           { label: "Won",           color: "text-green-400",   bg: "bg-green-500/15" },
  lost:          { label: "Lost",          color: "text-red-400",     bg: "bg-red-500/15" },
  nurture:       { label: "Nurture",       color: "text-purple-400",  bg: "bg-purple-500/15" },
};

// ─── Config ───────────────────────────────────────────────────────────────────

const GRADE_CONFIG: Record<Lead["leadGrade"], { color: string; bg: string }> = {
  A: { color: "text-green-400",  bg: "bg-green-500/20" },
  B: { color: "text-blue-400",   bg: "bg-blue-500/20" },
  C: { color: "text-amber-400",  bg: "bg-amber-500/20" },
  D: { color: "text-zinc-400",   bg: "bg-zinc-500/20" },
  E: { color: "text-red-400",    bg: "bg-red-500/20" },
};

const OUTREACH_EVENT_LABELS: Record<OutreachEventType, string> = {
  linkedin_connect: "LinkedIn Connect",
  linkedin_message: "LinkedIn Message",
  email: "Email",
  phone: "Phone Call",
  meeting: "Meeting",
  proposal: "Proposal",
  follow_up: "Follow Up",
};

const BANT_FIELDS: { key: keyof Lead["bantBreakdown"]; label: string; max: number; color: string }[] = [
  { key: "budget",    label: "Budget",    max: 20, color: "bg-blue-500" },
  { key: "authority", label: "Authority", max: 20, color: "bg-violet-500" },
  { key: "need",      label: "Need",      max: 25, color: "bg-emerald-500" },
  { key: "timing",    label: "Timing",    max: 20, color: "bg-amber-500" },
  { key: "fit",       label: "Fit",       max: 15, color: "bg-cyan-500" },
];

function formatCurrency(n?: number) {
  if (!n) return "Not set";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

// ─── Log Outreach Modal ───────────────────────────────────────────────────────

function LogOutreachModal({ leadId, open, onClose, onLogged, getToken }: {
  leadId: string; open: boolean; onClose: () => void; onLogged: () => void;
  getToken: () => Promise<string>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    type: "email" as OutreachEventType,
    date: new Date().toISOString().split("T")[0],
    subject: "", summary: "", response: "", nextStep: "",
  });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${leadId}/outreach`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Outreach logged" });
      onLogged();
      onClose();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Log Outreach Event</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Type</Label>
              <Select value={form.type} onValueChange={(v) => set("type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(OUTREACH_EVENT_LABELS) as OutreachEventType[]).map((t) => (
                    <SelectItem key={t} value={t}>{OUTREACH_EVENT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Subject / Topic</Label>
            <Input value={form.subject} onChange={(e) => set("subject", e.target.value)} placeholder="Brief subject" />
          </div>
          <div className="space-y-1">
            <Label>Summary *</Label>
            <Textarea rows={3} value={form.summary} onChange={(e) => set("summary", e.target.value)} placeholder="What happened? What was discussed?" />
          </div>
          <div className="space-y-1">
            <Label>Response received</Label>
            <Input value={form.response} onChange={(e) => set("response", e.target.value)} placeholder="Their response (if any)" />
          </div>
          <div className="space-y-1">
            <Label>Next step</Label>
            <Input value={form.nextStep} onChange={(e) => set("nextStep", e.target.value)} placeholder="What's the follow-up?" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.summary.trim()}>
              {saving ? "Logging…" : "Log Event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { toast } = useToast();
  const { firebaseUser } = useAuth();
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [savingStage, setSavingStage] = useState(false);

  const getToken = async () => {
    if (!firebaseUser) throw new Error("Not signed in");
    return firebaseUser.getIdToken();
  };

  const fetchLead = async () => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${id}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { router.push("/dashboard/crm"); return; }
      setLead(await res.json());
    } catch {
      toast({ title: "Failed to load lead", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (firebaseUser) fetchLead(); }, [id, firebaseUser]);

  const handleStageChange = async (stage: PipelineStage) => {
    setSavingStage(true);
    try {
      const token = await getToken();
      await fetch(`/api/leads/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage }),
      });
      setLead((l) => l ? { ...l, stage } : l);
      toast({ title: `Stage updated to ${STAGE_CONFIG[stage].label}` });
    } catch {
      toast({ title: "Failed", variant: "destructive" });
    } finally {
      setSavingStage(false);
    }
  };

  if (loading) return <div className="p-6 animate-pulse space-y-4"><div className="h-8 w-64 bg-card/50 rounded" /><div className="h-64 bg-card/50 rounded-xl" /></div>;
  if (!lead) return null;

  const stageCfg = STAGE_CONFIG[lead.stage];
  const gradeCfg = GRADE_CONFIG[lead.leadGrade];
  const primaryContact = lead.contacts.find((c) => c.isPrimary) || lead.contacts[0];
  const sortedOutreach = [...(lead.outreachHistory || [])].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/dashboard/crm"><ChevronLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold">{lead.companyName}</h1>
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${gradeCfg.bg} ${gradeCfg.color}`}>
                Grade {lead.leadGrade}
              </span>
              <Badge className={`text-xs ${stageCfg.bg} ${stageCfg.color} border-0 hover:${stageCfg.bg}`}>
                {stageCfg.label}
              </Badge>
              {lead.source.type === "osint" && (
                <Badge variant="outline" className="text-[10px] text-primary border-primary/30">OSINT</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-0.5">{lead.leadNumber} · BANT {lead.bantScore}/100</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select onValueChange={handleStageChange} disabled={savingStage}>
            <SelectTrigger className="w-44 bg-card/50 border-border/30">
              <SelectValue placeholder="Change stage…" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STAGE_CONFIG) as PipelineStage[]).map((s) => (
                <SelectItem key={s} value={s}>{STAGE_CONFIG[s].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" onClick={() => setLogOpen(true)}>
            <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Log Outreach
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="outreach">
            Outreach
            {sortedOutreach.length > 0 && (
              <Badge variant="outline" className="ml-1.5 text-[10px] h-4 px-1">{sortedOutreach.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="intelligence">Intelligence</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* ── Overview ── */}
        <TabsContent value="overview" className="space-y-4 mt-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {/* Company */}
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />Company</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sector</span><span className="capitalize">{lead.sector.replace("-", " ")}</span></div>
                {lead.companySize && <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span className="capitalize">{lead.companySize}</span></div>}
                <div className="flex justify-between"><span className="text-muted-foreground">Client?</span><span>{lead.isExistingClient ? "Existing client" : "New prospect"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Est. Value</span><span className="font-medium">{formatCurrency(lead.estimatedValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Market mode</span><span className="capitalize">{lead.marketMode}</span></div>
                <div className="flex gap-2 pt-1">
                  {lead.companyWebsite && <a href={lead.companyWebsite} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="h-4 w-4" /></a>}
                  {lead.companyLinkedIn && <a href={lead.companyLinkedIn} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary"><Linkedin className="h-4 w-4" /></a>}
                </div>
              </CardContent>
            </Card>

            {/* Primary contact */}
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Mail className="h-4 w-4 text-blue-400" />Primary Contact</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {primaryContact ? (
                  <>
                    <p className="font-medium">{primaryContact.name}</p>
                    {primaryContact.title && <p className="text-muted-foreground">{primaryContact.title}</p>}
                    {primaryContact.email && (
                      <a href={`mailto:${primaryContact.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                        <Mail className="h-3.5 w-3.5" />{primaryContact.email}
                      </a>
                    )}
                    {primaryContact.phone && (
                      <a href={`tel:${primaryContact.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                        <Phone className="h-3.5 w-3.5" />{primaryContact.phone}
                      </a>
                    )}
                    {primaryContact.linkedInUrl && (
                      <a href={primaryContact.linkedInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                        <Linkedin className="h-3.5 w-3.5" />LinkedIn
                      </a>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">No contacts added.</p>
                )}
              </CardContent>
            </Card>

            {/* Next action */}
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Calendar className="h-4 w-4 text-amber-400" />Next Action</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                {lead.nextAction ? (
                  <p className="font-medium">{lead.nextAction}</p>
                ) : <p className="text-muted-foreground">No action set.</p>}
                {lead.nextActionDate && (
                  <p className="text-muted-foreground">{lead.nextActionDate}</p>
                )}
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Outreach sequence</p>
                  <p className="font-medium">{lead.outreachSequence ? `Sequence ${lead.outreachSequence}` : "Not set"}</p>
                </div>
                {lead.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {lead.tags.map((t) => (
                      <span key={t} className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">{t}</span>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* BANT */}
          <Card className="bg-card/50 border-border/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />BANT Score</span>
                <span className="text-lg font-bold">{lead.bantScore}<span className="text-sm font-normal text-muted-foreground">/100</span></span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {BANT_FIELDS.map(({ key, label, max, color }) => {
                  const val = lead.bantBreakdown?.[key] || 0;
                  const pct = (val / max) * 100;
                  return (
                    <div key={key}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-medium">{val}/{max}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* Pain points + ASI fit */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-red-400" />Pain Points</CardTitle></CardHeader>
              <CardContent>
                {lead.painPoints.length ? (
                  <ul className="space-y-1">{lead.painPoints.map((p, i) => <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-red-400 mt-0.5">▸</span>{p}</li>)}</ul>
                ) : <p className="text-sm text-muted-foreground">None recorded.</p>}
              </CardContent>
            </Card>
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />ASI Solution Fit</CardTitle></CardHeader>
              <CardContent>
                {lead.asiSolutionFit.length ? (
                  <ul className="space-y-1">{lead.asiSolutionFit.map((f, i) => <li key={i} className="text-sm text-muted-foreground flex gap-2"><span className="text-emerald-400 mt-0.5">▸</span>{f}</li>)}</ul>
                ) : <p className="text-sm text-muted-foreground">None recorded.</p>}
                {lead.estimatedServices.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-border/30">
                    {lead.estimatedServices.map((s) => <Badge key={s} variant="outline" className="text-[10px]">{s}</Badge>)}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Outreach ── */}
        <TabsContent value="outreach" className="space-y-4 mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Emails sent", value: lead.outreachStatus?.emailsSent || 0 },
              { label: "LinkedIn connected", value: lead.outreachStatus?.linkedInConnected ? "Yes" : "No" },
              { label: "Response received", value: lead.outreachStatus?.responseReceived ? "Yes" : "No" },
              { label: "Meeting scheduled", value: lead.outreachStatus?.meetingScheduled ? "Yes" : "No" },
            ].map(({ label, value }) => (
              <div key={label} className="bg-card/50 border border-border/30 rounded-xl p-3 text-center">
                <p className="text-lg font-bold text-foreground">{value}</p>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setLogOpen(true)}>
              <PlusCircle className="h-3.5 w-3.5 mr-1.5" /> Log Event
            </Button>
          </div>
          {sortedOutreach.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">No outreach logged yet.</p>
          ) : (
            <div className="space-y-3">
              {sortedOutreach.map((ev) => (
                <div key={ev.id} className="bg-card/50 border border-border/30 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Send className="h-3.5 w-3.5 text-primary" />
                      <span className="text-sm font-medium">{OUTREACH_EVENT_LABELS[ev.type]}</span>
                      {ev.subject && <span className="text-sm text-muted-foreground">— {ev.subject}</span>}
                    </div>
                    <span className="text-xs text-muted-foreground">{ev.date}</span>
                  </div>
                  <p className="text-sm text-muted-foreground">{ev.summary}</p>
                  {ev.response && <p className="text-sm text-foreground mt-2 pl-3 border-l-2 border-primary/40"><span className="text-muted-foreground">Response: </span>{ev.response}</p>}
                  {ev.nextStep && <p className="text-xs text-primary mt-2">→ {ev.nextStep}</p>}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ── Intelligence ── */}
        <TabsContent value="intelligence" className="space-y-4 mt-4">
          <Card className="bg-card/50 border-border/20">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-400" />Source</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{lead.source.type}</span></div>
              {lead.source.osintScanDate && <div className="flex justify-between"><span className="text-muted-foreground">OSINT scan</span><span>{lead.source.osintScanDate}</span></div>}
              {lead.source.osintPillar && <div className="flex justify-between"><span className="text-muted-foreground">Pillar</span><span className="capitalize">{lead.source.osintPillar.replace("-", " ")}</span></div>}
              {lead.source.osintRelevanceScore && <div className="flex justify-between"><span className="text-muted-foreground">Relevance score</span><span>{lead.source.osintRelevanceScore}/5</span></div>}
              {lead.source.osintFinding && (
                <div className="mt-2 p-3 bg-primary/5 border border-primary/15 rounded-lg">
                  <p className="text-xs text-muted-foreground mb-1">Finding</p>
                  <p className="text-sm">{lead.source.osintFinding}</p>
                </div>
              )}
              {lead.source.referralSource && <div className="flex justify-between"><span className="text-muted-foreground">Referral</span><span>{lead.source.referralSource}</span></div>}
              {lead.source.tenderReference && <div className="flex justify-between"><span className="text-muted-foreground">Tender ref</span><span>{lead.source.tenderReference}</span></div>}
            </CardContent>
          </Card>
          {lead.source.osintScanDate && (
            <div className="text-center pt-2">
              <Link href="/dashboard/osint" className="text-sm text-primary hover:underline">
                View full OSINT scan →
              </Link>
            </div>
          )}
        </TabsContent>

        {/* ── Notes ── */}
        <TabsContent value="notes" className="mt-4">
          <Card className="bg-card/50 border-border/20">
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />Notes</CardTitle></CardHeader>
            <CardContent>
              {lead.notes ? (
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
              ) : (
                <p className="text-sm text-muted-foreground">No notes yet.</p>
              )}
            </CardContent>
          </Card>

          {lead.stageHistory.length > 0 && (
            <Card className="bg-card/50 border-border/20 mt-4">
              <CardHeader className="pb-3"><CardTitle className="text-sm">Stage History</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[...lead.stageHistory].reverse().map((h, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-24 flex-shrink-0">{h.changedAt.split("T")[0]}</span>
                      <span>{STAGE_CONFIG[h.fromStage]?.label}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className={STAGE_CONFIG[h.toStage]?.color}>{STAGE_CONFIG[h.toStage]?.label}</span>
                      {h.reason && <span className="text-muted-foreground">· {h.reason}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      <LogOutreachModal leadId={id} open={logOpen} onClose={() => setLogOpen(false)} onLogged={fetchLead} getToken={getToken} />
    </div>
  );
}
