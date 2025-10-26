import { mockLeads, PIPELINE_STAGES } from "@/lib/data";
import { PipelineColumn } from "./pipeline-column";

export function PipelineBoard() {
  return (
    <div className="flex-1 overflow-x-auto pb-4">
      <div className="flex gap-6 h-full">
        {PIPELINE_STAGES.map((stage) => {
          const leadsInStage = mockLeads.filter((lead) => lead.stage === stage.id);
          return <PipelineColumn key={stage.id} stage={stage} leads={leadsInStage} />;
        })}
      </div>
    </div>
  );
}
