import { PipelineBoard } from "@/components/crm/pipeline-board";
import { Button } from "@/components/ui/button";
import { PlusCircle } from "lucide-react";

export default function CrmPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-theme(spacing.16)-2*theme(spacing.8))]">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">Sales Pipeline</h2>
          <p className="text-muted-foreground">Manage your leads from start to finish.</p>
        </div>
        <Button>
          <PlusCircle className="mr-2 h-4 w-4" />
          Add Lead
        </Button>
      </div>
      <PipelineBoard />
    </div>
  );
}
