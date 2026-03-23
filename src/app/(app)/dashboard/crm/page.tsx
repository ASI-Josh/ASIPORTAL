"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  PlusCircle, TrendingUp, Users, AlertTriangle, RefreshCw,
  Building2, Flame, Filter, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import type { Lead, PipelineStage, LeadSector } from "@/lib/types";

// ─── Stage config ─────────────────────────────────────────────────────────────

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

const GRADE_CONFIG: Record<Lead["leadGrade"], { color: string; bg: string }> = {
  A: { color: "text-green-400",  bg: "bg-green-500/20" },
  B: { color: "text-blue-400",   bg: "bg-blue-500/20" },
  C: { color: "text-amber-400",  bg: "bg-amber-500/20" },
  D: { color: "text-zinc-400",   bg: "bg-zinc-500/20" },
  E: { color: "text-red-400",    bg: "bg-red-500/20" },
};

const ACTIVE_STAGES: PipelineStage[] = [
  "identified", "researched", "contacted", "engaged",
  "qualified", "proposal_sent", "negotiation",
];
const OTHER_STAGES: PipelineStage[] = ["won", "lost", "nurture"];

const SECTORS: { value: LeadSector; label: string }[] = [
  { value: "mass-transit", label: "Mass Transit" },
  { value: "manufacturing", label: "Manufacturing" },
  { value: "wholesale-trade", label: "Wholesale Trade" },
  { value: "structural", label: "Structural" },
  { value: "marine", label: "Marine" },
  { value: "other", label: "Other" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCurrency(n?: number) {
  if (!n) return "";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

function daysInStage(enteredAt?: string) {
  if (!enteredAt) return 0;
  return Math.floor((Date.now() - new Date(enteredAt).getTime()) / 86400000);
}

// ─── Lead card ────────────────────────────────────────────────────────────────

function LeadCard({ lead, onStageChange }: {
  lead: Lead;
  onStageChange: (id: string, stage: PipelineStage) => void;
}) {
  const grade = GRADE_CONFIG[lead.leadGrade];
  const days = daysInStage(lead.stageEnteredAt);
  const today = new Date().toISOString().split("T")[0];
  const overdue = lead.nextActionDate && lead.nextActionDate < today;

  return (
    <div className="bg-card/70 border border-border/40 rounded-xl p-3 hover:border-primary/40 transition-all group">
      <div className="flex items-start justify-between gap-2 mb-2">
        <Link
          href={`/dashboard/crm/${lead.id}`}
          className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors leading-snug flex-1"
        >
          {lead.companyName}
        </Link>
        <span className={`flex-shrink-0 text-xs font-bold px-1.5 py-0.5 rounded ${grade.bg} ${grade.color}`}>
          {lead.leadGrade}
        </span>
      </div>

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span className="text-[10px] text-muted-foreground">{lead.leadNumber}</span>
        {lead.bantScore > 0 && (
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded text-muted-foreground">
            BANT {lead.bantScore}
          </span>
        )}
        {lead.source.type === "osint" && (
          <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">OSINT</span>
        )}
      </div>

      {lead.estimatedValue ? (
        <p className="text-sm font-medium text-foreground mb-1">{formatCurrency(lead.estimatedValue)}</p>
      ) : null}

      {lead.nextAction && (
        <p className={`text-xs mb-2 truncate ${overdue ? "text-red-400" : "text-muted-foreground"}`}>
          {overdue ? "⚠ " : "→ "}{lead.nextAction}
          {lead.nextActionDate && ` · ${lead.nextActionDate}`}
        </p>
      )}

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/30">
        <span className="text-[10px] text-muted-foreground">{days}d in stage</span>
        <Select onValueChange={(v) => onStageChange(lead.id, v as PipelineStage)}>
          <SelectTrigger className="h-6 text-[10px] w-28 border-0 bg-muted/50 hover:bg-muted px-2">
            <SelectValue placeholder="Move to…" />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(STAGE_CONFIG) as PipelineStage[]).map((s) => (
              <SelectItem key={s} value={s} className="text-xs">{STAGE_CONFIG[s].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ─── Column ───────────────────────────────────────────────────────────────────

function KanbanColumn({ stage, leads, onStageChange }: {
  stage: PipelineStage;
  leads: Lead[];
  onStageChange: (id: string, stage: PipelineStage) => void;
}) {
  const cfg = STAGE_CONFIG[stage];
  const totalValue = leads.reduce((s, l) => s + (l.estimatedValue || 0), 0);
  return (
    <div className="flex-shrink-0 w-64">
      <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl border border-b-0 border-border/40 ${cfg.bg}`}>
        <span className={`text-xs font-semibold ${cfg.color}`}>{cfg.label}</span>
        <div className="flex items-center gap-1.5">
          {totalValue > 0 && (
            <span className="text-[10px] text-muted-foreground">{formatCurrency(totalValue)}</span>
          )}
          <Badge variant="outline" className="text-[10px] h-4 px-1">{leads.length}</Badge>
        </div>
      </div>
      <div className="bg-muted/20 border border-border/30 rounded-b-xl p-2 min-h-32 space-y-2">
        {leads.map((lead) => (
          <LeadCard key={lead.id} lead={lead} onStageChange={onStageChange} />
        ))}
        {leads.length === 0 && (
          <p className="text-center text-xs text-muted-foreground py-4">Empty</p>
        )}
      </div>
    </div>
  );
}

// ─── Add Lead modal ───────────────────────────────────────────────────────────

function AddLeadModal({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: "", sector: "other" as LeadSector,
    contactName: "", contactEmail: "", contactPhone: "",
    estimatedValue: "", notes: "", source: "manual",
    nextAction: "", nextActionDate: "",
    bantBudget: "0", bantAuthority: "0", bantNeed: "0", bantTiming: "0", bantFit: "0",
  });

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.companyName.trim()) return;
    setSaving(true);
    try {
      const bantBreakdown = {
        budget: parseInt(form.bantBudget) || 0,
        authority: parseInt(form.bantAuthority) || 0,
        need: parseInt(form.bantNeed) || 0,
        timing: parseInt(form.bantTiming) || 0,
        fit: parseInt(form.bantFit) || 0,
      };
      const contacts = form.contactName ? [{
        id: crypto.randomUUID(), name: form.contactName,
        email: form.contactEmail, phone: form.contactPhone, isPrimary: true,
      }] : [];

      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName: form.companyName, sector: form.sector,
          contacts, bantBreakdown,
          estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : undefined,
          notes: form.notes, nextAction: form.nextAction,
          nextActionDate: form.nextActionDate || undefined,
          source: { type: form.source },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Lead created" });
      onCreated();
      onClose();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label>Company Name *</Label>
              <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} placeholder="e.g. McKenzie's Tourist Services" />
            </div>
            <div className="space-y-1">
              <Label>Sector</Label>
              <Select value={form.sector} onValueChange={(v) => set("sector", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{SECTORS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Source</Label>
              <Select value={form.source} onValueChange={(v) => set("source", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["manual","osint","referral","inbound","linkedin","event","tender"].map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Est. Value (AUD)</Label>
              <Input type="number" value={form.estimatedValue} onChange={(e) => set("estimatedValue", e.target.value)} placeholder="0" />
            </div>
            <div className="space-y-1">
              <Label>Next Action Date</Label>
              <Input type="date" value={form.nextActionDate} onChange={(e) => set("nextActionDate", e.target.value)} />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">Primary Contact</p>
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Name" value={form.contactName} onChange={(e) => set("contactName", e.target.value)} />
              <Input placeholder="Title/Role" disabled />
              <Input placeholder="Email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} />
              <Input placeholder="Phone" value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} />
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-2">BANT Scoring (total = 100)</p>
            <div className="grid grid-cols-5 gap-1 text-center">
              {[
                { key: "bantBudget", label: "Budget", max: 20 },
                { key: "bantAuthority", label: "Authority", max: 20 },
                { key: "bantNeed", label: "Need", max: 25 },
                { key: "bantTiming", label: "Timing", max: 20 },
                { key: "bantFit", label: "Fit", max: 15 },
              ].map(({ key, label, max }) => (
                <div key={key} className="space-y-1">
                  <p className="text-[10px] text-muted-foreground">{label} /{max}</p>
                  <Input
                    type="number" min={0} max={max}
                    value={form[key as keyof typeof form]}
                    onChange={(e) => set(key, e.target.value)}
                    className="text-center px-1"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Next Action</Label>
            <Input value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} placeholder="e.g. Send LinkedIn connection" />
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={3} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Context, pain points, OSINT source..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.companyName.trim()}>
              {saving ? "Creating…" : "Create Lead"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CrmPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [showOther, setShowOther] = useState(false);
  const { toast } = useToast();

  const fetchLeads = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/leads");
      const data = await res.json();
      setLeads(data.leads || []);
    } catch {
      toast({ title: "Failed to load leads", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  const handleStageChange = async (id: string, stage: PipelineStage) => {
    try {
      await fetch(`/api/leads/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });
      setLeads((prev) => prev.map((l) => l.id === id ? { ...l, stage, stageEnteredAt: new Date().toISOString() } : l));
      toast({ title: `Moved to ${STAGE_CONFIG[stage].label}` });
    } catch {
      toast({ title: "Failed to update stage", variant: "destructive" });
    }
  };

  const filtered = leads.filter((l) =>
    !search || l.companyName.toLowerCase().includes(search.toLowerCase())
  );

  // Stats
  const totalValue = filtered.filter((l) => l.stage !== "lost").reduce((s, l) => s + (l.estimatedValue || 0), 0);
  const hotLeads = filtered.filter((l) => l.leadGrade === "A" || l.leadGrade === "B").length;
  const today = new Date().toISOString().split("T")[0];
  const overdue = filtered.filter((l) => l.nextActionDate && l.nextActionDate < today && l.stage !== "won" && l.stage !== "lost").length;

  return (
    <div className="flex flex-col gap-4 p-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sales Pipeline</h1>
          <p className="text-sm text-muted-foreground">Manage leads from identification through to close.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={fetchLeads} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button onClick={() => setAddOpen(true)}>
            <PlusCircle className="mr-2 h-4 w-4" /> Add Lead
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <div className="flex items-center gap-1.5 bg-card/50 border border-border/30 rounded-lg px-3 py-1.5">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">Pipeline:</span>
          <span className="font-semibold">{formatCurrency(totalValue)}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-card/50 border border-border/30 rounded-lg px-3 py-1.5">
          <Flame className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-muted-foreground">Hot leads (A/B):</span>
          <span className="font-semibold">{hotLeads}</span>
        </div>
        <div className={`flex items-center gap-1.5 border rounded-lg px-3 py-1.5 ${overdue > 0 ? "bg-red-500/10 border-red-500/30" : "bg-card/50 border-border/30"}`}>
          <AlertTriangle className={`h-3.5 w-3.5 ${overdue > 0 ? "text-red-400" : "text-muted-foreground"}`} />
          <span className="text-muted-foreground">Overdue:</span>
          <span className={`font-semibold ${overdue > 0 ? "text-red-400" : ""}`}>{overdue}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-card/50 border border-border/30 rounded-lg px-3 py-1.5">
          <Users className="h-3.5 w-3.5 text-blue-400" />
          <span className="text-muted-foreground">Total leads:</span>
          <span className="font-semibold">{filtered.length}</span>
        </div>
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input className="pl-8" placeholder="Search companies…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowOther(!showOther)}>
          <Filter className="h-3.5 w-3.5 mr-1.5" />
          {showOther ? "Hide Won/Lost/Nurture" : "Show Won/Lost/Nurture"}
        </Button>
      </div>

      {/* Kanban board */}
      <div className="overflow-x-auto pb-4 -mx-6 px-6">
        <div className="flex gap-4 w-max">
          {ACTIVE_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={filtered.filter((l) => l.stage === stage)}
              onStageChange={handleStageChange}
            />
          ))}
          {showOther && OTHER_STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              leads={filtered.filter((l) => l.stage === stage)}
              onStageChange={handleStageChange}
            />
          ))}
        </div>
      </div>

      <AddLeadModal open={addOpen} onClose={() => setAddOpen(false)} onCreated={fetchLeads} />
    </div>
  );
}
