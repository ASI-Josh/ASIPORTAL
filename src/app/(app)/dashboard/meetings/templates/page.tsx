"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { db } from "@/lib/firebaseClient";
import {
  collection,
  query,
  orderBy,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  Timestamp,
} from "firebase/firestore";
import { COLLECTIONS } from "@/lib/collections";
import type { MeetingTemplate, MeetingType, AgendaItem } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Plus, Trash2, Edit2, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<MeetingType, string> = {
  management_review: "Management Review",
  startup: "Startup",
  whs_committee: "WHS Committee",
  department: "Department",
  project: "Project",
  incident_review: "Incident Review",
  custom: "Custom",
};

const TYPE_BADGE_COLORS: Record<MeetingType, string> = {
  management_review: "bg-[#8000FF]/15 text-[#8000FF] border-[#8000FF]/30",
  startup: "bg-[#0080FF]/15 text-[#0080FF] border-[#0080FF]/30",
  whs_committee: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  department: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  project: "bg-[#00C853]/15 text-[#00C853] border-[#00C853]/30",
  incident_review: "bg-red-500/15 text-red-400 border-red-500/30",
  custom: "bg-gray-600/30 text-gray-300 border-gray-500/40",
};

const AGENDA_ITEM_TYPES = [
  { value: "discussion", label: "Discussion" },
  { value: "decision", label: "Decision" },
  { value: "information", label: "Information" },
  { value: "agent_report", label: "Agent Report" },
  { value: "action_review", label: "Action Review" },
] as const;

interface AgendaFormItem {
  id: string;
  title: string;
  type: AgendaItem["type"];
  presenter: string;
  duration: number;
}

function emptyAgendaItem(): AgendaFormItem {
  return {
    id: crypto.randomUUID(),
    title: "",
    type: "discussion",
    presenter: "",
    duration: 10,
  };
}

