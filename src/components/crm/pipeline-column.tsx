import type { Lead, PipelineStage } from "@/lib/types";
import { LeadCard } from "./lead-card";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PipelineColumnProps {
  stage: { id: PipelineStage; title: string };
  leads: Lead[];
}

export function PipelineColumn({ stage, leads }: PipelineColumnProps) {
  return (
    <div className="w-80 flex-shrink-0 flex flex-col">
      <div className="flex items-center justify-between p-2 rounded-t-lg bg-card/70">
        <h3 className="font-semibold text-foreground">{stage.title}</h3>
        <span className="text-sm font-medium bg-muted text-muted-foreground rounded-full px-2 py-0.5">
          {leads.length}
        </span>
      </div>
      <ScrollArea className="flex-1 bg-card/30 rounded-b-lg border border-t-0 border-border/20">
        <div className="p-2 space-y-4">
            {leads.map((lead) => (
                <LeadCard key={lead.id} lead={lead} />
            ))}
        </div>
      </ScrollArea>
    </div>
  );
}
