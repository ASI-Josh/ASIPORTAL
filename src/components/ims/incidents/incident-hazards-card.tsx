"use client";

import { AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ImsIncident, ImsIncidentHazard } from "@/lib/types";

type Props = {
  incident: ImsIncident;
  onChange: (updates: Partial<ImsIncident>) => void;
  onSaveAndSync: () => void;
  saving: boolean;
};

export function IncidentHazardsCard({ incident, onChange, onSaveAndSync, saving }: Props) {
  const hazards = incident.hazards || [];
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <AlertTriangle className="h-4 w-4 text-primary" />
          Hazards & Controls (for Risk Register)
        </CardTitle>
        <CardDescription>
          Tick hazards present and confirm risk level and controls. These sync to the Risk & Opportunities Register.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-3">
          {hazards.map((hazard, index) => (
            <div key={hazard.id} className="rounded-lg border border-border/50 p-3 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  checked={hazard.present}
                  onCheckedChange={(checked) => {
                    const next = [...hazards];
                    next[index] = { ...hazard, present: Boolean(checked) };
                    onChange({ hazards: next });
                  }}
                />
                <span className="font-medium">{hazard.label}</span>
                <Select
                  value={hazard.riskLevel}
                  onValueChange={(val) => {
                    const next = [...hazards];
                    next[index] = { ...hazard, riskLevel: val as ImsIncidentHazard["riskLevel"] };
                    onChange({ hazards: next });
                  }}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Controls</Label>
                <Input
                  value={hazard.controls}
                  onChange={(e) => {
                    const next = [...hazards];
                    next[index] = { ...hazard, controls: e.target.value };
                    onChange({ hazards: next });
                  }}
                />
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onSaveAndSync} disabled={saving}>
            {saving ? "Saving..." : "Save & sync risks"}
          </Button>
          <span className="text-xs text-muted-foreground">
            Risk register entries are created per hazard (source = incident).
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

