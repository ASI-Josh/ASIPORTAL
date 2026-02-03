"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  doc,
  Timestamp,
} from "firebase/firestore";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";

type CorrectiveAction = {
  id: string;
  title: string;
  description: string;
  severity: "minor" | "major" | "ofi";
  relatedDocs: string[];
  evidence?: string;
  suggestedAction?: string;
  dueDate?: string;
  status: "open" | "in_progress" | "closed";
  createdByName?: string;
  createdAt?: Timestamp;
  closureNotes?: string;
};

const statusBadge = (status: CorrectiveAction["status"]) => {
  switch (status) {
    case "closed":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "in_progress":
      return "bg-sky-500/20 text-sky-300 border-sky-500/30";
    default:
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  }
};

export default function CorrectiveActionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [actions, setActions] = useState<CorrectiveAction[]>([]);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [closures, setClosures] = useState<Record<string, string>>({});

  useEffect(() => {
    const actionsQuery = query(
      collection(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(actionsQuery, (snapshot) => {
      const items = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CorrectiveAction, "id">),
      }));
      setActions(items);
    });
    return () => unsubscribe();
  }, []);

  const handleStatusChange = async (action: CorrectiveAction, status: CorrectiveAction["status"]) => {
    setSavingId(action.id);
    try {
      await updateDoc(doc(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS, action.id), {
        status,
      });
      toast({ title: "Status updated", description: `${action.title} marked ${status}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update.";
      toast({ title: "Update failed", description: message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  const handleCloseOut = async (action: CorrectiveAction) => {
    const notes = closures[action.id] || "";
    setSavingId(action.id);
    try {
      await updateDoc(doc(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS, action.id), {
        status: "closed",
        closureNotes: notes,
        closedAt: Timestamp.now(),
        closedByName: user?.name || user?.email || "Admin",
      });
      toast({ title: "Corrective action closed", description: action.title });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to close.";
      toast({ title: "Close failed", description: message, variant: "destructive" });
    } finally {
      setSavingId(null);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Corrective Action Register is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-amber-500/20 backdrop-blur-sm">
          <ShieldAlert className="h-8 w-8 text-amber-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">Corrective Action Register</h1>
          <p className="text-muted-foreground">
            Log, track, and close out corrective actions from audits or agent findings.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Open corrective actions</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {actions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No corrective actions yet.</div>
          ) : (
            actions.map((action) => (
              <div
                key={action.id}
                className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-primary">{action.title}</div>
                    <div className="text-xs text-muted-foreground">
                      Raised by {action.createdByName || "Agent"} · Severity {action.severity.toUpperCase()}
                    </div>
                  </div>
                  <Badge variant="outline" className={statusBadge(action.status)}>
                    {action.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="text-sm text-muted-foreground">{action.description}</div>
                {action.relatedDocs?.length ? (
                  <div className="text-xs text-muted-foreground">
                    Related docs: {action.relatedDocs.join(", ")}
                  </div>
                ) : null}
                {action.evidence ? (
                  <div className="text-xs text-muted-foreground">Evidence: {action.evidence}</div>
                ) : null}
                {action.suggestedAction ? (
                  <div className="text-xs text-muted-foreground">
                    Suggested action: {action.suggestedAction}
                  </div>
                ) : null}
                {action.dueDate ? (
                  <div className="text-xs text-muted-foreground">Due: {action.dueDate}</div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-[200px_1fr_auto] items-center">
                  <div className="grid gap-2">
                    <Label>Status</Label>
                    <Select
                      value={action.status}
                      onValueChange={(value) =>
                        handleStatusChange(action, value as CorrectiveAction["status"])
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Open</SelectItem>
                        <SelectItem value="in_progress">In progress</SelectItem>
                        <SelectItem value="closed">Closed</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label>Closure notes</Label>
                    <Input
                      value={closures[action.id] ?? action.closureNotes ?? ""}
                      onChange={(event) =>
                        setClosures((prev) => ({ ...prev, [action.id]: event.target.value }))
                      }
                      placeholder="Describe verification / close-out evidence"
                    />
                  </div>
                  <div className="flex gap-2 pt-6">
                    <Button
                      size="sm"
                      onClick={() => handleCloseOut(action)}
                      disabled={savingId === action.id}
                    >
                      {savingId === action.id ? "Saving..." : "Close out"}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
