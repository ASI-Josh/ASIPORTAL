"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Timestamp, collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { FileText, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { IMSDocument, IMSDocumentType } from "@/lib/types";

const DOC_TYPE_LABELS: Record<IMSDocumentType, string> = {
  policy: "Policy",
  manual: "IMS Manual",
  ims_procedure: "IMS Procedure",
  technical_procedure: "Technical Procedure",
  work_instruction: "Work Instruction",
  form: "Form",
  register: "Register",
};

const statusBadge = (status: IMSDocument["status"]) => {
  switch (status) {
    case "active":
      return "bg-green-500/20 text-green-400 border-green-500/30";
    case "obsolete":
      return "bg-red-500/20 text-red-400 border-red-500/30";
    default:
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
  }
};

const formatDate = (value?: Timestamp) => {
  if (!value) return "-";
  const date = value.toDate();
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
};

export default function ImsDocumentsPage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<IMSDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const docsQuery = query(
      collection(db, COLLECTIONS.IMS_DOCUMENTS),
      orderBy("docNumber", "asc")
    );
    const unsubscribe = onSnapshot(docsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<IMSDocument, "id">),
      }));
      setDocuments(loaded);
    });
    return () => unsubscribe();
  }, []);

  const visibleDocuments = useMemo(() => {
    const queryText = searchQuery.trim().toLowerCase();
    return documents.filter((doc) => {
      if (doc.status !== "active") return false;
      if (!doc.currentRevisionId) return false;
      if (!queryText) return true;
      return (
        doc.docNumber.toLowerCase().includes(queryText) ||
        doc.title.toLowerCase().includes(queryText) ||
        DOC_TYPE_LABELS[doc.docType].toLowerCase().includes(queryText)
      );
    });
  }, [documents, searchQuery]);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
          <FileText className="h-8 w-8 text-sky-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">IMS Documents</h1>
          <p className="text-muted-foreground">
            Controlled documents and the latest approved revisions.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by number, title, or type..."
              className="pl-10"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Document Register
          </CardTitle>
        </CardHeader>
        <CardContent>
          {visibleDocuments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium mb-2">No active documents yet</h3>
              <p className="text-muted-foreground">
                Approved documents will appear here once issued.
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
                    <TableHead>Revision</TableHead>
                    <TableHead>Issue Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((doc) => (
                    <TableRow key={doc.id} className="hover:bg-muted/20">
                      <TableCell>
                        <div className="font-medium text-primary">{doc.docNumber}</div>
                        <div className="text-sm text-muted-foreground">{doc.title}</div>
                      </TableCell>
                      <TableCell>{DOC_TYPE_LABELS[doc.docType]}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={statusBadge(doc.status)}>
                          {doc.status}
                        </Badge>
                      </TableCell>
                      <TableCell>Rev {doc.currentRevisionNumber ?? "-"}</TableCell>
                      <TableCell>{formatDate(doc.currentIssueDate)}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => router.push(`/dashboard/ims/documents/${doc.id}`)}
                        >
                          Open
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
