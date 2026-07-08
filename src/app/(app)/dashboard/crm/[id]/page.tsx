"use client";

import { use, useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Building2, Globe, Linkedin, Phone, Mail,
  TrendingUp, Send, Lightbulb, FileText, PlusCircle,
  Calendar, CheckCircle2, AlertCircle, Pencil, UserPlus, Trash2, X,
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
import type { Lead, LeadContact, LeadSector, PipelineStage, OutreachEvent, OutreachEventType } from "@/lib/types";

// ─── Constants ────────────────────────────────────────────────────────────────

const STAGE_CONFIG: Partial<Record<PipelineStage, { label: string; color: string; bg: string }>> = {
  identified:    { label: "Identified",    color: "text-zinc-400",    bg: "bg-zinc-500/15" },
  researched:    { label: "Researched",    color: "text-violet-400",  bg: "bg-violet-500/15" },
  qualified:     { label: "Qualified",     color: "text-teal-400",    bg: "bg-teal-500/15" },
  outreach:      { label: "Outreach",      color: "text-blue-400",    bg: "bg-blue-500/15" },
  engaged:       { label: "Engaged",       color: "text-cyan-400",    bg: "bg-cyan-500/15" },
  discovery:     { label: "Discovery",     color: "text-indigo-400",  bg: "bg-indigo-500/15" },
  proposal:      { label: "Proposal",      color: "text-amber-400",   bg: "bg-amber-500/15" },
  evaluation:    { label: "Evaluation",    color: "text-indigo-400",  bg: "bg-indigo-500/15" },
  negotiation:   { label: "Negotiation",   color: "text-orange-400",  bg: "bg-orange-500/15" },
  agreement:     { label: "Agreement",     color: "text-amber-400",   bg: "bg-amber-500/15" },
  won:           { label: "Won",           color: "text-green-400",   bg: "bg-green-500/15" },
  onboarded:     { label: "Onboarded",     color: "text-green-400",   bg: "bg-green-500/15" },
  lost:          { label: "Lost",          color: "text-red-400",     bg: "bg-red-500/15" },
  inactive:      { label: "Inactive",      color: "text-red-400",     bg: "bg-red-500/15" },
  nurture:       { label: "Nurture",       color: "text-purple-400",  bg: "bg-purple-500/15" },
  watchlist:     { label: "Watchlist",     color: "text-purple-400",  bg: "bg-purple-500/15" },
};

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

const LEAD_SECTORS: { value: LeadSector; label: string }[] = [
  { value: "mass-transit",    label: "Mass Transit" },
  { value: "manufacturing",   label: "Manufacturing" },
  { value: "wholesale-trade", label: "Wholesale Trade" },
  { value: "structural",      label: "Structural" },
  { value: "marine",          label: "Marine" },
  { value: "passenger_trade", label: "Passenger / Trade" },
  { value: "dealership",      label: "Dealership" },
  { value: "panel_beater",    label: "Panel Beater / Body Shop" },
  { value: "trade_workshop",  label: "Trade Workshop" },
  { value: "detailing",       label: "Auto Detailing" },
  { value: "other",           label: "Other" },
];

function formatCurrency(n?: number | null) {
  if (!n) return "Not set";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(n);
}

// ─── Editable String List ─────────────────────────────────────────────────────
// Reusable component for pain points, ASI fit, estimated services, tags.

function EditableStringList({ leadId, field, items, placeholder, accentClass, onUpdate, getToken }: {
  leadId: string;
  field: string;
  items: string[];
  placeholder: string;
  accentClass?: string;
  onUpdate: (items: string[]) => void;
  getToken: () => Promise<string>;
}) {
  const { toast } = useToast();
  const [newItem, setNewItem] = useState("");
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [editVal, setEditVal] = useState("");
  const [saving, setSaving] = useState(false);

  const patch = async (updated: string[]) => {
    setSaving(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ [field]: updated }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      onUpdate(updated);
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const add = () => {
    const v = newItem.trim();
    if (!v || saving) return;
    patch([...items, v]);
    setNewItem("");
  };

  const remove = (idx: number) => patch(items.filter((_, i) => i !== idx));

  const commitEdit = (idx: number) => {
    const v = editVal.trim();
    setEditIdx(null);
    if (!v || v === items[idx]) return;
    patch(items.map((item, i) => (i === idx ? v : item)));
  };

  return (
    <div className="space-y-1.5">
      {items.map((item, idx) => (
        <div key={idx} className="flex items-start gap-1 group">
          {editIdx === idx ? (
            <div className="flex flex-1 gap-1">
              <Input
                className="h-7 text-xs flex-1" autoFocus
                value={editVal}
                onChange={(e) => setEditVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitEdit(idx); if (e.key === "Escape") setEditIdx(null); }}
              />
              <button onClick={() => commitEdit(idx)} className="text-primary hover:text-primary/80 p-1"><CheckCircle2 className="h-3.5 w-3.5" /></button>
              <button onClick={() => setEditIdx(null)} className="text-muted-foreground hover:text-foreground p-1"><X className="h-3.5 w-3.5" /></button>
            </div>
          ) : (
            <>
              {accentClass && <span className={`${accentClass} mt-0.5 flex-shrink-0`}>▸</span>}
              <button
                className="text-sm text-muted-foreground flex-1 text-left hover:text-foreground transition-colors"
                onClick={() => { setEditIdx(idx); setEditVal(item); }}
              >
                {item}
              </button>
              <button
                onClick={() => remove(idx)}
                className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-0.5 flex-shrink-0"
              >
                <X className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      ))}
      {items.length === 0 && editIdx === null && (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      )}
      <div className="flex gap-1 pt-1">
        <Input
          className="h-7 text-xs flex-1"
          placeholder={placeholder}
          value={newItem}
          onChange={(e) => setNewItem(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }}
        />
        <Button size="sm" variant="outline" className="h-7 px-2" onClick={add} disabled={!newItem.trim() || saving}>
          <PlusCircle className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ─── Edit Lead Modal ──────────────────────────────────────────────────────────

function EditLeadModal({ lead, open, onClose, onSaved, getToken }: {
  lead: Lead; open: boolean; onClose: () => void;
  onSaved: (updated: Lead) => void; getToken: () => Promise<string>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    companyName: lead.companyName,
    companyWebsite: lead.companyWebsite || "",
    companyLinkedIn: lead.companyLinkedIn || "",
    sector: lead.sector as string,
    companySize: (lead.companySize || "") as string,
    estimatedValue: lead.estimatedValue?.toString() || "",
    isExistingClient: lead.isExistingClient,
    marketMode: lead.marketMode as string,
    nextAction: lead.nextAction || "",
    nextActionDate: lead.nextActionDate || "",
    outreachSequence: lead.outreachSequence || "",
    notes: lead.notes || "",
    bantBudget: lead.bantBreakdown.budget.toString(),
    bantAuthority: lead.bantBreakdown.authority.toString(),
    bantNeed: lead.bantBreakdown.need.toString(),
    bantTiming: lead.bantBreakdown.timing.toString(),
    bantFit: lead.bantBreakdown.fit.toString(),
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

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
      const token = await getToken();
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          companyName: form.companyName,
          companyWebsite: form.companyWebsite || null,
          companyLinkedIn: form.companyLinkedIn || null,
          sector: form.sector,
          companySize: form.companySize || null,
          estimatedValue: form.estimatedValue ? parseFloat(form.estimatedValue) : null,
          isExistingClient: form.isExistingClient,
          marketMode: form.marketMode,
          nextAction: form.nextAction || null,
          nextActionDate: form.nextActionDate || null,
          outreachSequence: form.outreachSequence || null,
          notes: form.notes,
          bantBreakdown,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const updated = await res.json();
      toast({ title: "Lead updated" });
      onSaved(updated as Lead);
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
        <DialogHeader><DialogTitle>Edit Lead</DialogTitle></DialogHeader>
        <div className="space-y-4 pt-2">

          {/* Company */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Company</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1">
                <Label>Organisation Name *</Label>
                <Input value={form.companyName} onChange={(e) => set("companyName", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Sector</Label>
                <Select value={form.sector} onValueChange={(v) => set("sector", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_SECTORS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Company Size</Label>
                <Select value={form.companySize || "unset"} onValueChange={(v) => set("companySize", v === "unset" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unset">Not set</SelectItem>
                    <SelectItem value="smb">SMB</SelectItem>
                    <SelectItem value="mid-market">Mid-Market</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Est. Value (AUD)</Label>
                <Input type="number" value={form.estimatedValue} onChange={(e) => set("estimatedValue", e.target.value)} placeholder="0" />
              </div>
              <div className="space-y-1">
                <Label>Market Mode</Label>
                <Select value={form.marketMode} onValueChange={(v) => set("marketMode", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="neutral">Neutral</SelectItem>
                    <SelectItem value="growth">Growth</SelectItem>
                    <SelectItem value="downturn">Downturn</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Website</Label>
                <Input value={form.companyWebsite} onChange={(e) => set("companyWebsite", e.target.value)} placeholder="https://..." />
              </div>
              <div className="space-y-1">
                <Label>LinkedIn</Label>
                <Input value={form.companyLinkedIn} onChange={(e) => set("companyLinkedIn", e.target.value)} placeholder="https://linkedin.com/..." />
              </div>
              <div className="col-span-2 flex items-center gap-2 pt-1">
                <input type="checkbox" id="isExistingClient" checked={form.isExistingClient}
                  onChange={(e) => set("isExistingClient", e.target.checked)} className="h-3.5 w-3.5 accent-violet-500" />
                <Label htmlFor="isExistingClient" className="cursor-pointer font-normal">Existing client (won deals won't re-add to Contacts)</Label>
              </div>
            </div>
          </div>

          {/* Next Action */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Next Action</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="col-span-2 space-y-1">
                <Label>Action</Label>
                <Input value={form.nextAction} onChange={(e) => set("nextAction", e.target.value)} placeholder="e.g. Follow-up call" />
              </div>
              <div className="space-y-1">
                <Label>Date</Label>
                <Input type="date" value={form.nextActionDate} onChange={(e) => set("nextActionDate", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Outreach Sequence</Label>
                <Select value={form.outreachSequence || "none"} onValueChange={(v) => set("outreachSequence", v === "none" ? "" : v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="A">Sequence A</SelectItem>
                    <SelectItem value="B">Sequence B</SelectItem>
                    <SelectItem value="C">Sequence C</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* BANT */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">BANT Scoring</p>
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
                    value={form[key as keyof typeof form] as string}
                    onChange={(e) => set(key, e.target.value)}
                    className="text-center px-1"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1">
            <Label>Notes</Label>
            <Textarea rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Context, pain points, call notes..." />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.companyName.trim()}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Edit Contact Modal ───────────────────────────────────────────────────────

function EditContactModal({ lead, contact, open, onClose, onSaved, getToken }: {
  lead: Lead; contact: LeadContact; open: boolean; onClose: () => void;
  onSaved: (updated: Lead) => void; getToken: () => Promise<string>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: contact.name,
    title: contact.title || "",
    email: contact.email || "",
    phone: contact.phone || "",
    linkedInUrl: contact.linkedInUrl || "",
    isPrimary: contact.isPrimary,
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const updatedContacts = lead.contacts.map((c) =>
        c.id === contact.id
          ? { ...c, name: form.name, title: form.title || undefined, email: form.email || undefined, phone: form.phone || undefined, linkedInUrl: form.linkedInUrl || undefined, isPrimary: form.isPrimary }
          : form.isPrimary ? { ...c, isPrimary: false } : c
      );
      const token = await getToken();
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contacts: updatedContacts }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Contact updated" });
      onSaved(await res.json() as Lead);
      onClose();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Edit Contact</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Title / Role</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Fleet Manager" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>LinkedIn URL</Label>
            <Input value={form.linkedInUrl} onChange={(e) => set("linkedInUrl", e.target.value)} placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="editIsPrimary" checked={form.isPrimary}
              onChange={(e) => set("isPrimary", e.target.checked)} className="h-3.5 w-3.5 accent-violet-500" />
            <Label htmlFor="editIsPrimary" className="cursor-pointer font-normal">Primary contact</Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Add Contact Modal ────────────────────────────────────────────────────────

function AddContactModal({ lead, open, onClose, onSaved, getToken }: {
  lead: Lead; open: boolean; onClose: () => void;
  onSaved: (updated: Lead) => void; getToken: () => Promise<string>;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", title: "", email: "", phone: "", linkedInUrl: "" });
  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const newContact = {
        id: crypto.randomUUID(), name: form.name,
        title: form.title || undefined, email: form.email || undefined,
        phone: form.phone || undefined, linkedInUrl: form.linkedInUrl || undefined,
        isPrimary: lead.contacts.length === 0,
      };
      const token = await getToken();
      const res = await fetch(`/api/leads/${lead.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ contacts: [...lead.contacts, newContact] }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast({ title: "Contact added" });
      onSaved(await res.json() as Lead);
      onClose();
    } catch (e) {
      toast({ title: "Error", description: e instanceof Error ? e.message : "Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Add Contact</DialogTitle></DialogHeader>
        <div className="space-y-3 pt-2">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Full name" />
          </div>
          <div className="space-y-1">
            <Label>Title / Role</Label>
            <Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Fleet Manager" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Phone</Label>
              <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1">
            <Label>LinkedIn URL</Label>
            <Input value={form.linkedInUrl} onChange={(e) => set("linkedInUrl", e.target.value)} placeholder="https://linkedin.com/in/..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={saving || !form.name.trim()}>
              {saving ? "Adding…" : "Add Contact"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
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
  const [editOpen, setEditOpen] = useState(false);
  const [addContactOpen, setAddContactOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<LeadContact | null>(null);
  const [savingStage, setSavingStage] = useState(false);
  const [intelEdit, setIntelEdit] = useState(false);
  const [intelForm, setIntelForm] = useState({ osintFinding: "", osintHook: "", osintHookShort: "" });
  const [savingIntel, setSavingIntel] = useState(false);

  const getToken = useCallback(async () => {
    if (!firebaseUser) throw new Error("Not signed in");
    return firebaseUser.getIdToken();
  }, [firebaseUser]);

  const handlePatch = useCallback(async (updates: Record<string, unknown>) => {
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLead(await res.json() as Lead);
      return true;
    } catch (e) {
      toast({ title: "Save failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
      return false;
    }
  }, [getToken, id, toast]);

  const fetchLead = useCallback(async () => {
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
  }, [getToken, id, router, toast]);

  useEffect(() => { if (firebaseUser) fetchLead(); }, [firebaseUser, fetchLead]);

  const handleDeleteLead = async () => {
    if (!window.confirm("Permanently remove this lead?")) return;
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error();
      toast({ title: "Lead removed" });
      router.push("/dashboard/crm");
    } catch {
      toast({ title: "Failed to remove lead", variant: "destructive" });
    }
  };

  const handleDeleteContact = async (contactId: string) => {
    if (!lead) return;
    if (!window.confirm("Remove this contact?")) return;
    await handlePatch({ contacts: lead.contacts.filter((c) => c.id !== contactId) });
  };

  const handleDeleteOutreachEvent = async (eventId: string) => {
    if (!lead) return;
    await handlePatch({ outreachHistory: (lead.outreachHistory || []).filter((e) => e.id !== eventId) });
  };

  const handleToggleOutreachStatus = async (field: string, current: boolean | number) => {
    if (!lead) return;
    await handlePatch({ outreachStatus: { ...lead.outreachStatus, [field]: typeof current === "boolean" ? !current : current } });
  };

  const handleSaveIntel = async () => {
    if (!lead) return;
    setSavingIntel(true);
    const ok = await handlePatch({
      osintHook: intelForm.osintHook || null,
      osintHookShort: intelForm.osintHookShort || null,
      source: { ...lead.source, osintFinding: intelForm.osintFinding || undefined },
    });
    setSavingIntel(false);
    if (ok) setIntelEdit(false);
  };

  const handleStageChange = async (stage: PipelineStage) => {
    setSavingStage(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/leads/${id}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ stage }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed");
      setLead((l) => l ? { ...l, stage } : l);
      toast({ title: `Stage → ${STAGE_CONFIG[stage]?.label || stage}` });
    } catch (e) {
      toast({ title: "Failed to update stage", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSavingStage(false);
    }
  };

  if (loading) return <div className="p-6 animate-pulse space-y-4"><div className="h-8 w-64 bg-card/50 rounded" /><div className="h-64 bg-card/50 rounded-xl" /></div>;
  if (!lead) return null;

  const stageCfg = STAGE_CONFIG[lead.stage] || { label: lead.stage, color: "text-zinc-400", bg: "bg-zinc-500/15" };
  const gradeCfg = GRADE_CONFIG[lead.leadGrade];
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
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit Lead
          </Button>
          <Button variant="outline" size="sm" className="border-red-500/40 text-red-400 hover:bg-red-500/10 hover:text-red-300" onClick={handleDeleteLead}>
            <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete
          </Button>
          <Select onValueChange={handleStageChange} disabled={savingStage}>
            <SelectTrigger className="w-44 bg-card/50 border-border/30">
              <SelectValue placeholder="Change stage…" />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(STAGE_CONFIG) as PipelineStage[]).map((s) => (
                <SelectItem key={s} value={s}>{STAGE_CONFIG[s]?.label || s}</SelectItem>
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
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><Building2 className="h-4 w-4 text-primary" />Company</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Sector</span><span className="capitalize">{lead.sector.replace(/-|_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span className="capitalize">{lead.companySize || "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Client?</span><span>{lead.isExistingClient ? "Existing client" : "New prospect"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Est. Value</span><span className="font-medium">{formatCurrency(lead.estimatedValue)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Market mode</span><span className="capitalize">{lead.marketMode}</span></div>
                <div className="flex gap-2 pt-1">
                  {lead.companyWebsite && <a href={lead.companyWebsite} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary"><Globe className="h-4 w-4" /></a>}
                  {lead.companyLinkedIn && <a href={lead.companyLinkedIn} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary"><Linkedin className="h-4 w-4" /></a>}
                </div>
              </CardContent>
            </Card>

            {/* Contacts */}
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><Mail className="h-4 w-4 text-blue-400" />Contacts</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setAddContactOpen(true)}>
                    <UserPlus className="h-3 w-3 mr-1" /> Add
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {lead.contacts.length === 0 ? (
                  <p className="text-muted-foreground">No contacts added.</p>
                ) : (
                  lead.contacts.map((contact, idx) => (
                    <div key={contact.id} className="group">
                      {idx > 0 && <div className="border-t border-border/30 mb-3" />}
                      <div className="flex items-start justify-between gap-1">
                        <div className="min-w-0">
                          {contact.isPrimary && lead.contacts.length > 1 && (
                            <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Primary</p>
                          )}
                          <p className="font-medium truncate">{contact.name}</p>
                        </div>
                        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => setEditingContact(contact)} className="p-1 rounded text-muted-foreground hover:text-primary hover:bg-primary/10">
                            <Pencil className="h-3 w-3" />
                          </button>
                          <button onClick={() => handleDeleteContact(contact.id)} className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                      {contact.title && <p className="text-muted-foreground text-xs">{contact.title}</p>}
                      {contact.email && (
                        <a href={`mailto:${contact.email}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                          <Mail className="h-3.5 w-3.5" />{contact.email}
                        </a>
                      )}
                      {contact.phone && (
                        <a href={`tel:${contact.phone}`} className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                          <Phone className="h-3.5 w-3.5" />{contact.phone}
                        </a>
                      )}
                      {contact.linkedInUrl && (
                        <a href={contact.linkedInUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-muted-foreground hover:text-primary">
                          <Linkedin className="h-3.5 w-3.5" />LinkedIn
                        </a>
                      )}
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Next Action */}
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span className="flex items-center gap-2"><Calendar className="h-4 w-4 text-amber-400" />Next Action</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {lead.nextAction
                  ? <p className="font-medium">{lead.nextAction}</p>
                  : <p className="text-muted-foreground italic">No action set — click Edit.</p>}
                {lead.nextActionDate && <p className="text-muted-foreground">{lead.nextActionDate}</p>}
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground mb-1">Outreach sequence</p>
                  <p className="font-medium">{lead.outreachSequence ? `Sequence ${lead.outreachSequence}` : "Not set"}</p>
                </div>
                {/* Tags — inline editable */}
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground mb-2">Tags</p>
                  <EditableStringList
                    leadId={id}
                    field="tags"
                    items={lead.tags}
                    placeholder="Add tag…"
                    onUpdate={(items) => setLead((l) => l ? { ...l, tags: items } : l)}
                    getToken={getToken}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* BANT */}
          <Card className="bg-card/50 border-border/20">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><TrendingUp className="h-4 w-4 text-primary" />BANT Score</span>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold">{lead.bantScore}<span className="text-sm font-normal text-muted-foreground">/100</span></span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditOpen(true)}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                </div>
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

          {/* Pain Points + ASI Fit */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><AlertCircle className="h-4 w-4 text-red-400" />Pain Points</CardTitle>
              </CardHeader>
              <CardContent>
                <EditableStringList
                  leadId={id}
                  field="painPoints"
                  items={lead.painPoints}
                  placeholder="Add pain point…"
                  accentClass="text-red-400"
                  onUpdate={(items) => setLead((l) => l ? { ...l, painPoints: items } : l)}
                  getToken={getToken}
                />
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/20">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" />ASI Solution Fit</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <EditableStringList
                  leadId={id}
                  field="asiSolutionFit"
                  items={lead.asiSolutionFit}
                  placeholder="Add solution fit…"
                  accentClass="text-emerald-400"
                  onUpdate={(items) => setLead((l) => l ? { ...l, asiSolutionFit: items } : l)}
                  getToken={getToken}
                />
                <div className="pt-2 border-t border-border/30">
                  <p className="text-xs text-muted-foreground mb-2">Estimated Services</p>
                  <EditableStringList
                    leadId={id}
                    field="estimatedServices"
                    items={lead.estimatedServices}
                    placeholder="Add service…"
                    onUpdate={(items) => setLead((l) => l ? { ...l, estimatedServices: items } : l)}
                    getToken={getToken}
                  />
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Outreach ── */}
        <TabsContent value="outreach" className="space-y-4 mt-4">
          {/* Status tiles — interactive */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Emails sent — number input */}
            <div className="bg-card/50 border border-border/30 rounded-xl p-3 text-center space-y-1.5">
              <Input
                type="number" min={0}
                defaultValue={lead.outreachStatus?.emailsSent || 0}
                className="text-center text-lg font-bold h-8 bg-transparent border-0 px-1"
                onBlur={(e) => {
                  const v = parseInt(e.target.value) || 0;
                  if (v !== (lead.outreachStatus?.emailsSent || 0)) {
                    handlePatch({ outreachStatus: { ...lead.outreachStatus, emailsSent: v } });
                  }
                }}
              />
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Emails sent</p>
            </div>
            {/* Toggle tiles */}
            {([
              { field: "linkedInConnected",  label: "LinkedIn connected" },
              { field: "responseReceived",   label: "Response received" },
              { field: "meetingScheduled",   label: "Meeting scheduled" },
            ] as { field: keyof typeof lead.outreachStatus; label: string }[]).map(({ field, label }) => {
              const val = !!lead.outreachStatus?.[field];
              return (
                <button
                  key={field}
                  onClick={() => handleToggleOutreachStatus(field, val)}
                  className={`border rounded-xl p-3 text-center transition-colors ${
                    val
                      ? "bg-emerald-500/10 border-emerald-500/40 hover:bg-emerald-500/20"
                      : "bg-card/50 border-border/30 hover:bg-card/80"
                  }`}
                >
                  <p className={`text-lg font-bold ${val ? "text-emerald-400" : "text-foreground"}`}>{val ? "Yes" : "No"}</p>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">{label}</p>
                </button>
              );
            })}
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
                <div key={ev.id} className="bg-card/50 border border-border/30 rounded-xl p-4 group relative">
                  <button
                    onClick={() => handleDeleteOutreachEvent(ev.id)}
                    className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-red-400 p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                  <div className="flex items-center gap-2 mb-2 pr-8">
                    <Send className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                    <span className="text-sm font-medium">{OUTREACH_EVENT_LABELS[ev.type]}</span>
                    {ev.subject && <span className="text-sm text-muted-foreground">— {ev.subject}</span>}
                    <span className="ml-auto text-xs text-muted-foreground flex-shrink-0">{ev.date}</span>
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
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-400" />Source & Intel</span>
                {!intelEdit && (
                  <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => {
                    setIntelForm({
                      osintFinding: lead.source.osintFinding || "",
                      osintHook: lead.osintHook || "",
                      osintHookShort: lead.osintHookShort || "",
                    });
                    setIntelEdit(true);
                  }}>
                    <Pencil className="h-3 w-3 mr-1" /> Edit
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{lead.source.type}</span></div>
              {lead.source.osintScanDate && <div className="flex justify-between"><span className="text-muted-foreground">OSINT scan</span><span>{lead.source.osintScanDate}</span></div>}
              {lead.source.osintPillar && <div className="flex justify-between"><span className="text-muted-foreground">Pillar</span><span className="capitalize">{lead.source.osintPillar.replace("-", " ")}</span></div>}
              {lead.source.osintRelevanceScore && <div className="flex justify-between"><span className="text-muted-foreground">Relevance score</span><span>{lead.source.osintRelevanceScore}/5</span></div>}
              {lead.source.referralSource && <div className="flex justify-between"><span className="text-muted-foreground">Referral</span><span>{lead.source.referralSource}</span></div>}
              {lead.source.tenderReference && <div className="flex justify-between"><span className="text-muted-foreground">Tender ref</span><span>{lead.source.tenderReference}</span></div>}

              {intelEdit ? (
                <div className="space-y-3 pt-2 border-t border-border/30">
                  <div className="space-y-1">
                    <Label>OSINT Finding</Label>
                    <Textarea rows={3} value={intelForm.osintFinding}
                      onChange={(e) => setIntelForm((f) => ({ ...f, osintFinding: e.target.value }))}
                      placeholder="What triggered this lead?" />
                  </div>
                  <div className="space-y-1">
                    <Label>Outreach Hook (long)</Label>
                    <Textarea rows={2} value={intelForm.osintHook}
                      onChange={(e) => setIntelForm((f) => ({ ...f, osintHook: e.target.value }))}
                      placeholder="Full outreach hook sentence…" />
                  </div>
                  <div className="space-y-1">
                    <Label>Hook (short / subject line, ≤160 chars)</Label>
                    <Input value={intelForm.osintHookShort}
                      onChange={(e) => setIntelForm((f) => ({ ...f, osintHookShort: e.target.value.slice(0, 160) }))}
                      placeholder="Short hook for subject line…" />
                    <p className="text-[10px] text-muted-foreground">{intelForm.osintHookShort.length}/160</p>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => setIntelEdit(false)}>Cancel</Button>
                    <Button size="sm" onClick={handleSaveIntel} disabled={savingIntel}>
                      {savingIntel ? "Saving…" : "Save Intel"}
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  {lead.source.osintFinding && (
                    <div className="mt-2 p-3 bg-primary/5 border border-primary/15 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">OSINT Finding</p>
                      <p className="text-sm">{lead.source.osintFinding}</p>
                    </div>
                  )}
                  {lead.osintHook && (
                    <div className="p-3 bg-amber-500/5 border border-amber-500/15 rounded-lg">
                      <p className="text-xs text-muted-foreground mb-1">Outreach Hook</p>
                      <p className="text-sm">{lead.osintHook}</p>
                      {lead.osintHookShort && <p className="text-xs text-amber-400 mt-1 font-medium">"{lead.osintHookShort}"</p>}
                    </div>
                  )}
                </>
              )}
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
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center justify-between">
                <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-muted-foreground" />Notes</span>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => setEditOpen(true)}>
                  <Pencil className="h-3 w-3 mr-1" /> Edit
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {lead.notes
                ? <p className="text-sm text-muted-foreground whitespace-pre-wrap">{lead.notes}</p>
                : <p className="text-sm text-muted-foreground italic">No notes yet — click Edit to add them.</p>}
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
                      <span>{STAGE_CONFIG[h.fromStage]?.label || h.fromStage}</span>
                      <span className="text-muted-foreground">→</span>
                      <span className={STAGE_CONFIG[h.toStage]?.color}>{STAGE_CONFIG[h.toStage]?.label || h.toStage}</span>
                      {h.reason && <span className="text-muted-foreground">· {h.reason}</span>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Modals */}
      <LogOutreachModal leadId={id} open={logOpen} onClose={() => setLogOpen(false)} onLogged={fetchLead} getToken={getToken} />
      <EditLeadModal lead={lead} open={editOpen} onClose={() => setEditOpen(false)} onSaved={setLead} getToken={getToken} />
      <AddContactModal lead={lead} open={addContactOpen} onClose={() => setAddContactOpen(false)} onSaved={setLead} getToken={getToken} />
      {editingContact && (
        <EditContactModal
          lead={lead}
          contact={editingContact}
          open={!!editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={(updated) => { setLead(updated); setEditingContact(null); }}
          getToken={getToken}
        />
      )}
    </div>
  );
}
