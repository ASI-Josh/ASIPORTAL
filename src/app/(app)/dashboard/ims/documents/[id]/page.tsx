"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, onSnapshot } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { ArrowLeft, FileText, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { IMSDocument } from "@/lib/types";

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

export default function ImsDocumentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const docId = params.id as string;

  const [docRecord, setDocRecord] = useState<IMSDocument | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    const docRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, docId);
    const unsubscribe = onSnapshot(
      docRef,
      (snapshot) => {
        if (!snapshot.exists()) {
          setDocRecord(null);
          return;
        }
        const data = snapshot.data() as Omit<IMSDocument, "id">;
        setDocRecord({ id: snapshot.id, ...data });
      },
      () => setDocRecord(null)
    );
    return () => unsubscribe();
  }, [docId]);

  useEffect(() => {
    if (!docRecord?.currentFile?.path) {
      setDownloadUrl(null);
      return;
    }
    setDownloadError(null);
    getDownloadURL(ref(storage, docRecord.currentFile.path))
      .then((url) => setDownloadUrl(url))
      .catch(() => {
        setDownloadUrl(null);
        setDownloadError("Unable to load the latest revision.");
      });
  }, [docRecord]);

  if (!docRecord) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/documents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to documents
        </Button>
        <div className="text-muted-foreground">Document not found.</div>
      </div>
    );
  }

  if (docRecord.status !== "active" && user?.role !== "admin") {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/documents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to documents
        </Button>
        <Card className="bg-card/50 backdrop-blur">
          <CardContent className="p-6 text-muted-foreground">
            This document is not currently active. Contact an administrator for access.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
            <FileText className="h-8 w-8 text-sky-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">{docRecord.docNumber}</h1>
            <p className="text-muted-foreground">{docRecord.title}</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/documents")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to documents
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Current revision</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <Badge variant="outline" className={statusBadge(docRecord.status)}>
                {docRecord.status}
              </Badge>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Revision</div>
              <div className="font-semibold">Rev {docRecord.currentRevisionNumber ?? "-"}</div>
            </div>
            <div>
              <div className="text-sm text-muted-foreground">Issue date</div>
              <div className="font-semibold">
                {docRecord.currentIssueDate?.toDate?.().toLocaleDateString("en-AU") || "-"}
              </div>
            </div>
          </div>
          {docRecord.currentFile?.name ? (
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-muted-foreground">File</div>
                <div className="font-medium">{docRecord.currentFile.name}</div>
              </div>
              <Button asChild disabled={!downloadUrl}>
                <a href={downloadUrl || "#"} target="_blank" rel="noreferrer">
                  Download
                </a>
              </Button>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              No current revision file is attached.
            </div>
          )}
          {downloadError ? (
            <div className="text-sm text-destructive">{downloadError}</div>
          ) : null}
        </CardContent>
      </Card>

      {docRecord.isoClauses && docRecord.isoClauses.length > 0 ? (
        <Card className="bg-card/50 backdrop-blur">
          <CardHeader>
            <CardTitle>ISO 9001 references</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {docRecord.isoClauses.map((clause) => (
              <Badge key={clause} variant="secondary">
                {clause}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Document control</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-primary" />
          Latest approved revisions are issued here. Superseded versions are restricted.
        </CardContent>
      </Card>
    </div>
  );
}
