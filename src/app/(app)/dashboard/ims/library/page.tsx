"use client";

/**
 * IMS Library — staff-facing view of controlled documents.
 *
 * Refactored as part of INC-2026-0001 / CAPA qwAtnxVNYiajLXk2CGc9 to:
 *   - Use the canonical documentService (no direct Firestore queries)
 *   - Show BOTH active documents (MCP `approvalStatus: "active"`) AND
 *     legacy-style active docs (`status: "active"`), via the service's
 *     unified normalisation
 *   - Link each row to the branded viewer at /dashboard/ims/documents/[id]/view
 *   - Drop the `where("status", "==", "active") + orderBy("docNumber")`
 *     query that silently excluded all MCP-created policies
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getDownloadURL, ref } from "firebase/storage";
import { Eye, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { storage } from "@/lib/firebaseClient";
import {
  subscribeAllDocuments,
  type NormalisedDoc,
} from "@/lib/ims/documentService";

const TYPE_LABELS: Record<string, string> = {
  ims_procedure: "IMS Procedure",
  procedure: "Procedure",
  technical_procedure: "Technical Procedure",
  work_instruction: "Work Instruction",
  form: "Form",
  policy: "Policy",
  manual: "IMS Manual",
  register: "Register",
  management_review: "Management Review",
};

const docTypeLabel = (docType: string) => TYPE_LABELS[docType] || docType;

export default function ImsLibraryPage() {
  const { user } = useAuth();
  const [allDocs, setAllDocs] = useState<NormalisedDoc[]>([]);
  const [downloads, setDownloads] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeAllDocuments((docs) => {
      setAllDocs(docs);
    });
    return () => unsub();
  }, [user]);

  // Filter to the set relevant to the current user's role.
  // Technicians see only procedures/forms. Admins see everything published.
  // "Published" = approvalStatus in {"active", "approved"}. Drafts and
  // under_review are hidden from the library view; those belong in Doc Manager.
  const visibleDocs = useMemo(() => {
    const allowedTypes =
      user?.role === "admin"
        ? ["policy", "manual", "ims_procedure", "procedure", "technical_procedure", "work_instruction", "form", "register"]
        : ["technical_procedure", "procedure", "work_instruction", "form"];

    return allDocs
      .filter((d) => allowedTypes.includes(d.type))
      .filter((d) => d.approvalStatus === "active" || d.approvalStatus === "approved")
      .sort((a, b) => a.docId.localeCompare(b.docId));
  }, [allDocs, user?.role]);

  // Resolve Firebase Storage download URLs for any legacy docs with attached files
  useEffect(() => {
    const paths = visibleDocs
      .map((d) => {
        const currentFile = d.raw.currentFile as { path?: string } | undefined;
        return currentFile?.path;
      })
      .filter((path): path is string => Boolean(path));
    const pending = paths.filter((path) => path && !downloads[path]);
    if (pending.length === 0) return;
    pending.forEach((path) => {
      getDownloadURL(ref(storage, path))
        .then((url) => setDownloads((prev) => ({ ...prev, [path]: url })))
        .catch(() => setDownloads((prev) => ({ ...prev, [path]: "" })));
    });
  }, [visibleDocs, downloads]);

  if (!user || (user.role !== "admin" && user.role !== "technician")) {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground flex items-center gap-3">
          <ShieldAlert className="h-4 w-4 text-primary" />
          IMS Library is restricted to ASI staff.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">IMS Library</h1>
        <p className="text-muted-foreground">
          Approved and active controlled documents. Click any document to open the branded viewer.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>
            Published documents
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({visibleDocs.length})
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {visibleDocs.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No published documents yet. Approved and active documents will appear here.
            </div>
          ) : (
            visibleDocs.map((d) => {
              const currentFile = d.raw.currentFile as { path?: string } | undefined;
              const filePath = currentFile?.path;
              const downloadUrl = filePath ? downloads[filePath] : null;
              return (
                <div
                  key={d.id}
                  className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between hover:border-primary/40 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/dashboard/ims/documents/${d.id}/view`}
                      className="block"
                    >
                      <div className="font-medium text-primary">{d.docId}</div>
                      <div className="text-sm text-muted-foreground truncate">
                        {d.title}
                      </div>
                    </Link>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <Badge variant="outline">{docTypeLabel(d.type)}</Badge>
                    <Badge
                      variant="outline"
                      className={
                        d.approvalStatus === "active"
                          ? "border-green-500/40 text-green-400"
                          : "border-blue-500/40 text-blue-400"
                      }
                    >
                      {d.approvalStatus}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Rev {d.revisionNumber}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                    >
                      <Link href={`/dashboard/ims/documents/${d.id}/view`}>
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        View
                      </Link>
                    </Button>
                    {downloadUrl && (
                      <Button variant="outline" size="sm" asChild>
                        <a href={downloadUrl} target="_blank" rel="noreferrer">
                          File
                        </a>
                      </Button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
