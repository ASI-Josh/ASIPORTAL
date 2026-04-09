/**
 * ScheduleAuditModal — Director/GUARDIAN schedule a future IMS audit.
 *
 * Creates an imsAudits record with metadata.status = "scheduled". The audit
 * pack (plan, checklist, findings) is generated later by GUARDIAN or at the
 * audit execution time via create_ims_audit / update_ims_audit MCP tools.
 *
 * Optionally creates a Google Calendar event for the audit date.
 */

"use client";

import { useState } from "react";
import { Timestamp, addDoc, collection } from "firebase/firestore";
import { CalendarCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled?: (auditDocId: string) => void;
  actor: { uid: string; email: string; name: string };
  defaultDate?: string; // YYYY-MM-DD — used when scheduling from a specific month slot
}

type Standard = "ISO9001:2015" | "ISO14001:2015" | "ISO45001:2018" | "Integrated";
type AuditType = "internal" | "external" | "supplier" | "management_review";

export function ScheduleAuditModal({
  open,
  onClose,
  onScheduled,
  actor,
  defaultDate,
}: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const [plannedDate, setPlannedDate] = useState(defaultDate || today);
  const [standard, setStandard] = useState<Standard>("Integrated");
  const [auditType, setAuditType] = useState<AuditType>("internal");
  const [scope, setScope] = useState("");
  const [processes, setProcesses] = useState("");
  const [sites, setSites] = useState("Melbourne workshop");
  const [leadAuditor, setLeadAuditor] = useState("GUARDIAN");

  const generateAuditId = () => {
    const d = new Date(plannedDate);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const rand = Math.floor(Math.random() * 900 + 100);
    return `AUD-${year}-${month}-${rand}`;
  };

  const handleSchedule = async () => {
    if (!plannedDate || !scope.trim() || !leadAuditor.trim()) {
      toast({
        title: "Missing required fields",
        description: "plannedDate, scope, and leadAuditor are all required.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const auditId = generateAuditId();
      const year = new Date(plannedDate).getFullYear();
      const nowIso = new Date().toISOString();

      // Write directly to Firestore matching the MCP schedule_ims_audit
      // schema so agents and UI see identical records.
      const payload = {
        metadata: {
          auditId,
          standard,
          auditType,
          scope: scope.trim(),
          period: `${year}`,
          sites: sites.split(",").map((s) => s.trim()).filter(Boolean),
          processes: processes.split(",").map((p) => p.trim()).filter(Boolean),
          leadAuditor: leadAuditor.trim(),
          auditDate: plannedDate,
          plannedDate,
          status: "scheduled" as const,
          scheduledBy: `${actor.name} (${actor.email})`,
          scheduledAt: nowIso,
          calendarEventId: null as string | null,
        },
        plan: { objectives: [], criteria: [], methods: [], schedule: [] },
        checklist: [],
        findings: [],
        summary: { strengths: [], risks: [], overallConclusion: "" },
        questions: [],
        source: "manual" as const,
        createdAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
        createdById: actor.uid,
        createdByName: actor.name,
        createdByEmail: actor.email,
      };

      const ref = await addDoc(collection(db, COLLECTIONS.IMS_AUDITS), payload);

      toast({
        title: "Audit scheduled",
        description: `${auditId} scheduled for ${plannedDate}.`,
      });

      if (onScheduled) onScheduled(ref.id);
      onClose();

      // Reset form
      setPlannedDate(today);
      setScope("");
      setProcesses("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Scheduling failed.";
      toast({ title: "Scheduling failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="h-5 w-5 text-primary" />
            Schedule Internal Audit
          </DialogTitle>
          <DialogDescription>
            Book a future IMS audit. The audit pack (plan, checklist, findings) can be generated closer to the execution date via GUARDIAN.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="audit-date">Planned Date</Label>
              <Input
                id="audit-date"
                type="date"
                value={plannedDate}
                onChange={(e) => setPlannedDate(e.target.value)}
                min={today}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="audit-type">Audit Type</Label>
              <Select value={auditType} onValueChange={(v) => setAuditType(v as AuditType)}>
                <SelectTrigger id="audit-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="internal">Internal Audit</SelectItem>
                  <SelectItem value="external">External Audit</SelectItem>
                  <SelectItem value="supplier">Supplier Audit</SelectItem>
                  <SelectItem value="management_review">Management Review</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-standard">Standard</Label>
            <Select value={standard} onValueChange={(v) => setStandard(v as Standard)}>
              <SelectTrigger id="audit-standard">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Integrated">Integrated (9001 + 14001 + 45001)</SelectItem>
                <SelectItem value="ISO9001:2015">ISO 9001:2015 (Quality)</SelectItem>
                <SelectItem value="ISO14001:2015">ISO 14001:2015 (Environmental)</SelectItem>
                <SelectItem value="ISO45001:2018">ISO 45001:2018 (WHS)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-scope">Audit Scope</Label>
            <Textarea
              id="audit-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              placeholder="e.g. Document control, training records, internal audit process — all ISO 9001 clause 7.5 requirements"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-processes">Processes in scope (comma-separated)</Label>
            <Input
              id="audit-processes"
              value={processes}
              onChange={(e) => setProcesses(e.target.value)}
              placeholder="e.g. Doc control, Training, Internal audit"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-sites">Sites (comma-separated)</Label>
            <Input
              id="audit-sites"
              value={sites}
              onChange={(e) => setSites(e.target.value)}
              placeholder="e.g. Melbourne workshop, customer sites"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="audit-lead">Lead Auditor</Label>
            <Input
              id="audit-lead"
              value={leadAuditor}
              onChange={(e) => setLeadAuditor(e.target.value)}
              placeholder="e.g. GUARDIAN, Joshua Hyde, external auditor name"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSchedule} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Scheduling…
              </>
            ) : (
              <>
                <CalendarCheck className="h-4 w-4 mr-2" />
                Schedule Audit
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
