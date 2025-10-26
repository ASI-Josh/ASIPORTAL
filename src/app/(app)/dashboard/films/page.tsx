import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FileText } from "lucide-react";

export default function FilmsPage() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <Card className="w-full max-w-lg text-center bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <div className="mx-auto bg-primary/10 p-3 rounded-full">
            <FileText className="h-8 w-8 text-primary" />
          </div>
        </CardHeader>
        <CardContent>
          <CardTitle className="text-2xl font-headline">Film Management</CardTitle>
          <p className="text-muted-foreground mt-2">
            This section is under construction. Track warranties and film installations here.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
