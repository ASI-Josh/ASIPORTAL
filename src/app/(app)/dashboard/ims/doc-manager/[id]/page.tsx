"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { ArrowLeft, FileText, Save, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { generateImsDocumentDraftAction } from "@/app/actions/ims-doc-manager";
import { db, storage } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  IMSDocument,
  IMSAgentDraftOutput,
  IMSDocumentRevision,
  IMSDocumentType,
  IMSDocumentStatus,
  IMSRevisionStatus,
} from "@/lib/types";

const DOC_TYPE_OPTIONS: Array<{ value: IMSDocumentType; label: string }> = [
  { value: "policy", label: "Policy" },
  { value: "manual", label: "IMS Manual" },
  { value: "ims_procedure", label: "IMS Procedure" },
  { value: "technical_procedure", label: "Technical Procedure" },
  { value: "work_instruction", label: "Work Instruction" },
  { value: "form", label: "Form" },
  { value: "register", label: "Register" },
];

const DOC_STATUS_OPTIONS: IMSDocumentStatus[] = ["draft", "active", "obsolete"];
const REVISION_STATUS_OPTIONS: IMSRevisionStatus[] = ["draft", "review", "issued", "obsolete"];

const buildLocalDateString = () => {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().split("T")[0];
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

const pruneUndefined = (value: unknown): unknown => {
  if (value instanceof Timestamp) return value;
  if (Array.isArray(value)) {
    return value.map(pruneUndefined);
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(record)
      .filter(([, val]) => val !== undefined)
      .map(([key, val]) => [key, pruneUndefined(val)])
  );
};

const buildAgentTemplate = ({
  title,
  docType,
  processOwner,
  isoClauses,
  relatedDocs,
}: {
  title: string;
  docType: IMSDocumentType;
  processOwner: string;
  isoClauses: string;
  relatedDocs: string;
}) =>
  [
    `Document title: ${title || "TBD"}`,
    `Document type: ${docType}`,
    `Process owner: ${processOwner || "TBD"}`,
    `ISO clauses: ${isoClauses || "TBD"}`,
    `Related documents: ${relatedDocs || "None"}`,
    "",
    "Purpose:",
    "Scope:",
    "Inputs/outputs:",
    "Records produced:",
    "Key risks/controls:",
    "Verification/monitoring:",
    "Tools/equipment/systems:",
    "Process steps (high level):",
    "Responsibilities:",
    "Notes/constraints:",
  ].join("\n");

const LOGO_URL = encodeURI("/logos/ASI BRANDING - OFFICIAL MAIN.png");

const sanitizeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80) || "document";

const buildFileName = (docNumber: string, revision: number, title: string, ext: string) =>
  `${docNumber}_Rev${revision}_${sanitizeFileName(title)}.${ext}`;

const buildDocContent = (doc: IMSDocument, draft?: IMSAgentDraftOutput) => {
  const title = draft?.metadata?.title || doc.title;
  const sections =
    draft?.sections?.length
      ? draft.sections
      : [
          {
            title: "Overview",
            content:
              "Document content will be added here. This is a controlled template draft.",
          },
        ];
  return { title, sections };
};

const fetchLogoBytes = async () => {
  const response = await fetch(LOGO_URL);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
};

const wrapText = (text: string, maxWidth: number, font: any, size: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    const width = font.widthOfTextAtSize(test, size);
    if (width > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = test;
    }
  });
  if (current) lines.push(current);
  return lines;
};

