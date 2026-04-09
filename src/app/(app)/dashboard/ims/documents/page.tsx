"use client";

/**
 * IMS Documents — full document register.
 *
 * Refactored as part of INC-2026-0001 / CAPA qwAtnxVNYiajLXk2CGc9 to:
 *   - Use the canonical documentService (no direct Firestore queries)
 *   - Show ALL documents regardless of status or schema (dual-schema safe)
 *   - Default status filter shows active + approved + under_review, with
 *     optional "show all" toggle to include draft and obsolete
 *   - Link every row to the branded viewer at /dashboard/ims/documents/[id]/view
 *   - Group by type so policies, procedures, forms, etc. are easy to scan
 *   - Drop the `orderBy("docNumber")` query that silently excluded MCP docs
 *   - Drop the `!doc.currentRevisionId` filter that hid every MCP-created doc
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Search, Eye } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  subscribeAllDocuments,
  type NormalisedDoc,
  type ApprovalState,
} from "@/lib/ims/documentService";

const TYPE_LABELS: Record<string, string> = {
  policy: "Policy",
  manual: "IMS Manual",
  ims_procedure: "IMS Procedure",
  procedure: "Procedure",
  technical_procedure: "Technical Procedure",
  work_instruction: "Work Instruction",
  form: "Form",
  register: "Register",
  management_review: "Management Review",
};

const STATUS_STYLE: Record<ApprovalState, string> = {
  draft: "bg-zinc-500/20 text-zinc-300 border-zinc-500/30",
  under_review: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  approved: "bg-blue-500/20 text-blue-300 border-blue-500/30",
  active: "bg-green-500/20 text-green-300 border-green-500/30",
  obsolete: "bg-red-500/20 text-red-300 border-red-500/30",
};

export default function ImsDocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<NormalisedDoc[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"published" | "all" | ApprovalState>("published");

  useEffect(() => {
    const unsub = subscribeAllDocuments((docs) => {
      setDocuments(docs);
    });
    return () => unsub();
  }, []);

  const visibleDocuments = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    return documents
      .filter((doc) => {
        // Status filter
        if (statusFilter === "published") {
          // Published = active + approved + under_review
          if (!["active", "approved", "under_review"].includes(doc.approvalStatus)) {
            return false;
          }
        } else if (statusFilter !== "all") {
          if (doc.approvalStatus !== statusFilter) return false;
        }

        if (!queryText) return true;
        return (
          doc.docId.toLowerCase().includes(queryText) ||
          doc.title.toLowerCase().includes(queryText) ||
          (TYPE_LABELS[doc.type] || doc.type).toLowerCase().includes(queryText)
        );
      })
      .sort((a, b) => {
        // Sort by type first, then by docId
        if (a.type !== b.type) return a.type.localeCompare(b.type);
        return a.docId.localeCompare(b.docId);
      });
  }, [documents, searchQuery, statusFilter]);

  // Summary counts for filter chips
  const counts = useMemo(() => {
    const result = {
      total: documents.length,
      published: 0,
      draft: 0,
      under_review: 0,
      approved: 0,
      active: 0,
      obsolete: 0,
    };
    documents.forEach((d) => {
      result[d.approvalStatus] = (result[d.approvalStatus] || 0) + 1;
      if (["active", "approved", "under_review"].includes(d.approvalStatus)) {
        result.published++;
      }
    });
    return result;
  }, [documents]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
          <FileText className="h-8 w-8 text-sky-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold">IMS Documents</h1>
          <p className="text-muted-foreground">
            Full register of controlled documents. Click any row to open the branded viewer.
          </p>
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <div className="font-mono text-lg text-foreground">{counts.total}</div>
          <div className="text-xs">total docs</div>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-[280px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by document number, title, or type..."
                className="pl-10"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="Status filter" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="published">Published ({counts.published})</SelectItem>
                <SelectItem value="all">All ({counts.total})</SelectItem>
                <SelectItem value="draft">Draft ({counts.draft})</SelectItem>
                <SelectItem value="under_review">Under Review ({counts.under_review})</SelectItem>
                <SelectItem value="approved">Approved ({counts.approved})</SelectItem>
                <SelectItem value="active">Active ({counts.active})</SelectItem>
                <SelectItem value="obsolete">Obsolete ({counts.obsolete})</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Document Register
            <span className="ml-auto text-sm font-normal text-muted-foreground">
              {visibleDocuments.length} shown
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleDocuments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No documents match the current filter</h3>
              <p className="text-muted-foreground">
                Adjust the status filter or search to see more documents.
              </p>
            </div>
          ) : (
            <div className="rounded-md border border-border/50 overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Rev</TableHead>
                    <TableHead>Effective</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((doc) => (
                    <TableRow
                      key={doc.id}
                      className="hover:bg-muted/20 cursor-pointer"
                      onClick={() => router.push(`/dashboard/ims/documents/${doc.id}/view`)}
                    >
                      <TableCell>
                        <div className="font-medium text-primary">{doc.docId}</div>
                        <div className="text-sm text-muted-foreground truncate max-w-[400px]">{doc.title}</div>
                      </TableCell>
                      <TableCell>{TYPE_LABELS[doc.type] || doc.type}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_STYLE[doc.approvalStatus]}>
                          {doc.approvalStatus.replace("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell>Rev {doc.revisionNumber}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {doc.effectiveDate || "—"}
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/ims/documents/${doc.id}/view`)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
