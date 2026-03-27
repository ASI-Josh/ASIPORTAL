"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Shield, ShieldCheck, AlertTriangle, FileText, ClipboardCheck } from "lucide-react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { PrestartCheck, Inspection, ContactOrganization } from "@/lib/types";

interface OHSMetrics {
  completedPrestarts: number;
  totalPrestarts: number;
  prestartComplianceRate: number;
  vehicleSafetyPassRate: number;
  openPrestartIssues: number;
  jobsWithCompletedRA: number;
  totalActiveJobs: number;
  raComplianceRate: number;
  highCriticalHazards: number;
  residualHighCritical: number;
}

interface OperationsMetrics {
  complianceRate: number;
  jobsCompleted: number;
}

interface Props {
  ohsMetrics: OHSMetrics;
  operations: OperationsMetrics;
  selectedOrgName?: string;
}

interface ImsStats {
  openIncidents: number;
  totalIncidents: number;
  openCAPAs: number;
  totalCAPAs: number;
  openRisks: number;
  highRisks: number;
  totalDocuments: number;
}

export function HSEQCompliance({ ohsMetrics, operations, selectedOrgName }: Props) {
  const [ims, setIms] = useState<ImsStats>({
    openIncidents: 0,
    totalIncidents: 0,
    openCAPAs: 0,
    totalCAPAs: 0,
    openRisks: 0,
    highRisks: 0,
    totalDocuments: 0,
  });

  useEffect(() => {
    const unsubFns: (() => void)[] = [];

    // Incidents
    const incQ = query(collection(db, COLLECTIONS.IMS_INCIDENTS), orderBy("createdAt", "desc"));
    unsubFns.push(
      onSnapshot(incQ, (snap) => {
        const docs = snap.docs.map((d) => d.data());
        setIms((prev) => ({
          ...prev,
          totalIncidents: docs.length,
          openIncidents: docs.filter((d) => d.status !== "closed").length,
        }));
      }, () => {})
    );

    // Corrective Actions
    const caQ = query(collection(db, COLLECTIONS.IMS_CORRECTIVE_ACTIONS), orderBy("createdAt", "desc"));
    unsubFns.push(
      onSnapshot(caQ, (snap) => {
        const docs = snap.docs.map((d) => d.data());
        setIms((prev) => ({
          ...prev,
          totalCAPAs: docs.length,
          openCAPAs: docs.filter((d) => d.status !== "closed").length,
        }));
      }, () => {})
    );

    // Risk Register
    const riskQ = query(collection(db, COLLECTIONS.IMS_RISK_REGISTER), orderBy("createdAt", "desc"));
    unsubFns.push(
      onSnapshot(riskQ, (snap) => {
        const docs = snap.docs.map((d) => d.data());
        setIms((prev) => ({
          ...prev,
          openRisks: docs.filter((d) => d.status !== "closed").length,
          highRisks: docs.filter((d) => d.riskLevel === "high" || d.riskLevel === "critical").length,
        }));
      }, () => {})
    );

    // IMS Documents
    const docsQ = query(collection(db, COLLECTIONS.IMS_DOCUMENTS));
    unsubFns.push(
      onSnapshot(docsQ, (snap) => {
        setIms((prev) => ({ ...prev, totalDocuments: snap.size }));
      }, () => {})
    );

    return () => unsubFns.forEach((fn) => fn());
  }, []);

  return (
    <Card className="bg-card/50 backdrop-blur-lg border-border/20 overflow-hidden">
      <div className="px-6 py-3 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-transparent border-b border-emerald-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <span className="font-headline font-semibold text-sm text-emerald-400">
              HSEQ &amp; ISO 9001 Compliance
            </span>
            {selectedOrgName && (
              <span className="text-xs text-primary ml-2">— {selectedOrgName}</span>
            )}
          </div>
          <Link href="/dashboard/ims">
            <Button variant="ghost" size="sm" className="text-xs">
              Open IMS
            </Button>
          </Link>
        </div>
      </div>
      <CardContent>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {/* Vehicle Prestarts */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Vehicle Prestart</p>
            <div className="flex items-center justify-between text-sm">
              <span>Completed</span>
              <span className="font-medium">{ohsMetrics.completedPrestarts} / {ohsMetrics.totalPrestarts}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Compliance</span>
              <span className="font-medium">{ohsMetrics.prestartComplianceRate}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Safety pass rate</span>
              <span className="font-medium">{ohsMetrics.vehicleSafetyPassRate}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Open issues</span>
              <span className={`font-medium ${ohsMetrics.openPrestartIssues > 0 ? "text-red-400" : ""}`}>
                {ohsMetrics.openPrestartIssues}
              </span>
            </div>
          </div>

          {/* HSE Risk Assessments */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-orange-400">HSE Risk Assessments</p>
            <div className="flex items-center justify-between text-sm">
              <span>Completed</span>
              <span className="font-medium">{ohsMetrics.jobsWithCompletedRA} / {ohsMetrics.totalActiveJobs}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Compliance</span>
              <span className={`font-medium ${ohsMetrics.raComplianceRate < 100 ? "text-amber-400" : ""}`}>
                {ohsMetrics.raComplianceRate}%
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>High/critical hazards</span>
              <span className={`font-medium ${ohsMetrics.highCriticalHazards > 0 ? "text-red-400" : ""}`}>
                {ohsMetrics.highCriticalHazards}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Residual high risk</span>
              <span className={`font-medium ${ohsMetrics.residualHighCritical > 0 ? "text-red-400" : ""}`}>
                {ohsMetrics.residualHighCritical}
              </span>
            </div>
          </div>

          {/* IMS Document Control */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">IMS / Guardian</p>
            <div className="flex items-center justify-between text-sm">
              <span>Open incidents</span>
              <span className={`font-medium ${ims.openIncidents > 0 ? "text-red-400" : ""}`}>
                {ims.openIncidents}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Open CAPAs</span>
              <span className={`font-medium ${ims.openCAPAs > 0 ? "text-amber-400" : ""}`}>
                {ims.openCAPAs}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Risk register</span>
              <span className="font-medium">
                {ims.openRisks} open
                {ims.highRisks > 0 && <span className="text-red-400"> ({ims.highRisks} high)</span>}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>IMS documents</span>
              <span className="font-medium">{ims.totalDocuments}</span>
            </div>
          </div>

          {/* QA & Operations */}
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-purple-400">QA &amp; Operations</p>
            <div className="flex items-center justify-between text-sm">
              <span>QA compliance</span>
              <span className="font-medium">{operations.complianceRate.toFixed(0)}%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Jobs completed</span>
              <span className="font-medium">{operations.jobsCompleted}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Total incidents</span>
              <span className="font-medium">{ims.totalIncidents}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span>Total CAPAs</span>
              <span className="font-medium">{ims.totalCAPAs}</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
