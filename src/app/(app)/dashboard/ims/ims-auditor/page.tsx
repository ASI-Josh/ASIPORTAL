import { ImsAgentWorkspace } from "@/components/ims/ims-agent-workspace";

const DEFAULT_AUDIT_BRIEF = [
  "Create an Internal Audit Checklist aligned to ISO 9001:2015.",
  "Include audit scope, criteria, records, and verification methods.",
  "Ask questions for any missing ASI-specific details.",
].join("\n");

export default function ImsAuditorPage() {
  return (
    <ImsAgentWorkspace
      heading="IMS Auditor"
      description="Draft internal audit checklists, plans, and reports using the controlled document workflow."
      defaultDocType="form"
      defaultTitle="Internal Audit Checklist"
      defaultBrief={DEFAULT_AUDIT_BRIEF}
    />
  );
}