export default function MeetingTemplatesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [templates, setTemplates] = useState<MeetingTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [meetingType, setMeetingType] = useState<MeetingType>("management_review");
  const [defaultDuration, setDefaultDuration] = useState(60);
  const [isoClause, setIsoClause] = useState("");
  const [agendaItems, setAgendaItems] = useState<AgendaFormItem[]>([emptyAgendaItem()]);
  const [saving, setSaving] = useState(false);

  // Real-time subscription
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.MEETING_TEMPLATES),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setTemplates(
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MeetingTemplate, "id">) }))
      );
      setLoading(false);
    });
    return unsub;
  }, []);

  const isAdmin = user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="text-center">
          <FileText className="h-12 w-12 text-gray-500 mx-auto mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">Access Denied</h2>
          <p className="text-gray-400">You do not have permission to manage meeting templates.</p>
        </div>
      </div>
    );
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setMeetingType("management_review");
    setDefaultDuration(60);
    setIsoClause("");
    setAgendaItems([emptyAgendaItem()]);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(template: MeetingTemplate) {
    setEditingId(template.id);
    setName(template.name);
    setMeetingType(template.meetingType);
    setDefaultDuration(template.defaultDuration);
    setIsoClause(template.isoClause || "");
    setAgendaItems(
      template.agendaTemplate.length > 0
        ? template.agendaTemplate.map((a) => ({
            id: a.id,
            title: a.title,
            type: a.type,
            presenter: a.presenter || "",
            duration: a.duration || 10,
          }))
        : [emptyAgendaItem()]
    );
    setDialogOpen(true);
  }

  function addAgendaItem() {
    setAgendaItems((prev) => [...prev, emptyAgendaItem()]);
  }

  function removeAgendaItem(id: string) {
    setAgendaItems((prev) => prev.filter((a) => a.id !== id));
  }

  function updateAgendaItem(id: string, field: keyof AgendaFormItem, value: string | number) {
    setAgendaItems((prev) =>
      prev.map((a) => (a.id === id ? { ...a, [field]: value } : a))
    );
  }

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Validation Error", description: "Template name is required.", variant: "destructive" });
      return;
    }

    const validItems = agendaItems.filter((a) => a.title.trim());
    if (validItems.length === 0) {
      toast({ title: "Validation Error", description: "At least one agenda item is required.", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const id = editingId || doc(collection(db, COLLECTIONS.MEETING_TEMPLATES)).id;
      const now = Timestamp.now();

      const agendaTemplate: AgendaItem[] = validItems.map((a, idx) => ({
        id: a.id,
        order: idx + 1,
        title: a.title.trim(),
        type: a.type,
        presenter: a.presenter.trim() || undefined,
        duration: a.duration,
        status: "pending" as const,
      }));

      const data: Record<string, unknown> = {
        name: name.trim(),
        meetingType,
        defaultDuration,
        agendaTemplate,
        updatedAt: now,
      };

      if (isoClause.trim()) {
        data.isoClause = isoClause.trim();
      }

      if (!editingId) {
        data.createdAt = now;
        data.createdBy = user?.uid || "";
      }

      await setDoc(doc(db, COLLECTIONS.MEETING_TEMPLATES, id), data, { merge: true });

      toast({
        title: editingId ? "Template Updated" : "Template Created",
        description: `"${name.trim()}" has been ${editingId ? "updated" : "created"}.`,
      });

      setDialogOpen(false);
      resetForm();
    } catch (err) {
      console.error("Error saving template:", err);
      toast({ title: "Error", description: "Failed to save template.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(template: MeetingTemplate) {
    if (!confirm(`Delete template "${template.name}"? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, COLLECTIONS.MEETING_TEMPLATES, template.id));
      toast({ title: "Template Deleted", description: `"${template.name}" has been removed.` });
    } catch (err) {
      console.error("Error deleting template:", err);
      toast({ title: "Error", description: "Failed to delete template.", variant: "destructive" });
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#8000FF] border-t-transparent" />
        <span className="ml-3 text-gray-400">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white font-['Space_Grotesk']">
            Meeting Templates
          </h1>
          <p className="text-sm text-gray-400 mt-1">
            Create and manage reusable agenda templates for meetings
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) resetForm(); setDialogOpen(open); }}>
          <DialogTrigger asChild>
            <Button
              className="bg-[#8000FF] hover:bg-[#8000FF]/80 text-white"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </DialogTrigger>

          <DialogContent className="bg-[#1e1e2e] border-white/10 text-white max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-white font-['Space_Grotesk']">
                {editingId ? "Edit Template" : "New Template"}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 mt-4">
              {/* Name */}
              <div className="space-y-1.5">
                <Label className="text-gray-300">Template Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Monthly Management Review"
                  className="bg-[#262633] border-white/10 text-white placeholder:text-gray-500"
                />
              </div>

              {/* Meeting Type */}
              <div className="space-y-1.5">
                <Label className="text-gray-300">Meeting Type</Label>
                <Select value={meetingType} onValueChange={(v) => setMeetingType(v as MeetingType)}>
                  <SelectTrigger className="bg-[#262633] border-white/10 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-[#1e1e2e] border-white/10">
                    {(Object.keys(TYPE_LABELS) as MeetingType[]).map((t) => (
                      <SelectItem key={t} value={t} className="text-white hover:bg-white/5">
                        {TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Duration + ISO Clause */}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label className="text-gray-300">Default Duration (min)</Label>
                  <Input
                    type="number"
                    min={5}
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(Number(e.target.value))}
                    className="bg-[#262633] border-white/10 text-white"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-gray-300">ISO Clause (optional)</Label>
                  <Input
                    value={isoClause}
                    onChange={(e) => setIsoClause(e.target.value)}
                    placeholder="e.g. 9.3"
                    className="bg-[#262633] border-white/10 text-white placeholder:text-gray-500"
                  />
                </div>
              </div>

              {/* Agenda Items */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-gray-300">Agenda Items</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addAgendaItem}
                    className="text-[#8000FF] hover:text-[#8000FF]/80 hover:bg-[#8000FF]/10"
                  >
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Add Item
                  </Button>
                </div>

                <div className="space-y-2">
                  {agendaItems.map((item, idx) => (
                    <div
                      key={item.id}
                      className="grid grid-cols-[1fr_140px_120px_60px_32px] gap-2 items-end"
                    >
                      <div className="space-y-1">
                        {idx === 0 && <span className="text-xs text-gray-500">Title</span>}
                        <Input
                          value={item.title}
                          onChange={(e) => updateAgendaItem(item.id, "title", e.target.value)}
                          placeholder="Agenda item title"
                          className="bg-[#262633] border-white/10 text-white placeholder:text-gray-500 h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && <span className="text-xs text-gray-500">Type</span>}
                        <Select
                          value={item.type}
                          onValueChange={(v) => updateAgendaItem(item.id, "type", v)}
                        >
                          <SelectTrigger className="bg-[#262633] border-white/10 text-white h-9 text-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="bg-[#1e1e2e] border-white/10">
                            {AGENDA_ITEM_TYPES.map((t) => (
                              <SelectItem key={t.value} value={t.value} className="text-white hover:bg-white/5 text-sm">
                                {t.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && <span className="text-xs text-gray-500">Presenter</span>}
                        <Input
                          value={item.presenter}
                          onChange={(e) => updateAgendaItem(item.id, "presenter", e.target.value)}
                          placeholder="Presenter"
                          className="bg-[#262633] border-white/10 text-white placeholder:text-gray-500 h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && <span className="text-xs text-gray-500">Min</span>}
                        <Input
                          type="number"
                          min={1}
                          value={item.duration}
                          onChange={(e) => updateAgendaItem(item.id, "duration", Number(e.target.value))}
                          className="bg-[#262633] border-white/10 text-white h-9 text-sm"
                        />
                      </div>
                      <div className="space-y-1">
                        {idx === 0 && <span className="text-xs text-gray-500">&nbsp;</span>}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeAgendaItem(item.id)}
                          disabled={agendaItems.length === 1}
                          className="h-9 w-9 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Save */}
              <div className="flex justify-end gap-2 pt-2">
                <Button
                  variant="ghost"
                  onClick={() => { setDialogOpen(false); resetForm(); }}
                  className="text-gray-400 hover:text-white hover:bg-white/5"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={saving}
                  className="bg-[#8000FF] hover:bg-[#8000FF]/80 text-white"
                >
                  {saving ? "Saving..." : editingId ? "Update Template" : "Create Template"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Templates Grid */}
      {templates.length === 0 ? (
        <Card className="bg-[#262633]/80 border-white/10 backdrop-blur">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <FileText className="h-12 w-12 text-gray-500 mb-4" />
            <p className="text-gray-400 text-lg mb-2">No templates yet</p>
            <p className="text-gray-500 text-sm mb-4">
              Create your first meeting template to streamline agenda creation.
            </p>
            <Button
              className="bg-[#8000FF] hover:bg-[#8000FF]/80 text-white"
              onClick={openCreate}
            >
              <Plus className="h-4 w-4 mr-2" />
              New Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card
              key={template.id}
              className="bg-[#262633]/80 border-white/10 backdrop-blur hover:border-[#8000FF]/30 transition-colors"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <CardTitle className="text-white text-lg font-['Space_Grotesk'] leading-tight">
                    {template.name}
                  </CardTitle>
                  <div className="flex gap-1 ml-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEdit(template)}
                      className="h-8 w-8 text-gray-400 hover:text-white hover:bg-white/5"
                    >
                      <Edit2 className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDelete(template)}
                      className="h-8 w-8 text-gray-400 hover:text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Badge
                    variant="outline"
                    className={cn("text-xs", TYPE_BADGE_COLORS[template.meetingType])}
                  >
                    {TYPE_LABELS[template.meetingType]}
                  </Badge>
                  {template.isoClause && (
                    <Badge variant="outline" className="text-xs bg-white/5 text-gray-300 border-white/10">
                      ISO {template.isoClause}
                    </Badge>
                  )}
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Duration</span>
                  <span className="text-white">{template.defaultDuration} min</span>
                </div>

                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Agenda Items</span>
                  <span className="text-white">{template.agendaTemplate?.length || 0}</span>
                </div>

                {template.agendaTemplate && template.agendaTemplate.length > 0 && (
                  <div className="pt-2 border-t border-white/5">
                    <ul className="space-y-1">
                      {template.agendaTemplate.slice(0, 4).map((item, idx) => (
                        <li key={item.id} className="text-xs text-gray-400 flex items-center gap-2">
                          <span className="text-gray-500 w-4 text-right shrink-0">{idx + 1}.</span>
                          <span className="truncate">{item.title}</span>
                        </li>
                      ))}
                      {template.agendaTemplate.length > 4 && (
                        <li className="text-xs text-gray-500 pl-6">
                          +{template.agendaTemplate.length - 4} more
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
