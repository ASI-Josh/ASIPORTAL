/**
 * GET /dashboard/ims/documents/[id]/view
 *
 * Branded IMS document viewer. Renders any `imsDocuments` record in the
 * ASI-branded shell with live Firestore updates, format selector (A4/A3/A5),
 * print, PDF export, and Director-only state transitions.
 *
 * Built in response to INC-2026-0001 / CAPA qwAtnxVNYiajLXk2CGc9.
 * This is the canonical viewer path. Doc Manager and IMS Filing pages both
 * link here so controlled document rendering happens in one place only.
 */

"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  FileDown,
  Loader2,
  Printer,
  Send,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { BrandedDocumentShell } from "@/components/ims/BrandedDocumentShell";
import { ApprovalModal } from "@/components/ims/ApprovalModal";
import {
  activateDocument,
  canActivate,
  canApprove,
  canObsolete,
  canSubmit,
  isDirector,
  obsoleteDocument,
  subscribeDocument,
  submitForReview,
  type NormalisedDoc,
  type TransitionActor,
} from "@/lib/ims/documentService";

type Format = "a4" | "a3" | "a5";

export default function DocumentViewerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();

  const [doc, setDoc] = useState<NormalisedDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useState<Format>("a4");
  const [approvalOpen, setApprovalOpen] = useState(false);
  const [acting, setActing] = useState(false);

  // Toggle body class so @page rules pick the right paper size on print
  useEffect(() => {
    const bodyClass = `asi-print-${format}`;
    document.body.classList.add(bodyClass);
    return () => {
      document.body.classList.remove(bodyClass);
    };
  }, [format]);

  // Live document subscription — no more split-brain
  useEffect(() => {
    if (!id) return;
    const unsub = subscribeDocument(
      id,
      (d) => {
        if (!d) {
          setError("Document not found.");
          setDoc(null);
        } else {
          setDoc(d);
          setError(null);
        }
        setLoading(false);
      },
      (err) => {
        setError(err.message);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [id]);

  const director = isDirector(user?.email);
  const actor: TransitionActor | null = user
    ? {
        uid: user.uid,
        email: user.email || "",
        name: user.name || user.email || "User",
      }
    : null;

  const handleSubmitForReview = async () => {
    if (!doc || !actor) return;
    setActing(true);
    try {
      await submitForReview(doc.id, actor);
      toast({ title: "Submitted for review", description: `${doc.docId} is now under review.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Submission failed.";
      toast({ title: "Submission failed", description: message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const handleActivate = async () => {
    if (!doc || !actor) return;
    if (!confirm(`Activate ${doc.docId}? This will auto-obsolete any prior active version with the same reference.`)) return;
    setActing(true);
    try {
      await activateDocument(doc.id, actor);
      toast({ title: "Activated", description: `${doc.docId} is now the controlled active version.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Activation failed.";
      toast({ title: "Activation failed", description: message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const handleObsolete = async () => {
    if (!doc || !actor) return;
    const reason = prompt("Reason for obsoleting this document (required for audit trail):");
    if (!reason) return;
    setActing(true);
    try {
      await obsoleteDocument(doc.id, actor, reason);
      toast({ title: "Document obsoleted", description: `${doc.docId} marked obsolete.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Obsolete action failed.";
      toast({ title: "Obsolete failed", description: message, variant: "destructive" });
    } finally {
      setActing(false);
    }
  };

  const handlePrint = () => {
    window.print();
  };

  const handlePdfExport = async () => {
    if (!doc) return;
    toast({
      title: "PDF export",
      description: "Use your browser's Print → Save as PDF for highest fidelity. The MCP endpoint export_ims_document_pdf returns server-rendered HTML for headless finalisation.",
    });
    // Fall back to browser print dialog which produces a PDF via "Save as PDF"
    window.print();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !doc) {
    return (
      <Card className="bg-card/50 backdrop-blur max-w-xl mx-auto mt-8">
        <CardContent className="p-6 flex items-center gap-3 text-muted-foreground">
          <ShieldAlert className="h-5 w-5 text-destructive" />
          {error || "Document not found."}
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {/* Load brand fonts only on the viewer */}
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Montserrat:wght@600;700;800;900&family=JetBrains+Mono:wght@500&display=swap"
      />

      {/* Chrome — hidden in print */}
      <div className="no-print asi-viewer-chrome sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => router.back()}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Button>
            <div>
              <div className="text-sm font-semibold">{doc.docId}</div>
              <div className="text-xs text-muted-foreground">{doc.title}</div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Format selector */}
            <div className="flex items-center gap-1 rounded-md border border-border bg-card/50 p-1">
              {(["a4", "a3", "a5"] as Format[]).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  variant={format === f ? "default" : "ghost"}
                  className="h-7 text-xs px-3"
                  onClick={() => setFormat(f)}
                >
                  {f.toUpperCase()}
                </Button>
              ))}
            </div>

            <Button size="sm" variant="outline" onClick={handlePrint}>
              <Printer className="h-4 w-4 mr-1" />
              Print
            </Button>

            <Button size="sm" variant="outline" onClick={handlePdfExport}>
              <FileDown className="h-4 w-4 mr-1" />
              PDF
            </Button>

            {/* State transition actions — Director only */}
            {director && canSubmit(doc) && (
              <Button size="sm" onClick={handleSubmitForReview} disabled={acting}>
                <Send className="h-4 w-4 mr-1" />
                Submit for Review
              </Button>
            )}
            {director && canApprove(doc) && (
              <Button size="sm" onClick={() => setApprovalOpen(true)} disabled={acting}>
                <Check className="h-4 w-4 mr-1" />
                Approve
              </Button>
            )}
            {director && canActivate(doc) && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-500"
                onClick={handleActivate}
                disabled={acting}
              >
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Activate
              </Button>
            )}
            {director && canObsolete(doc) && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleObsolete}
                disabled={acting}
              >
                Obsolete
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Document viewer canvas */}
      <div className="no-print-bg px-6 py-8" style={{ background: "#1A2130" }}>
        <BrandedDocumentShell doc={doc} format={format} />

        {/* Revision history — hidden in print, below the shell */}
        <div className="no-print max-w-[210mm] mx-auto mt-6">
          <Accordion type="single" collapsible className="bg-card/50 backdrop-blur border border-border/40 rounded-lg">
            <AccordionItem value="history" className="border-0">
              <AccordionTrigger className="px-4 py-3 text-sm">
                Revision History ({doc.revisionHistory.length} entries)
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4">
                {doc.revisionHistory.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No revision history recorded yet.
                  </p>
                ) : (
                  <ol className="space-y-3">
                    {[...doc.revisionHistory].reverse().map((entry, idx) => (
                      <li
                        key={`${entry.revision}-${idx}`}
                        className="border-l-2 border-primary/40 pl-4 py-1"
                      >
                        <div className="text-xs font-mono text-muted-foreground">
                          Rev {entry.revision} · {new Date(entry.updatedAt).toLocaleString("en-AU")}
                        </div>
                        <div className="text-sm text-foreground mt-1">{entry.changeNote}</div>
                        <div className="text-xs text-muted-foreground mt-1">by {entry.updatedBy}</div>
                      </li>
                    ))}
                  </ol>
                )}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </div>
      </div>

      {/* Approval modal */}
      {actor && (
        <ApprovalModal
          doc={doc}
          actor={actor}
          open={approvalOpen}
          onClose={() => setApprovalOpen(false)}
        />
      )}
    </>
  );
}
