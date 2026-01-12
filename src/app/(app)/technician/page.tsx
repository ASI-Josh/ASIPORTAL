import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wrench } from "lucide-react";

export default function TechnicianPage() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-lg text-center bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <div className="mx-auto bg-primary/10 p-3 rounded-full">
            <Wrench className="h-8 w-8 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <CardTitle className="text-2xl font-headline">Technician Dashboard</CardTitle>
          <p className="text-muted-foreground mt-2">
            This area is being prepared. Assigned jobs and schedules will appear here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