export default function DocManagerDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const docId = params.id as string;
  const approverEmail = "joshua@asi-australia.com.au";
  const isApprover = user?.email === approverEmail;

  const [docRecord, setDocRecord] = useState<IMSDocument | null>(null);
  const [revisions, setRevisions] = useState<IMSDocumentRevision[]>([]);
  const [metadata, setMetadata] = useState({
    title: "",
    docType: "ims_procedure" as IMSDocumentType,
    status: "draft" as IMSDocumentStatus,
    isoClauses: "",
  });
  const [savingMeta, setSavingMeta] = useState(false);
  const [newRevision, setNewRevision] = useState({
    issueDate: buildLocalDateString(),
    summary: "",
    status: "issued" as IMSRevisionStatus,
    file: null as File | null,
  });
  const [agentBrief, setAgentBrief] = useState("");
  const [agentIssueDate, setAgentIssueDate] = useState(buildLocalDateString());
  const [agentProcessOwner, setAgentProcessOwner] = useState("");
  const [agentRelatedDocs, setAgentRelatedDocs] = useState("");
  const [agentRevision, setAgentRevision] = useState("");
  const [agentWorking, setAgentWorking] = useState(false);
  const [latestDraft, setLatestDraft] = useState<IMSDocumentRevision | null>(null);
  const [uploading, setUploading] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingDocx, setExportingDocx] = useState(false);
  const [issuingReview, setIssuingReview] = useState(false);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [downloadUrls, setDownloadUrls] = useState<Record<string, string>>({});

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
    if (!docRecord) return;
    setMetadata({
      title: docRecord.title,
      docType: docRecord.docType,
      status: docRecord.status,
      isoClauses: docRecord.isoClauses?.join(", ") || "",
    });
    setAgentProcessOwner(docRecord.owner?.name || "");
  }, [docRecord]);

  useEffect(() => {
    const revisionsRef = collection(db, COLLECTIONS.IMS_DOCUMENTS, docId, "revisions");
    const revisionsQuery = query(revisionsRef, orderBy("revisionNumber", "desc"));
    const unsubscribe = onSnapshot(revisionsQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<IMSDocumentRevision, "id">),
      }));
      setRevisions(loaded);
    });
    return () => unsubscribe();
  }, [docId]);

  useEffect(() => {
    const paths = revisions.flatMap((revision) => {
      const list = [];
      if (revision.file?.path) list.push(revision.file.path);
      if (revision.supportingFiles?.length) {
        revision.supportingFiles.forEach((file) => {
          if (file.path) list.push(file.path);
        });
      }
      return list;
    });
    const pending = paths.filter((path) => path && !downloadUrls[path]);
    if (pending.length === 0) return;
    pending.forEach((path) => {
      if (!path) return;
      getDownloadURL(ref(storage, path))
        .then((url) => {
          setDownloadUrls((prev) => ({ ...prev, [path]: url }));
        })
        .catch(() => {
          setDownloadUrls((prev) => ({ ...prev, [path]: "" }));
        });
    });
  }, [revisions, downloadUrls]);

  const nextRevisionNumber = useMemo(() => {
    const max = revisions.reduce(
      (current, revision) => Math.max(current, revision.revisionNumber || 0),
      0
    );
    return max + 1;
  }, [revisions]);

  useEffect(() => {
    if (!agentRevision) {
      setAgentRevision(String(nextRevisionNumber));
    }
  }, [agentRevision, nextRevisionNumber]);

  useEffect(() => {
    const draft = revisions.find(
      (revision) =>
        Boolean(revision.draftOutput) && (!revision.source || revision.source === "agent")
    );
    setLatestDraft(draft || null);
  }, [revisions]);

  const handleSaveMetadata = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!metadata.title.trim()) {
      toast({
        title: "Missing title",
        description: "Document title is required.",
        variant: "destructive",
      });
      return;
    }

    setSavingMeta(true);
    try {
      const now = Timestamp.now();
      const isoClauses = metadata.isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const payload = pruneUndefined({
        title: metadata.title.trim(),
        docType: metadata.docType,
        status: metadata.status,
        isoClauses: isoClauses.length > 0 ? isoClauses : undefined,
        updatedAt: now,
      }) as Partial<IMSDocument>;
      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id), payload);
      toast({
        title: "Document updated",
        description: "Metadata saved successfully.",
      });
    } catch (error) {
      console.error("Failed to update document:", error);
      toast({
        title: "Update failed",
        description: "Unable to save changes.",
        variant: "destructive",
      });
    } finally {
      setSavingMeta(false);
    }
  };

  const handleUploadRevision = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!newRevision.file) {
      toast({
        title: "Missing file",
        description: "Attach a revision file before uploading.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const now = Timestamp.now();
      const issueDate = newRevision.issueDate
        ? Timestamp.fromDate(new Date(newRevision.issueDate))
        : now;
      const revisionId = `rev-${String(nextRevisionNumber).padStart(3, "0")}`;
      const safeName = newRevision.file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const filePath = `ims-documents/${docRecord.id}/${revisionId}/${safeName}`;
      const storageRef = ref(storage, filePath);
      await uploadBytes(storageRef, newRevision.file);

      const revisionPayload: Omit<IMSDocumentRevision, "id"> = {
        revisionNumber: nextRevisionNumber,
        issueDate,
        status: newRevision.status,
        summary: newRevision.summary.trim() || undefined,
        file: {
          name: newRevision.file.name,
          path: filePath,
          contentType: newRevision.file.type || undefined,
          size: newRevision.file.size,
        },
        isCurrent: newRevision.status === "issued",
        source: "manual",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };

      await setDoc(
        doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id, "revisions", revisionId),
        pruneUndefined(revisionPayload) as IMSDocumentRevision
      );

      if (docRecord.currentRevisionId && newRevision.status === "issued") {
        await updateDoc(
          doc(
            db,
            COLLECTIONS.IMS_DOCUMENTS,
            docRecord.id,
            "revisions",
            docRecord.currentRevisionId
          ),
          {
            isCurrent: false,
            status: "obsolete",
          }
        );
      }

      const nextDocStatus = newRevision.status === "issued" ? "active" : docRecord.status;
      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id), {
        currentRevisionId: newRevision.status === "issued" ? revisionId : docRecord.currentRevisionId,
        currentRevisionNumber:
          newRevision.status === "issued" ? nextRevisionNumber : docRecord.currentRevisionNumber,
        currentIssueDate: newRevision.status === "issued" ? issueDate : docRecord.currentIssueDate,
        currentFile:
          newRevision.status === "issued"
            ? revisionPayload.file
            : docRecord.currentFile || undefined,
        status: nextDocStatus,
        updatedAt: now,
      });

      setNewRevision({
        issueDate: buildLocalDateString(),
        summary: "",
        status: "issued",
        file: null,
      });
      toast({
        title: "Revision saved",
        description: "New revision has been issued.",
      });
    } catch (error) {
      console.error("Failed to upload revision:", error);
      toast({
        title: "Upload failed",
        description: "Unable to save this revision.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleGenerateDraft = async () => {
    if (!docRecord) return;
    if (!user || user.role !== "admin") return;
    if (!agentBrief.trim()) {
      toast({
        title: "Missing brief",
        description: "Provide document requirements before generating a draft.",
        variant: "destructive",
      });
      return;
    }

    setAgentWorking(true);
    try {
      const isoClauses = metadata.isoClauses
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const relatedDocs = agentRelatedDocs
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      const result = await generateImsDocumentDraftAction({
        docNumber: docRecord.docNumber,
        title: metadata.title.trim() || docRecord.title,
        docType: metadata.docType,
        revision: agentRevision || String(nextRevisionNumber),
        issueDate: agentIssueDate,
        processOwner: agentProcessOwner,
        isoClauses,
        relatedDocs,
        brief: agentBrief.trim(),
      });
      const now = Timestamp.now();
      const revisionNumber = Number.parseInt(agentRevision, 10) || nextRevisionNumber;
      const revisionId = `draft-${revisionNumber}-${Date.now()}`;
      const draftOutput = result.draft as IMSAgentDraftOutput;
      const revisionPayload: Omit<IMSDocumentRevision, "id"> = {
        revisionNumber,
        issueDate: agentIssueDate
          ? Timestamp.fromDate(new Date(agentIssueDate))
          : now,
        status: "draft",
        summary: "AI draft generated",
        draftOutput,
        draftPrompt: agentBrief.trim() || undefined,
        isCurrent: false,
        source: "agent",
        createdAt: now,
        createdById: user.uid,
        createdByName: user.name || user.email || "Admin",
        createdByEmail: user.email || undefined,
      };
      await setDoc(
        doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id, "revisions", revisionId),
        pruneUndefined(revisionPayload) as IMSDocumentRevision
      );
      toast({
        title: "Draft generated",
        description: "Agent draft saved to revision history.",
      });
    } catch (error) {
      console.error("Failed to generate draft:", error);
      const message =
        error instanceof Error ? error.message : "Unable to generate draft.";
      toast({
        title: "Draft failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setAgentWorking(false);
    }
  };

  const uploadGeneratedFile = async (
    revision: IMSDocumentRevision,
    blob: Blob,
    fileName: string,
    contentType: string,
    isPrimary: boolean
  ) => {
    const filePath = `ims-documents/${docId}/revisions/${revision.id}/${fileName}`;
    const storageRef = ref(storage, filePath);
    await uploadBytes(storageRef, blob, { contentType });
    const filePayload = {
      name: fileName,
      path: filePath,
      contentType,
      size: blob.size,
    };
    const revisionRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, docId, "revisions", revision.id);
    if (isPrimary) {
      await updateDoc(revisionRef, { file: filePayload });
    } else {
      const existing = revision.supportingFiles || [];
      const filtered = existing.filter((file) => file.name !== fileName);
      await updateDoc(revisionRef, { supportingFiles: [...filtered, filePayload] });
    }
    return filePayload;
  };

  const handleExportPdf = async () => {
    if (!docRecord || !latestDraft?.draftOutput) return;
    setExportingPdf(true);
    try {
      const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
      const logoBytes = await fetchLogoBytes();
      const pdfDoc = await PDFDocument.create();
      const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
      const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
      const logoImage = await pdfDoc.embedPng(logoBytes);
      const page = pdfDoc.addPage([595.28, 841.89]); // A4
      const { width, height } = page.getSize();
      const margin = 48;
      const logoDims = logoImage.scale(0.2);

      page.drawImage(logoImage, {
        x: margin,
        y: height - margin - logoDims.height,
        width: logoDims.width,
        height: logoDims.height,
      });

      const { title, sections } = buildDocContent(docRecord, latestDraft.draftOutput);
      const revisionNumber = latestDraft.revisionNumber;
      const issueDate = latestDraft.issueDate?.toDate?.().toLocaleDateString("en-AU") || "";
      const metaText = `Doc ID: ${docRecord.docNumber} | Rev ${revisionNumber} | Issued ${issueDate}`;

      page.drawText(title, {
        x: margin + logoDims.width + 12,
        y: height - margin - 12,
        size: 14,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });
      page.drawText(metaText, {
        x: margin + logoDims.width + 12,
        y: height - margin - 30,
        size: 9,
        font,
        color: rgb(0.35, 0.35, 0.35),
      });

      let cursorY = height - margin - 70;
      const contentWidth = width - margin * 2;

      sections.forEach((section) => {
        const titleLines = wrapText(section.title, contentWidth, bold, 12);
        titleLines.forEach((line) => {
          if (cursorY < margin + 80) return;
          page.drawText(line, { x: margin, y: cursorY, size: 12, font: bold });
          cursorY -= 16;
        });
        const bodyLines = wrapText(section.content || "", contentWidth, font, 10);
        bodyLines.forEach((line) => {
          if (cursorY < margin + 60) return;
          page.drawText(line, { x: margin, y: cursorY, size: 10, font });
          cursorY -= 14;
        });
        cursorY -= 10;
      });

      page.drawText("Controlled document. Uncontrolled if printed.", {
        x: margin,
        y: margin - 20,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });

      const pdfBytes = await pdfDoc.save();
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      const fileName = buildFileName(
        docRecord.docNumber,
        latestDraft.revisionNumber,
        docRecord.title,
        "pdf"
      );
      await uploadGeneratedFile(latestDraft, blob, fileName, "application/pdf", true);
      toast({
        title: "PDF generated",
        description: `${fileName} uploaded to storage.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate PDF.";
      toast({ title: "PDF export failed", description: message, variant: "destructive" });
    } finally {
      setExportingPdf(false);
    }
  };

  const handleExportDocx = async () => {
    if (!docRecord || !latestDraft?.draftOutput) return;
    setExportingDocx(true);
    try {
      const { Document, Packer, Paragraph, TextRun, Header, Footer, ImageRun, AlignmentType } =
        await import("docx");
      const logoBytes = await fetchLogoBytes();
      const { title, sections } = buildDocContent(docRecord, latestDraft.draftOutput);
      const revisionNumber = latestDraft.revisionNumber;
      const issueDate = latestDraft.issueDate?.toDate?.().toLocaleDateString("en-AU") || "";

      const header = new Header({
        children: [
          new Paragraph({
            children: [
              new ImageRun({
                data: logoBytes,
                transformation: { width: 120, height: 48 },
                type: "png",
              }),
              new TextRun({ text: "  " }),
              new TextRun({ text: title, bold: true }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Doc ID: ${docRecord.docNumber} | Rev ${revisionNumber} | Issued ${issueDate}`,
                size: 18,
              }),
            ],
          }),
        ],
      });

      const footer = new Footer({
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "Controlled document. Uncontrolled if printed.", size: 16 }),
            ],
          }),
        ],
      });

      const body = sections.flatMap((section) => [
        new Paragraph({
          children: [new TextRun({ text: section.title, bold: true, size: 26 })],
          spacing: { after: 120 },
        }),
        new Paragraph({
          children: [new TextRun({ text: section.content || "", size: 22 })],
          spacing: { after: 200 },
        }),
      ]);

      const docx = new Document({
        sections: [
          {
            headers: { default: header },
            footers: { default: footer },
            children: body,
          },
        ],
      });

      const blob = await Packer.toBlob(docx);
      const fileName = buildFileName(
        docRecord.docNumber,
        latestDraft.revisionNumber,
        docRecord.title,
        "docx"
      );
      await uploadGeneratedFile(
        latestDraft,
        blob,
        fileName,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        false
      );
      toast({
        title: "DOCX generated",
        description: `${fileName} uploaded to storage.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to generate DOCX.";
      toast({ title: "DOCX export failed", description: message, variant: "destructive" });
    } finally {
      setExportingDocx(false);
    }
  };

  const handleIssueForReview = async () => {
    if (!docRecord || !latestDraft) return;
    setIssuingReview(true);
    try {
      const now = Timestamp.now();
      const revisionRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, docId, "revisions", latestDraft.id);
      await updateDoc(revisionRef, {
        status: "review",
        submittedForReviewAt: now,
        submittedForReviewById: user?.uid || "",
        submittedForReviewByName: user?.name || user?.email || "Admin",
      });

      const usersRef = collection(db, COLLECTIONS.USERS);
      const adminQuery = query(usersRef, where("role", "==", "admin"));
      const adminSnap = await getDocs(adminQuery);
      const emails: string[] = [];

      await Promise.all(
        adminSnap.docs.map(async (docSnap) => {
          const data = docSnap.data() as { email?: string; name?: string };
          if (!data.email || data.email.toLowerCase() !== approverEmail) return;
          emails.push(data.email);
          await addDoc(collection(db, COLLECTIONS.NOTIFICATIONS), {
            userId: docSnap.id,
            type: "ims_review",
            title: "IMS document ready for review",
            message: `${docRecord.docNumber} - ${docRecord.title} is ready for review.`,
            read: false,
            relatedEntityId: docRecord.docNumber,
            relatedEntityType: "ims_document",
            createdAt: now,
          });
        })
      );

      if (emails.length > 0) {
        await addDoc(collection(db, COLLECTIONS.MAIL), {
          to: emails,
          message: {
            subject: `IMS Document Review: ${docRecord.docNumber}`,
            text: `${docRecord.docNumber} - ${docRecord.title} is ready for review in ASI Portal.`,
          },
        });
      }

      toast({
        title: "Review requested",
        description: "Admins have been notified for review.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to request review.";
      toast({ title: "Review request failed", description: message, variant: "destructive" });
    } finally {
      setIssuingReview(false);
    }
  };

  const handleApproveRevision = async (revision: IMSDocumentRevision) => {
    if (!docRecord || !user || !isApprover) return;
    setApprovingId(revision.id);
    try {
      const now = Timestamp.now();
      const revisionRef = doc(db, COLLECTIONS.IMS_DOCUMENTS, docId, "revisions", revision.id);
      await updateDoc(revisionRef, {
        status: "issued",
        isCurrent: true,
        approvedAt: now,
        approvedById: user.uid,
        approvedByName: user.name || user.email || "Approver",
        approvedByEmail: user.email || undefined,
      });

      if (docRecord.currentRevisionId && docRecord.currentRevisionId !== revision.id) {
        await updateDoc(
          doc(
            db,
            COLLECTIONS.IMS_DOCUMENTS,
            docRecord.id,
            "revisions",
            docRecord.currentRevisionId
          ),
          {
            isCurrent: false,
            status: "obsolete",
          }
        );
      }

      await updateDoc(doc(db, COLLECTIONS.IMS_DOCUMENTS, docRecord.id), {
        currentRevisionId: revision.id,
        currentRevisionNumber: revision.revisionNumber,
        currentIssueDate: revision.issueDate,
        currentFile: revision.file || docRecord.currentFile || undefined,
        status: "active",
        updatedAt: now,
      });

      toast({
        title: "Revision approved",
        description: `Rev ${revision.revisionNumber} is now active.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to approve revision.";
      toast({ title: "Approval failed", description: message, variant: "destructive" });
    } finally {
      setApprovingId(null);
    }
  };

  if (!user || user.role !== "admin") {
    return (
      <Card className="bg-card/50 backdrop-blur">
        <CardContent className="p-6 text-muted-foreground">
          Doc Manager is restricted to ASI administrators.
        </CardContent>
      </Card>
    );
  }

  if (!docRecord) {
    return (
      <div className="space-y-4">
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/doc-manager")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to doc manager
        </Button>
        <div className="text-muted-foreground">Document not found.</div>
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
        <Button variant="outline" onClick={() => router.push("/dashboard/ims/doc-manager")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to doc manager
        </Button>
      </div>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Document metadata</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-2 md:col-span-2">
            <Label>Title</Label>
            <Input
              value={metadata.title}
              onChange={(event) => setMetadata((prev) => ({ ...prev, title: event.target.value }))}
            />
          </div>
          <div className="grid gap-2">
            <Label>Document type</Label>
            <Select
              value={metadata.docType}
              onValueChange={(value) =>
                setMetadata((prev) => ({ ...prev, docType: value as IMSDocumentType }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={metadata.status}
              onValueChange={(value) =>
                setMetadata((prev) => ({ ...prev, status: value as IMSDocumentStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:col-span-2">
            <Label>ISO 9001 clauses</Label>
            <Input
              value={metadata.isoClauses}
              onChange={(event) =>
                setMetadata((prev) => ({ ...prev, isoClauses: event.target.value }))
              }
              placeholder="Comma-separated, e.g., 7.5, 8.1"
            />
          </div>
          <div className="md:col-span-2 flex justify-end">
            <Button onClick={handleSaveMetadata} disabled={savingMeta}>
              <Save className="mr-2 h-4 w-4" />
              {savingMeta ? "Saving..." : "Save metadata"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Upload new revision</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label>Next revision</Label>
            <Input value={`Rev ${nextRevisionNumber}`} readOnly />
          </div>
          <div className="grid gap-2">
            <Label>Issue date</Label>
            <Input
              type="date"
              value={newRevision.issueDate}
              onChange={(event) =>
                setNewRevision((prev) => ({ ...prev, issueDate: event.target.value }))
              }
            />
          </div>
          <div className="grid gap-2">
            <Label>Status</Label>
            <Select
              value={newRevision.status}
              onValueChange={(value) =>
                setNewRevision((prev) => ({ ...prev, status: value as IMSRevisionStatus }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REVISION_STATUS_OPTIONS.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2 md:col-span-3">
            <Label>Revision summary</Label>
            <Textarea
              value={newRevision.summary}
              onChange={(event) =>
                setNewRevision((prev) => ({ ...prev, summary: event.target.value }))
              }
              placeholder="Describe the revision changes"
            />
          </div>
          <div className="grid gap-2 md:col-span-3">
            <Label>Revision file</Label>
            <Input
              type="file"
              onChange={(event) =>
                setNewRevision((prev) => ({
                  ...prev,
                  file: event.target.files?.[0] || null,
                }))
              }
            />
          </div>
          <div className="md:col-span-3 flex justify-end">
            <Button onClick={handleUploadRevision} disabled={uploading}>
              <Upload className="mr-2 h-4 w-4" />
              {uploading ? "Uploading..." : "Upload revision"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Agent workspace</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Draft settings</div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="grid gap-2">
                  <Label>Draft revision</Label>
                  <Input
                    value={agentRevision}
                    onChange={(event) => setAgentRevision(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Issue date</Label>
                  <Input
                    type="date"
                    value={agentIssueDate}
                    onChange={(event) => setAgentIssueDate(event.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>Process owner</Label>
                  <Input
                    value={agentProcessOwner}
                    onChange={(event) => setAgentProcessOwner(event.target.value)}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label>Related documents (comma-separated)</Label>
                <Input
                  value={agentRelatedDocs}
                  onChange={(event) => setAgentRelatedDocs(event.target.value)}
                  placeholder="IMS-PROC-001, POL-002"
                />
              </div>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold">Your instruction</div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setAgentBrief(
                        buildAgentTemplate({
                          title: metadata.title.trim() || docRecord.title,
                          docType: metadata.docType,
                          processOwner: agentProcessOwner,
                          isoClauses: metadata.isoClauses,
                          relatedDocs: agentRelatedDocs,
                        })
                      )
                    }
                  >
                    Insert template
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setAgentBrief("")}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <Textarea
                value={agentBrief}
                onChange={(event) => setAgentBrief(event.target.value)}
                placeholder="Tell the agent what to draft (purpose, scope, records, risks, verification, tools)."
                rows={10}
              />
              <div className="text-xs text-muted-foreground">
                This instruction is stored with the draft for traceability.
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={handleGenerateDraft} disabled={agentWorking}>
                {agentWorking ? "Generating..." : "Generate draft with agent"}
              </Button>
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border/40 bg-background/60 p-4 space-y-3">
              <div className="text-sm font-semibold">Agent response</div>
              {latestDraft?.draftOutput ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportPdf}
                      disabled={exportingPdf}
                    >
                      {exportingPdf ? "Generating PDF..." : "Generate PDF"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExportDocx}
                      disabled={exportingDocx}
                    >
                      {exportingDocx ? "Generating DOCX..." : "Generate DOCX"}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      onClick={handleIssueForReview}
                      disabled={issuingReview}
                    >
                      {issuingReview ? "Notifying..." : "Issue for review"}
                    </Button>
                  </div>
                  {latestDraft.draftPrompt ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase text-muted-foreground">You</div>
                      <Textarea readOnly rows={6} value={latestDraft.draftPrompt} />
                    </div>
                  ) : null}
                  {latestDraft.draftOutput.questions?.length ? (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                      {latestDraft.draftOutput.questions.map((question) => (
                        <div key={question}>- {question}</div>
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <div className="text-xs uppercase text-muted-foreground">Agent draft (JSON)</div>
                    <Textarea
                      readOnly
                      rows={14}
                      value={JSON.stringify(latestDraft.draftOutput, null, 2)}
                    />
                  </div>
                </>
              ) : (
                <div className="text-sm text-muted-foreground">
                  No agent draft yet. Use the instruction panel to generate one.
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur">
        <CardHeader>
          <CardTitle>Revision history</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {revisions.length === 0 ? (
            <div className="text-sm text-muted-foreground">No revisions issued yet.</div>
          ) : (
            revisions.map((revision) => (
              <div
                key={revision.id}
                className="flex flex-col gap-2 rounded-lg border border-border/40 bg-background/60 p-3 md:flex-row md:items-center md:justify-between"
              >
                <div>
                  <div className="font-medium">
                    Rev {revision.revisionNumber} {revision.isCurrent ? "(Current)" : ""}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Issued {revision.issueDate?.toDate?.().toLocaleDateString("en-AU")}
                  </div>
                  {revision.status === "review" && revision.submittedForReviewByName ? (
                    <div className="text-xs text-amber-200">
                      Pending approval · submitted by {revision.submittedForReviewByName}
                    </div>
                  ) : null}
                  {revision.summary ? (
                    <div className="text-sm text-muted-foreground">{revision.summary}</div>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Badge
                    variant="outline"
                    className={statusBadge(
                      revision.status === "issued"
                        ? "active"
                        : revision.status === "obsolete"
                          ? "obsolete"
                          : "draft"
                    )}
                  >
                    {revision.status}
                  </Badge>
                  {revision.status === "review" && isApprover ? (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleApproveRevision(revision)}
                      disabled={approvingId === revision.id}
                    >
                      {approvingId === revision.id ? "Approving..." : "Approve & issue"}
                    </Button>
                  ) : null}
                  {revision.file?.name ? (
                    <Button
                      variant="outline"
                      size="sm"
                      asChild
                      disabled={!downloadUrls[revision.file.path]}
                    >
                      <a
                        href={downloadUrls[revision.file.path] || "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download PDF
                      </a>
                    </Button>
                  ) : null}
                  {revision.supportingFiles?.map((file) => (
                    <Button
                      key={file.path}
                      variant="outline"
                      size="sm"
                      asChild
                      disabled={!downloadUrls[file.path]}
                    >
                      <a
                        href={downloadUrls[file.path] || "#"}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download {file.name.toLowerCase().endsWith(".docx") ? "DOCX" : "File"}
                      </a>
                    </Button>
                  ))}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
