"use client";

import { Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { ImsIncident } from "@/lib/types";

type Props = {
  incident: ImsIncident;
  uploading: boolean;
  onUpload: (file: File) => void;
  onRemove: (index: number) => void;
};

export function IncidentAttachmentsCard({ incident, uploading, onUpload, onRemove }: Props) {
  const attachments = incident.attachments || [];

  return (
    <Card className="bg-card/50 backdrop-blur">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4 text-primary" />
          Records & Attachments
        </CardTitle>
        <CardDescription>Upload photos, PDFs, statements, or evidence relevant to this incident.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onUpload(file);
              e.currentTarget.value = "";
            }}
            disabled={uploading}
            className="max-w-[360px]"
          />
          {uploading && <span className="text-xs text-muted-foreground">Uploading...</span>}
        </div>

        {attachments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No attachments uploaded yet.</div>
        ) : (
          <div className="space-y-2">
            {attachments.map((att, index) => (
              <div
                key={`${att.path}-${index}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border/50 p-3 text-sm"
              >
                <div className="min-w-[220px]">
                  <div className="font-medium">{att.name}</div>
                  <div className="text-xs text-muted-foreground">Uploaded by {att.uploadedByName}</div>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <a href={att.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => onRemove(index)}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

