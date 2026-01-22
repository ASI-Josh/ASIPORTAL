import Link from "next/link";
import { ArrowDown, ClipboardCheck, FileText, Layers } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const IMS_PROCEDURES = [
  "Document Control",
  "Corrective Action",
  "Internal Audit",
  "Management Review",
];

const TECHNICAL_PROCEDURES = [
  "Crack Repair",
  "Scratch Removal",
  "Trim Repair",
  "Film Installation",
];

export default function ImsHubPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="p-3 rounded-lg bg-sky-500/20 backdrop-blur-sm">
          <Layers className="h-8 w-8 text-sky-400" />
        </div>
        <div>
          <h1 className="text-3xl font-bold">ASI IMS</h1>
          <p className="text-muted-foreground">
            Integrated Management System structure aligned to ISO 9001/14001/45001.
          </p>
        </div>
      </div>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardContent className="p-4 md:p-6">
          <div className="grid gap-6">
            <Card className="bg-background/60 border-border/40">
              <CardHeader>
                <CardTitle className="text-base">Policies</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Quality Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Environmental Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span>Safety Policy</span>
                  <Badge variant="secondary">Draft</Badge>
                </div>
              </CardContent>
            </Card>

            <div className="flex justify-center">
              <ArrowDown className="h-6 w-6 text-muted-foreground" />
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">IMS Procedures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {IMS_PROCEDURES.map((item) => (
                    <div key={item} className="flex items-center justify-between text-sm">
                      <span>{item}</span>
                      <Badge variant="secondary">Draft</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Technical Procedures</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {TECHNICAL_PROCEDURES.map((item) => (
                    <div key={item} className="flex items-center justify-between text-sm">
                      <span>{item}</span>
                      <Badge variant="secondary">Draft</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Registers</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Link href="/dashboard/works-register" className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Works Register
                  </Link>
                  <Link
                    href="/dashboard/ims/prestart-register"
                    className="flex items-center gap-2"
                  >
                    <ClipboardCheck className="h-4 w-4 text-primary" />
                    Prestart Register
                  </Link>
                  <Link href="/dashboard/goods-received" className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-primary" />
                    Goods Received Register
                  </Link>
                </CardContent>
              </Card>

              <Card className="bg-background/60 border-border/40">
                <CardHeader>
                  <CardTitle className="text-base">Forms</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <Link href="/dashboard/daily-prestart" className="flex items-center gap-2">
                    <ClipboardCheck className="h-4 w-4 text-primary" />
                    Daily Prestart Checklist
                  </Link>
                  <div className="flex items-center justify-between">
                    <span>Corrective Action Form</span>
                    <Badge variant="secondary">Draft</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Internal Audit Checklist</span>
                    <Badge variant="secondary">Draft</Badge>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle>IMS filing structure</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>
            Use this hub to keep policies, procedures, registers, and forms in one controlled
            structure. Each register links to live records for traceability.
          </p>
          <p>
            As we add ISO 14001 and 45001 content, this map will expand without bloating the main
            sidebar.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
