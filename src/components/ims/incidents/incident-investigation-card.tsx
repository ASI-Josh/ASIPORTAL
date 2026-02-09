"use client";

import { FileText } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ImsIncident } from "@/lib/types";

type Props = {
  incident: ImsIncident;
  onChange: (updates: Partial<ImsIncident>) => void;
};

export function IncidentInvestigationCard({ incident, onChange }: Props) {
  const investigation = incident.investigation || {};

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Investigation
        </CardTitle>
        <CardDescription>Root cause, contributing factors, lessons learned, verification.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Investigation Summary</Label>
          <Textarea
            value={investigation.summary || ""}
            onChange={(e) =>
              onChange({
                investigation: {
                  ...investigation,
                  summary: e.target.value,
                },
              })
            }
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Root Cause</Label>
          <Textarea
            value={investigation.rootCause || ""}
            onChange={(e) =>
              onChange({
                investigation: {
                  ...investigation,
                  rootCause: e.target.value,
                },
              })
            }
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Contributing Factors</Label>
          <Textarea
            value={investigation.contributingFactors || ""}
            onChange={(e) =>
              onChange({
                investigation: {
                  ...investigation,
                  contributingFactors: e.target.value,
                },
              })
            }
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Verification / Effectiveness Evidence</Label>
          <Textarea
            value={investigation.verificationEvidence || ""}
            onChange={(e) =>
              onChange({
                investigation: {
                  ...investigation,
                  verificationEvidence: e.target.value,
                },
              })
            }
            rows={3}
          />
        </div>
        <div className="space-y-2">
          <Label>Lessons Learned</Label>
          <Textarea
            value={investigation.lessonsLearned || ""}
            onChange={(e) =>
              onChange({
                investigation: {
                  ...investigation,
                  lessonsLearned: e.target.value,
                },
              })
            }
            rows={3}
          />
        </div>
      </CardContent>
    </Card>
  );
}

