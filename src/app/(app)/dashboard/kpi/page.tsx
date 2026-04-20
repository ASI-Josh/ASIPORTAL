"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type {
  FuelRecord,
  EmissionsReport,
  TelemetryReading,
  MaintenanceEvent,
  ZebEnergyRecord,
  KpiSnapshot,
  ContactOrganization,
  SatisfactionSurvey,
} from "@/lib/types";

import { KpiOverview } from "./overview";
import { FuelEnergyTab } from "./fuel-energy";
import { EmissionsEsgTab } from "./emissions-esg";
import { TelemetryTab } from "./telemetry";
import { MaintenanceTab } from "./maintenance";
import { ZebTab } from "./zeb";
import { SatisfactionTab } from "./satisfaction";

export default function KpiPage() {
  const [fuelRecords, setFuelRecords] = useState<FuelRecord[]>([]);
  const [emissionsReports, setEmissionsReports] = useState<EmissionsReport[]>([]);
  const [telemetryReadings, setTelemetryReadings] = useState<TelemetryReading[]>([]);
  const [maintenanceEvents, setMaintenanceEvents] = useState<MaintenanceEvent[]>([]);
  const [zebRecords, setZebRecords] = useState<ZebEnergyRecord[]>([]);
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([]);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);
  const [surveys, setSurveys] = useState<SatisfactionSurvey[]>([]);
  const [selectedOrgId, setSelectedOrgId] = useState<string>("all");

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.FUEL_RECORDS), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setFuelRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FuelRecord, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.EMISSIONS_REPORTS), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setEmissionsReports(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<EmissionsReport, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.TELEMETRY_READINGS), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setTelemetryReadings(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<TelemetryReading, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.MAINTENANCE_EVENTS), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setMaintenanceEvents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<MaintenanceEvent, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.ZEB_ENERGY_RECORDS), orderBy("createdAt", "desc"));
    return onSnapshot(q, (snap) => {
      setZebRecords(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ZebEnergyRecord, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.KPI_SNAPSHOTS), orderBy("generatedAt", "desc"));
    return onSnapshot(q, (snap) => {
      setSnapshots(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<KpiSnapshot, "id">) })));
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS));
    return onSnapshot(q, (snap) => {
      setOrganizations(
        snap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<ContactOrganization, "id">) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      );
    });
  }, []);

  useEffect(() => {
    const q = query(collection(db, COLLECTIONS.SATISFACTION_SURVEYS), orderBy("submittedAt", "desc"));
    return onSnapshot(q, (snap) => {
      setSurveys(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SatisfactionSurvey, "id">) })));
    });
  }, []);

  // Global org filter — filters all data before passing to tabs
  const filterByOrg = <T extends { organizationId?: string }>(data: T[]) => {
    if (selectedOrgId === "all") return data;
    return data.filter((d) => d.organizationId === selectedOrgId);
  };

  const filteredFuel = useMemo(() => filterByOrg(fuelRecords), [fuelRecords, selectedOrgId]);
  const filteredEmissions = useMemo(() => filterByOrg(emissionsReports), [emissionsReports, selectedOrgId]);
  const filteredTelemetry = useMemo(() => filterByOrg(telemetryReadings), [telemetryReadings, selectedOrgId]);
  const filteredMaintenance = useMemo(() => filterByOrg(maintenanceEvents), [maintenanceEvents, selectedOrgId]);
  const filteredZeb = useMemo(() => filterByOrg(zebRecords), [zebRecords, selectedOrgId]);
  const filteredSurveys = useMemo(() => filterByOrg(surveys), [surveys, selectedOrgId]);

  // Client orgs only (exclude ASI internal)
  const clientOrgs = useMemo(() => {
    return organizations.filter((o) => o.category !== "asi_staff" && o.category !== "supplier_vendor");
  }, [organizations]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-3xl font-headline font-bold tracking-tight">
            KPI Traceability
          </h2>
          <p className="text-muted-foreground">
            {selectedOrgId === "all"
              ? "ASI Australia total impact across all clients."
              : `Filtered to ${organizations.find((o) => o.id === selectedOrgId)?.name || "selected organisation"}.`}
          </p>
        </div>
        <Select value={selectedOrgId} onValueChange={setSelectedOrgId}>
          <SelectTrigger className="w-[260px]">
            <SelectValue placeholder="All Organisations" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Organisations (ASI Total)</SelectItem>
            {clientOrgs.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fuel-energy">Fuel &amp; Energy</TabsTrigger>
          <TabsTrigger value="emissions">Emissions / ESG</TabsTrigger>
          <TabsTrigger value="telemetry">HVAC / Telemetry</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="zeb">ZEB Integration</TabsTrigger>
          <TabsTrigger value="satisfaction">Satisfaction</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <KpiOverview
            fuelRecords={filteredFuel}
            emissionsReports={filteredEmissions}
            telemetryReadings={filteredTelemetry}
            maintenanceEvents={filteredMaintenance}
            snapshots={snapshots}
            organizations={organizations}
            surveys={filteredSurveys}
          />
        </TabsContent>

        <TabsContent value="fuel-energy">
          <FuelEnergyTab
            fuelRecords={filteredFuel}
            organizations={organizations}
            snapshots={snapshots}
          />
        </TabsContent>

        <TabsContent value="emissions">
          <EmissionsEsgTab
            emissionsReports={filteredEmissions}
            fuelRecords={filteredFuel}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="telemetry">
          <TelemetryTab
            telemetryReadings={filteredTelemetry}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="maintenance">
          <MaintenanceTab
            maintenanceEvents={filteredMaintenance}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="zeb">
          <ZebTab
            zebRecords={filteredZeb}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="satisfaction">
          <SatisfactionTab
            surveys={filteredSurveys}
            organizations={clientOrgs}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
