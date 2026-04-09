/**
 * ApprovalModal — Director-only approval dialog for IMS documents.
 * Captures effectiveDate + reviewDueDate and routes the approval action
 * through the canonical document service (never directly to Firestore).
 */

"use client";

import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import {
  approveDocument,
  type NormalisedDoc,
  type TransitionActor,
} from "@/lib/ims/documentService";

interface Props {
  doc: NormalisedDoc;
  actor: TransitionActor;
  open: boolean;
  onClose: () => void;
  onApproved?: () => void;
}

function addYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().split("T")[0];
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export function ApprovalModal({ doc, actor, open, onClose, onApproved }: Props) {
  const { toast } = useToast();
  const defaultEffective = today();
  const [effectiveDate, setEffectiveDate] = useState(defaultEffective);
  const [reviewDueDate, setReviewDueDate] = useState(addYears(defaultEffective, 1));
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await approveDocument(doc.id, actor, effectiveDate, reviewDueDate);
      toast({
        title: "Document approved",
        description: `${doc.docId} is now approved. Effective ${effectiveDate}.`,
      });
      if (onApproved) onApproved();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Approval failed.";
      toast({ title: "Approval failed", description: message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve {doc.docId}</DialogTitle>
          <DialogDescription>
            {doc.title}
            <br />
            <span className="text-xs text-muted-foreground">
              Set the effective date and next review date for this controlled document.
              This action is permanent and will be logged in the revision history.
            </span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="effective-date">Effective Date</Label>
            <Input
              id="effective-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => {
                const next = e.target.value;
                setEffectiveDate(next);
                // Auto-advance review date by one year
                if (next) setReviewDueDate(addYears(next, 1));
              }}
              min={today()}
            />
            <p className="text-xs text-muted-foreground">
              When this document becomes the active version.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="review-due-date">Next Review Date</Label>
            <Input
              id="review-due-date"
              type="date"
              value={reviewDueDate}
              onChange={(e) => setReviewDueDate(e.target.value)}
              min={effectiveDate}
            />
            <p className="text-xs text-muted-foreground">
              Default is 12 months from effective. Adjust if policy requires sooner.
            </p>
          </div>

          <div className="rounded-md bg-amber-500/10 border border-amber-500/20 p-3 text-xs text-amber-200">
            <strong>Director lock:</strong> This approval will be recorded under
            your name ({actor.email}). Only the Director can approve IMS
            documents.
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !effectiveDate || !reviewDueDate}>
            {submitting ? "Approving…" : "Approve Document"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
