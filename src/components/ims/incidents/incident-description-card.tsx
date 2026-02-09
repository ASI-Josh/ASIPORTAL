"use client";

import { ShieldAlert } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ImsIncident } from "@/lib/types";

type Props = {
  incident: ImsIncident;
  onChange: (updates: Partial<ImsIncident>) => void;
};

export function IncidentDescriptionCard({ incident, onChange }: Props) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Description & Immediate Actions
        </CardTitle>
        <CardDescription>Describe what happened and what was done immediately.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            value={incident.description || ""}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={5}
            placeholder="Describe what happened, who/what was involved, and any impacts."
          />
        </div>
        <div className="space-y-2">
          <Label>Immediate Actions Taken</Label>
          <Textarea
            value={incident.immediateActions || ""}
            onChange={(e) => onChange({ immediateActions: e.target.value })}
            rows={4}
            placeholder="Containment, first aid, isolation, spill response, notifications..."
          />
        </div>
      </CardContent>
    </Card>
  );
}

