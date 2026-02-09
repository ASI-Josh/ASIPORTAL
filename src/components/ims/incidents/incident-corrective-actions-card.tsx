"use client";

import { FileText, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ImsIncident } from "@/lib/types";

type CorrectiveAction =
  NonNullable<NonNullable<ImsIncident["investigation"]>["correctiveActions"]>[number];

type Props = {
  incident: ImsIncident;
  onChange: (updates: Partial<ImsIncident>) => void;
  onSave: () => void;
  saving: boolean;
};

export function IncidentCorrectiveActionsCard({ incident, onChange, onSave, saving }: Props) {
  const investigation = incident.investigation || {};
  const actions: CorrectiveAction[] = investigation.correctiveActions || [];

  const setActions = (next: CorrectiveAction[]) => {
    onChange({
      investigation: {
        ...investigation,
        correctiveActions: next,
      },
    });
  };

  const handleAdd = () => {
    setActions([
      ...actions,
      {
        id: crypto.randomUUID(),
        title: "",
        description: "",
        status: "open",
      },
    ]);
  };

  const handleUpdate = (id: string, updates: Partial<CorrectiveAction>) => {
    setActions(actions.map((action) => (action.id === id ? { ...action, ...updates } : action)));
  };

  const handleRemove = (id: string) => {
    setActions(actions.filter((action) => action.id !== id));
  };

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Corrective Actions
        </CardTitle>
        <CardDescription>Track actions to prevent recurrence and confirm closure evidence.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {actions.length === 0 ? (
          <div className="text-sm text-muted-foreground">No corrective actions added yet.</div>
        ) : (
          <div className="space-y-3">
            {actions.map((action) => (
              <div key={action.id} className="rounded-lg border border-border/50 p-3 space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Title</Label>
                    <Input value={action.title} onChange={(e) => handleUpdate(action.id, { title: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Status</Label>
                    <Select
                      value={action.status}
                      onValueChange={(val) =>
                        handleUpdate(action.id, { status: val as CorrectiveAction["status"] })
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
                </div>

                <div className="space-y-2">
                  <Label>Description</Label>
                  <Textarea
                    value={action.description}
                    onChange={(e) => handleUpdate(action.id, { description: e.target.value })}
                    rows={2}
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Owner</Label>
                    <Input
                      value={action.ownerName || ""}
                      onChange={(e) => handleUpdate(action.id, { ownerName: e.target.value })}
                      placeholder="Name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Due Date</Label>
                    <Input
                      type="date"
                      value={action.dueDate || ""}
                      onChange={(e) => handleUpdate(action.id, { dueDate: e.target.value })}
                    />
                  </div>
                  <div className="flex items-end justify-end">
                    <Button variant="ghost" className="text-destructive" onClick={() => handleRemove(action.id)}>
                      <Trash2 className="mr-2 h-4 w-4" />
                      Remove
                    </Button>
                  </div>
                </div>

                {action.status === "closed" && (
                  <div className="space-y-2">
                    <Label>Closure notes / evidence</Label>
                    <Input
                      value={action.closureNotes || ""}
                      onChange={(e) => handleUpdate(action.id, { closureNotes: e.target.value })}
                      placeholder="Evidence, verification method, sign-off..."
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={handleAdd}>
            Add corrective action
          </Button>
          <Button onClick={onSave} disabled={saving}>
            {saving ? "Saving..." : "Save actions"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

