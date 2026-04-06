"use client";

import { useEffect, useState } from "react";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
} from "@/lib/types";

import { KpiOverview } from "./overview";
import { FuelEnergyTab } from "./fuel-energy";
import { EmissionsEsgTab } from "./emissions-esg";
import { TelemetryTab } from "./telemetry";
import { MaintenanceTab } from "./maintenance";
import { ZebTab } from "./zeb";

export default function KpiPage() {
  const [fuelRecords, setFuelRecords] = useState<FuelRecord[]>([]);
  const [emissionsReports, setEmissionsReports] = useState<EmissionsReport[]>([]);
  const [telemetryReadings, setTelemetryReadings] = useState<TelemetryReading[]>([]);
  const [maintenanceEvents, setMaintenanceEvents] = useState<MaintenanceEvent[]>([]);
  const [zebRecords, setZebRecords] = useState<ZebEnergyRecord[]>([]);
  const [snapshots, setSnapshots] = useState<KpiSnapshot[]>([]);
  const [organizations, setOrganizations] = useState<ContactOrganization[]>([]);

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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">
          KPI Traceability
        </h2>
        <p className="text-muted-foreground">
          Full measurement and traceability framework across fuel, emissions, telemetry, maintenance, and ZEB readiness.
        </p>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fuel-energy">Fuel &amp; Energy</TabsTrigger>
          <TabsTrigger value="emissions">Emissions / ESG</TabsTrigger>
          <TabsTrigger value="telemetry">HVAC / Telemetry</TabsTrigger>
          <TabsTrigger value="maintenance">Maintenance</TabsTrigger>
          <TabsTrigger value="zeb">ZEB Integration</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <KpiOverview
            fuelRecords={fuelRecords}
            emissionsReports={emissionsReports}
            telemetryReadings={telemetryReadings}
            maintenanceEvents={maintenanceEvents}
            snapshots={snapshots}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="fuel-energy">
          <FuelEnergyTab
            fuelRecords={fuelRecords}
            organizations={organizations}
            snapshots={snapshots}
          />
        </TabsContent>

        <TabsContent value="emissions">
          <EmissionsEsgTab
            emissionsReports={emissionsReports}
            fuelRecords={fuelRecords}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="telemetry">
          <TelemetryTab
            telemetryReadings={telemetryReadings}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="maintenance">
          <MaintenanceTab
            maintenanceEvents={maintenanceEvents}
            organizations={organizations}
          />
        </TabsContent>

        <TabsContent value="zeb">
          <ZebTab
            zebRecords={zebRecords}
            organizations={organizations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
