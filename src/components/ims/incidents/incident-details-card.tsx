"use client";
import { FileText, Link2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
import { toDateTimeLocalInput, parseDateTimeLocalInput } from "@/lib/ims/incidents";
import type {
  ImsIncident,
  ImsIncidentCategory,
  ImsIncidentSeverity,
  ImsIncidentStatus,
  ImsIncidentType,
  Job,
} from "@/lib/types";

type JobOption = Pick<Job, "id" | "jobNumber" | "clientName" | "organizationId" | "siteLocation">;

type Props = {
  incident: ImsIncident;
  jobs: JobOption[];
  linkedJob: JobOption | null;
  onChange: (updates: Partial<ImsIncident>) => void;
  onOpenJob: (jobId: string) => void;
};

export function IncidentDetailsCard({ incident, jobs, linkedJob, onChange, onOpenJob }: Props) {
  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <FileText className="h-4 w-4 text-primary" />
          Incident Details
        </CardTitle>
        <CardDescription>Core incident classification and time/location.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Category</Label>
            <Select
              value={incident.category}
              onValueChange={(val) => onChange({ category: val as ImsIncidentCategory })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="whs">WHS</SelectItem>
                <SelectItem value="environment">Environment</SelectItem>
                <SelectItem value="quality">Quality</SelectItem>
                <SelectItem value="property">Property</SelectItem>
                <SelectItem value="security">Security</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Incident Type</Label>
            <Select
              value={incident.incidentType}
              onValueChange={(val) => onChange({ incidentType: val as ImsIncidentType })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="injury">Injury</SelectItem>
                <SelectItem value="near_miss">Near miss</SelectItem>
                <SelectItem value="hazard">Hazard</SelectItem>
                <SelectItem value="unsafe_condition">Unsafe condition</SelectItem>
                <SelectItem value="spill">Spill</SelectItem>
                <SelectItem value="nonconformance">Nonconformance</SelectItem>
                <SelectItem value="property_damage">Property damage</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Severity</Label>
            <Select
              value={incident.severity}
              onValueChange={(val) => onChange({ severity: val as ImsIncidentSeverity })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={incident.status}
              onValueChange={(val) => onChange({ status: val as ImsIncidentStatus })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="reported">Reported</SelectItem>
                <SelectItem value="investigating">Investigating</SelectItem>
                <SelectItem value="actions_required">Actions required</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Occurred At</Label>
            <Input
              type="datetime-local"
              value={toDateTimeLocalInput(incident.occurredAt)}
              onChange={(e) => {
                const ts = parseDateTimeLocalInput(e.target.value);
                if (ts) onChange({ occurredAt: ts });
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>Linked Job</Label>
            <Select
              value={incident.jobId || ""}
              onValueChange={(val) => {
                if (!val) {
                  onChange({ jobId: undefined, jobNumber: undefined });
                  return;
                }
                const job = jobs.find((j) => j.id === val);
                onChange({
                  jobId: job?.id,
                  jobNumber: job?.jobNumber,
                  organizationId: job?.organizationId,
                  organizationName: job?.clientName,
                  siteLocation: job?.siteLocation
                    ? { name: job.siteLocation.name, address: job.siteLocation.address }
                    : undefined,
                });
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Optional" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">None</SelectItem>
                {jobs.slice(0, 50).map((job) => (
                  <SelectItem key={job.id} value={job.id}>
                    {job.jobNumber} — {job.clientName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkedJob && (
              <Button variant="link" className="px-0 h-auto text-xs" onClick={() => onOpenJob(linkedJob.id)}>
                <Link2 className="mr-1 h-3 w-3" />
                Open job card
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label>Site Name</Label>
            <Input
              value={incident.siteLocation?.name || ""}
              onChange={(e) =>
                onChange({
                  siteLocation: {
                    name: e.target.value,
                    address: incident.siteLocation?.address || "",
                  },
                })
              }
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label>Site Address</Label>
            <Input
              value={incident.siteLocation?.address || ""}
              onChange={(e) =>
                onChange({
                  siteLocation: {
                    name: incident.siteLocation?.name || "",
                    address: e.target.value,
                  },
                })
              }
            />
          </div>
        </div>

        {incident.jobNumber ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="outline">{incident.jobNumber}</Badge>
            <span>Linked to this incident for traceability.</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
