"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { AlertTriangle, ArrowLeft, CheckCircle, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { IncidentAttachmentsCard } from "@/components/ims/incidents/incident-attachments-card";
import { IncidentCorrectiveActionsCard } from "@/components/ims/incidents/incident-corrective-actions-card";
import { IncidentDescriptionCard } from "@/components/ims/incidents/incident-description-card";
import { IncidentDetailsCard } from "@/components/ims/incidents/incident-details-card";
import { IncidentHazardsCard } from "@/components/ims/incidents/incident-hazards-card";
import { IncidentInvestigationCard } from "@/components/ims/incidents/incident-investigation-card";
import {
  incidentStatusBadge,
  mapIncidentCategoryToDomain,
  mergeHazards,
} from "@/lib/ims/incidents";
import { useAuth } from "@/contexts/AuthContext";
import { useJobs } from "@/contexts/JobsContext";
import { useToast } from "@/hooks/use-toast";
import { COLLECTIONS } from "@/lib/collections";
import { db, storage } from "@/lib/firebaseClient";
import type { ImsIncident, ImsIncidentAttachment, ImsRiskRegisterEntry } from "@/lib/types";

export default function IncidentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { jobs } = useJobs();
  const { toast } = useToast();

  const incidentId = params.id as string;
  const [draft, setDraft] = useState<ImsIncident | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  useEffect(() => {
    const refDoc = doc(db, COLLECTIONS.IMS_INCIDENTS, incidentId);
    const unsubscribe = onSnapshot(refDoc, (snap) => {
      if (!snap.exists()) {
        setDraft(null);
        return;
      }
      const loaded = { id: snap.id, ...(snap.data() as Omit<ImsIncident, "id">) };
      const normalized: ImsIncident = {
        ...loaded,
        hazards: mergeHazards(loaded.hazards),
        description: loaded.description || "",
        immediateActions: loaded.immediateActions || "",
        investigation: {
          ...(loaded.investigation || {}),
          correctiveActions: loaded.investigation?.correctiveActions || [],
        },
        attachments: loaded.attachments || [],
      };
      setDraft(normalized);
    });
    return () => unsubscribe();
  }, [incidentId]);

  const linkedJob = useMemo(() => {
    if (!draft?.jobId) return null;
    return jobs.find((job) => job.id === draft.jobId) || null;
  }, [draft?.jobId, jobs]);

  const handleChange = (updates: Partial<ImsIncident>) => {
    if (!draft) return;
    setDraft({ ...draft, ...updates });
  };

  const syncRiskRegisterFromIncident = async (sourceIncident: ImsIncident) => {
    if (!user) return;
    const now = Timestamp.now();
    const domain = mapIncidentCategoryToDomain(sourceIncident.category);
    const hazards = sourceIncident.hazards || [];

    await Promise.all(
      hazards.map(async (hazard) => {
        const riskId = `incident-${sourceIncident.id}-${hazard.id}`;
        const refDoc = doc(db, COLLECTIONS.IMS_RISK_REGISTER, riskId);
        const existing = await getDoc(refDoc);

        const payload: Omit<ImsRiskRegisterEntry, "id"> = {
          entryType: "risk",
          domain,
          title: hazard.label,
          description: `Identified from incident ${sourceIncident.incidentNumber}.`,
          riskLevel: hazard.riskLevel,
          present: hazard.present,
          existingControls: hazard.controls,
          additionalControls: sourceIncident.immediateActions || "",
          status: hazard.present ? "open" : "closed",
          source: {
            type: "incident",
            id: sourceIncident.id,
            label: sourceIncident.incidentNumber,
            url: `/dashboard/ims/incidents/${sourceIncident.id}`,
          },
          createdAt: existing.exists() ? (existing.data()?.createdAt as Timestamp) : now,
          createdById: existing.exists()
            ? (existing.data()?.createdById as string)
            : user.uid,
          createdByName: existing.exists()
            ? (existing.data()?.createdByName as string)
            : (user.name || user.email),
          updatedAt: now,
        };

        await setDoc(refDoc, payload, { merge: true });
      })
    );
  };

  const handleSave = async (nextStatus?: ImsIncident["status"]) => {
    if (!draft || !user) return;
    setSaving(true);
    try {
      const now = Timestamp.now();
      const payload: Partial<ImsIncident> = {
        ...draft,
        status: nextStatus || draft.status,
        updatedAt: now,
      };
      await updateDoc(doc(db, COLLECTIONS.IMS_INCIDENTS, draft.id), payload as any);
      await syncRiskRegisterFromIncident({ ...draft, status: nextStatus || draft.status });
      toast({ title: "Saved", description: "Incident updated." });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save incident.";
      toast({ title: "Save failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleUploadAttachment = async (file: File) => {
    if (!draft || !user) return;
    setUploading(true);
    try {
      const safeName = file.name.replace(/[^\w.\-() ]/g, "_");
      const storagePath = `ims-incidents/${draft.id}/${Date.now()}_${safeName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      const attachment: ImsIncidentAttachment = {
        name: file.name,
        path: storagePath,
        url,
        contentType: file.type || undefined,
        size: file.size,
        uploadedAt: Timestamp.now(),
        uploadedById: user.uid,
        uploadedByName: user.name || user.email,
      };
      const next = [...(draft.attachments || []), attachment];
      handleChange({ attachments: next });
      await updateDoc(doc(db, COLLECTIONS.IMS_INCIDENTS, draft.id), {
        attachments: next,
        updatedAt: Timestamp.now(),
      });
      toast({ title: "Uploaded", description: file.name });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed.";
      toast({ title: "Upload failed", description: message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const handleRemoveAttachment = async (index: number) => {
    if (!draft) return;
    const next = [...(draft.attachments || [])];
    next.splice(index, 1);
    handleChange({ attachments: next });
    await updateDoc(doc(db, COLLECTIONS.IMS_INCIDENTS, draft.id), {
      attachments: next,
      updatedAt: Timestamp.now(),
    });
  };

  const handleCloseIncident = async () => {
    if (!draft || !user) return;
    setSaving(true);
    try {
      const now = Timestamp.now();
      await updateDoc(doc(db, COLLECTIONS.IMS_INCIDENTS, draft.id), {
        status: "closed",
        closedAt: now,
        closedById: user.uid,
        closedByName: user.name || user.email,
        updatedAt: now,
        investigation: draft.investigation || {},
      });
      toast({ title: "Incident closed", description: draft.incidentNumber });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to close incident.";
      toast({ title: "Close failed", description: message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteIncident = async () => {
    if (!draft) return;
    try {
      await deleteDoc(doc(db, COLLECTIONS.IMS_INCIDENTS, draft.id));
      toast({ title: "Deleted", description: draft.incidentNumber });
      router.push("/dashboard/ims/incidents");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete incident.";
      toast({ title: "Delete failed", description: message, variant: "destructive" });
    }
  };

  if (!draft) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <AlertTriangle className="h-4 w-4 text-primary" />
          Loading incident...
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <Separator orientation="vertical" className="h-4" />
        <span>Incident Management</span>
      </div>

      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3">
            <AlertTriangle className="h-8 w-8 text-amber-400" />
            <h1 className="text-2xl font-bold tracking-tight font-mono">{draft.incidentNumber}</h1>
            <Badge variant="outline" className={incidentStatusBadge(draft.status)}>
              {draft.status.replace("_", " ").toUpperCase()}
            </Badge>
          </div>
          <p className="text-muted-foreground">
            Report, investigate, assign corrective actions, and close out with traceability.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => handleSave()} disabled={saving}>
            {saving ? "Saving..." : "Save"}
          </Button>
          {draft.status === "draft" && (
            <Button onClick={() => handleSave("reported")} disabled={saving}>
              Submit report
            </Button>
          )}
          {user?.role === "admin" && draft.status !== "closed" && (
            <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={handleCloseIncident} disabled={saving}>
              <CheckCircle className="mr-2 h-4 w-4" />
              Close incident
            </Button>
          )}
          {user?.role === "admin" && (
            <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
              <Trash2 className="mr-2 h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <IncidentDetailsCard
          incident={draft}
          jobs={jobs}
          linkedJob={linkedJob}
          onChange={handleChange}
          onOpenJob={(jobId) => router.push(`/dashboard/jobs/${jobId}`)}
        />
        <IncidentDescriptionCard incident={draft} onChange={handleChange} />
      </div>

      <IncidentHazardsCard
        incident={draft}
        onChange={handleChange}
        onSaveAndSync={() => void handleSave()}
        saving={saving}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <IncidentInvestigationCard incident={draft} onChange={handleChange} />
        <IncidentCorrectiveActionsCard incident={draft} onChange={handleChange} onSave={() => void handleSave()} saving={saving} />
      </div>

      <IncidentAttachmentsCard
        incident={draft}
        uploading={uploading}
        onUpload={(file) => void handleUploadAttachment(file)}
        onRemove={(index) => void handleRemoveAttachment(index)}
      />

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete incident?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently remove {draft.incidentNumber} from the register.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDeleteIncident()}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
