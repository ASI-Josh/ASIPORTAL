"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  CheckCircle,
  ClipboardCheck,
  FileWarning,
  Shield,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { GoodsReceivedInspection, StockItem } from "@/lib/types";

interface ImsIncidentRecord {
  id: string;
  incidentNumber?: string;
  incidentType?: string;
  category?: string;
  severity?: string;
  description?: string;
  status?: string;
  createdAt?: { toDate?: () => Date };
}

interface ImsCorrectiveActionRecord {
  id: string;
  title?: string;
  description?: string;
  domain?: string;
  priority?: string;
  status?: string;
  sourceType?: string;
  sourceLabel?: string;
  ownerName?: string;
  dueDate?: string;
  createdAt?: { toDate?: () => Date };
}

interface ImsRiskRecord {
  id: string;
  title?: string;
  domain?: string;
  riskLevel?: string;
  status?: string;
  entryType?: string;
  source?: { type?: string; label?: string };
  createdAt?: { toDate?: () => Date };
}

interface Props {
  stockItems: StockItem[];
  inspections: GoodsReceivedInspection[];
}

export function ComplianceTab({ stockItems, inspections }: Props) {
  const [incidents, setIncidents] = useState<ImsIncidentRecord[]>([]);
  const [correctiveActions, setCorrActions] = useState<ImsCorrectiveActionRecord[]>([]);
  const [risks, setRisks] = useState<ImsRiskRecord[]>([]);

  // Subscribe to quality incidents (non-conformance, quality category)
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.IMS_INCIDENTS),
      where("category", "==", "quality"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setIncidents(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImsIncidentRecord))
      );
    }, () => setIncidents([]));
  }, []);

  // Subscribe to quality corrective actions
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS),
      where("domain", "==", "quality"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setCorrActions(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImsCorrectiveActionRecord))
      );
    }, () => setCorrActions([]));
  }, []);

  // Subscribe to quality risks
  useEffect(() => {
    const q = query(
      collection(db, COLLECTIONS.IMS_RISK_REGISTER),
      where("domain", "==", "quality"),
      orderBy("createdAt", "desc")
    );
    return onSnapshot(q, (snap) => {
      setRisks(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as ImsRiskRecord))
      );
    }, () => setRisks([]));
  }, []);

  // Computed metrics
  const nonConformingInspections = useMemo(
    () => inspections.filter((i) => i.decision === "rejected" || i.decision === "conditional"),
    [inspections]
  );

  const openIncidents = useMemo(
    () => incidents.filter((i) => i.status !== "closed"),
    [incidents]
  );

  const openCAPAs = useMemo(
    () => correctiveActions.filter((ca) => ca.status !== "closed"),
    [correctiveActions]
  );

  const highRisks = useMemo(
    () => risks.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical"),
    [risks]
  );

  const formatDate = (value?: { toDate?: () => Date }) => {
    if (!value?.toDate) return "-";
    return value.toDate().toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const severityBadge = (severity?: string) => {
    switch (severity) {
      case "critical":
        return "bg-red-500/20 text-red-400 border-red-500/30";
      case "high":
        return "bg-orange-500/20 text-orange-400 border-orange-500/30";
      case "medium":
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const statusBadge = (status?: string) => {
    switch (status) {
      case "closed":
        return "bg-green-500/20 text-green-400 border-green-500/30";
      case "in_progress":
      case "investigating":
      case "actions_required":
        return "bg-blue-500/20 text-blue-400 border-blue-500/30";
      default:
        return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    }
  };

  return (
    <div className="space-y-6">
      {/* Compliance KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <FileWarning className="h-4 w-4 text-amber-400" />
              Non-Conformances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{nonConformingInspections.length}</div>
            <p className="text-xs text-muted-foreground">
              rejected or conditional goods inspections
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="h-4 w-4 text-red-400" />
              Open Quality Incidents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-400">{openIncidents.length}</div>
            <p className="text-xs text-muted-foreground">
              {incidents.length} total quality incidents
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ClipboardCheck className="h-4 w-4 text-blue-400" />
              Open CAPAs
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{openCAPAs.length}</div>
            <p className="text-xs text-muted-foreground">
              corrective/preventive actions in progress
            </p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <ShieldAlert className="h-4 w-4 text-orange-400" />
              High/Critical Risks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-400">{highRisks.length}</div>
            <p className="text-xs text-muted-foreground">
              in quality risk register
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Quality Incidents */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-400" />
            Quality Incidents (Procurement)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No quality incidents recorded. Guardian will auto-create incidents from
              non-conforming goods inspections.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Incident #</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidents.slice(0, 10).map((inc) => (
                  <TableRow key={inc.id}>
                    <TableCell className="font-mono text-sm">
                      {inc.incidentNumber || inc.id.slice(0, 8)}
                    </TableCell>
                    <TableCell>{inc.incidentType || "-"}</TableCell>
                    <TableCell>
                      <Badge className={severityBadge(inc.severity)}>
                        {inc.severity || "unset"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs truncate">
                      {inc.description || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadge(inc.status)}>
                        {inc.status || "draft"}
                      </Badge>
                    </TableCell>
                    <TableCell>{formatDate(inc.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Corrective Actions */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ClipboardCheck className="h-5 w-5 text-blue-400" />
            Quality Corrective Actions (CAPA)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {correctiveActions.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No corrective actions yet. Guardian tracks CAPAs from quality incidents and
              non-conformances.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {correctiveActions.slice(0, 10).map((ca) => (
                  <TableRow key={ca.id}>
                    <TableCell className="font-medium max-w-xs truncate">
                      {ca.title || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={severityBadge(ca.priority)}>
                        {ca.priority || "normal"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {ca.sourceLabel || ca.sourceType || "-"}
                    </TableCell>
                    <TableCell>{ca.ownerName || "-"}</TableCell>
                    <TableCell>
                      <Badge className={statusBadge(ca.status)}>
                        {ca.status || "open"}
                      </Badge>
                    </TableCell>
                    <TableCell>{ca.dueDate || "-"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Supply Chain Risk Register */}
      <Card className="bg-card/50 backdrop-blur-lg border-border/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Supply Chain Risk Register
          </CardTitle>
        </CardHeader>
        <CardContent>
          {risks.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No quality risks registered. Guardian manages supply chain risks from incidents,
              audits, and goods inspections.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Risk/Opportunity</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Risk Level</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {risks.slice(0, 10).map((risk) => (
                  <TableRow key={risk.id}>
                    <TableCell className="font-medium max-w-xs truncate">
                      {risk.title || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{risk.entryType || "risk"}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={severityBadge(risk.riskLevel)}>
                        {risk.riskLevel || "unassessed"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {risk.source?.label || risk.source?.type || "-"}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadge(risk.status)}>
                        {risk.status || "open"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Non-Conforming Goods Summary */}
      {nonConformingInspections.length > 0 && (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileWarning className="h-5 w-5 text-amber-400" />
              Non-Conforming Goods Inspections
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>PO Number</TableHead>
                  <TableHead>Supplier</TableHead>
                  <TableHead>Decision</TableHead>
                  <TableHead>Corrective Action</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {nonConformingInspections.map((insp) => (
                  <TableRow key={insp.id}>
                    <TableCell className="font-medium">{insp.poNumber}</TableCell>
                    <TableCell>{insp.supplierName}</TableCell>
                    <TableCell>
                      <Badge
                        className={
                          insp.decision === "rejected"
                            ? "bg-red-500/20 text-red-400"
                            : "bg-amber-500/20 text-amber-400"
                        }
                      >
                        {insp.decision}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {insp.correctiveAction?.required ? (
                        <Badge className={statusBadge(insp.correctiveAction.status)}>
                          {insp.correctiveAction.status || "open"}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={
                          insp.status === "closed"
                            ? "bg-green-500/20 text-green-400"
                            : "bg-amber-500/20 text-amber-400"
                        }
                      >
                        {insp.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Guardian Integration Info */}
      <Card className="bg-card/50 backdrop-blur-lg border-primary/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle className="h-4 w-4 text-primary" />
            Guardian IMS Integration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground space-y-2">
            <p>
              Guardian monitors procurement quality through the IMS. The following automations are active:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Non-conforming goods inspections trigger quality incidents (INC-YYYY-NNNN)</li>
              <li>Rejected goods auto-create corrective actions (CAPA) in the quality domain</li>
              <li>Recurring supplier quality issues elevate to supply chain risk register entries</li>
              <li>All procurement CAPAs are tracked to closure with verification evidence</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
