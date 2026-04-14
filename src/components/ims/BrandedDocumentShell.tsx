/**
 * BrandedDocumentShell — renders any NormalisedDoc inside the ASI-branded
 * document layout (header, metadata block, markdown body, approval block,
 * footer, watermark) defined by docs/BRAND-DECISIONS.md and the ASI brand CSS
 * in globals.css.
 *
 * Format is controlled via the `format` prop: "a4" | "a3" | "a5".
 * Corresponding CSS classes (.asi-a4 / .asi-a3 / .asi-a5) drive the
 * size, margins, and print @page rules.
 *
 * Markdown is rendered via react-markdown + remark-gfm with the brand
 * typography defined in globals.css. Raw HTML is disabled for security.
 */

"use client";

import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  type NormalisedDoc,
  statusDisplay,
} from "@/lib/ims/documentService";

interface Props {
  doc: NormalisedDoc;
  format: "a4" | "a3" | "a5";
}

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

function formatDate(iso: string | null): string {
  if (!iso) return "Pending";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function resolveStandard(doc: NormalisedDoc): string {
  // Heuristic: match on docId prefix + type
  const code = doc.docId.toUpperCase();
  if (code.includes("POL-001") || code.includes("QMS")) return "ISO 9001:2015";
  if (code.includes("POL-002") || code.includes("EMS")) return "ISO 14001:2015";
  if (code.includes("POL-003") || code.includes("WHS") || code.includes("OHS")) return "ISO 45001:2018";
  // Fall back to the type label
  return TYPE_LABELS[doc.type] || doc.type;
}

const CONTROL_BANNER: Record<string, { text: string; color: string }> = {
  draft: { text: "DRAFT — NOT FOR ISSUE", color: "#B88600" },
  under_review: { text: "UNDER REVIEW", color: "#B88600" },
  approved: { text: "APPROVED", color: "#1B5E20" },
  active: { text: "CONTROLLED ISSUE", color: "#CC0000" },
  obsolete: { text: "OBSOLETE — DO NOT USE", color: "#CC0000" },
};

export function BrandedDocumentShell({ doc, format }: Props) {
  const formatClass = `asi-${format}`;
  const status = statusDisplay(doc.approvalStatus);
  const banner = CONTROL_BANNER[doc.approvalStatus];

  return (
    <article className={`asi-doc-shell ${formatClass}`} aria-label={`${doc.docId} — ${doc.title}`}>
      {/* No full-page watermark — control status is shown in the footer banner below. */}

      {/* Header: logo + identity bar */}
      <header className="asi-doc-header">
        <Image
          src="/brand/asi-logo-primary.png"
          alt="ASI Australia"
          width={180}
          height={180}
          className="asi-logo"
          priority
          unoptimized
        />
        <div>
          <h1 className="asi-doc-header-title">ASI Australia</h1>
          <p className="asi-doc-header-subtitle">Integrated Management System</p>
          <div className="asi-doc-header-bar" />
        </div>
      </header>

      {/* Metadata block */}
      <dl className="asi-doc-meta">
        <dt>Document Number</dt>
        <dd>{doc.docId}</dd>

        <dt>Title</dt>
        <dd>{doc.title}</dd>

        <dt>Standard</dt>
        <dd>{resolveStandard(doc)}</dd>

        <dt>Version</dt>
        <dd>Rev {doc.revisionNumber}</dd>

        <dt>Status</dt>
        <dd>
          <span className={`asi-status-badge ${status.className}`}>{status.label}</span>
        </dd>

        <dt>Effective Date</dt>
        <dd>{formatDate(doc.effectiveDate)}</dd>

        <dt>Next Review</dt>
        <dd>{formatDate(doc.reviewDueDate || doc.nextReviewDate)}</dd>

        <dt>Process Owner</dt>
        <dd>{doc.processOwner || "Joshua Hyde, Director"}</dd>

        {doc.isoClauses.length > 0 && (
          <>
            <dt>ISO Clauses</dt>
            <dd>{doc.isoClauses.join(", ")}</dd>
          </>
        )}
      </dl>

      {/* Body — rendered from markdown content */}
      <section className="asi-doc-body">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            // Strip duplicate top-level H1 if the first markdown header matches the title
            h1: ({ children }) => {
              const text = String(children).trim();
              if (text.toUpperCase() === doc.title.toUpperCase()) return null;
              return <h1>{children}</h1>;
            },
          }}
        >
          {doc.content}
        </ReactMarkdown>
      </section>

      {/* Approval block */}
      <section className="asi-doc-approval">
        <h4>Approval</h4>
        <dl className="asi-doc-approval-line">
          <dt>Approved by:</dt>
          <dd>{doc.approvedBy || "Joshua Hyde, Director, ASI Australia Pty Ltd"}</dd>
        </dl>
        <dl className="asi-doc-approval-line">
          <dt>Signature:</dt>
          <dd>&nbsp;</dd>
        </dl>
        <dl className="asi-doc-approval-line">
          <dt>Approval Date:</dt>
          <dd>{doc.approvedAt ? formatDate(doc.approvedAt) : "\u00A0"}</dd>
        </dl>
      </section>

      {/* Footer — shown on A4 and A5, hidden on A3 framed display */}
      {format !== "a3" && (
        <footer className="asi-doc-footer">
          {banner && (
            <p className="asi-doc-control-banner" style={{ color: banner.color }}>
              {banner.text}
            </p>
          )}
          <p>
            This is a controlled document. The current version is maintained at
            asiportal.live. Printed copies are uncontrolled unless stamped
            CONTROLLED COPY with current date.
          </p>
          {format === "a5" && (
            <p>
              <strong>Carry this copy in company vehicle. Replace on revision notice.</strong>
            </p>
          )}
          <div className="asi-doc-footer-meta">
            <span>{doc.docId} · Rev {doc.revisionNumber}</span>
            <span>Printed: {new Date().toLocaleString("en-AU")}</span>
            <span>Doc ID: {doc.id}</span>
          </div>
        </footer>
      )}
    </article>
  );
}
