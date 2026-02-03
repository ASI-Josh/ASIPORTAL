"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { getDownloadURL, ref } from "firebase/storage";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { IMSDocument } from "@/lib/types";

const docTypeLabel = (docType: IMSDocument["docType"]) => {
  switch (docType) {
    case "ims_procedure":
      return "IMS Procedure";
    case "technical_procedure":
      return "Technical Procedure";
    case "work_instruction":
      return "Work Instruction";
    case "form":
      return "Form";
    case "policy":
      return "Policy";
    case "manual":
      return "IMS Manual";
    case "register":
      return "Register";
    default:
      return docType;
  }
};

export default function ImsLibraryPage() {
  const { user } = useAuth();
  const [docs, setDocs] = useState<IMSDocument[]>([]);
  const [downloads, setDownloads] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    const allowedTypes =
      user.role === "admin"
        ? ["policy", "manual", "ims_procedure", "technical_procedure", "work_instruction", "form", "register"]
        : ["technical_procedure", "work_instruction", "form"];

    const docsQuery = query(
      collection(db, COLLECTIONS.IMS_DOCUMENTS),
      where("status", "==", "active"),
      where("docType", "in", allowedTypes),
      orderBy("docNumber", "asc")
    );
    const unsubscribe = onSnapshot(docsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<IMSDocument, "id">),
      }));
      setDocs(loaded);
    });
    return () => unsubscribe();
  }, [user]);

  useEffect(() => {
    const paths = docs
      .map((doc) => doc.currentFile?.path)
      .filter((path): path is string => Boolean(path));
    const pending = paths.filter((path) => path && !downloads[path]);
    if (pending.length === 0) return;
    pending.forEach((path) => {
      getDownloadURL(ref(storage, path))
        .then((url) => {
          setDownloads((prev) => ({ ...prev, [path]: url }));
        })
        .catch(() => {
          setDownloads((prev) => ({ ...prev, [path]: "" }));
        });
    });
  }, [docs, downloads]);

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
          Approved procedures and forms for technicians and admins.
        </p>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Active procedures</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {docs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No active documents yet.</div>
          ) : (
            docs.map((doc) => (
              <div
                key={doc.id}
                className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium text-primary">{doc.docNumber}</div>
                  <div className="text-sm text-muted-foreground">{doc.title}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge variant="outline">{docTypeLabel(doc.docType)}</Badge>
                  <span>Rev {doc.currentRevisionNumber ?? "-"}</span>
                  {doc.currentFile?.path ? (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      disabled={!downloads[doc.currentFile.path]}
                    >
                      <a href={downloads[doc.currentFile.path] || "#"} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    </Button>
                  ) : (
                    <Badge variant="secondary">No file</Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
