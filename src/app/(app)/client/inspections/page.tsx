"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { ClipboardCheck } from "lucide-react";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import { useAuth } from "@/contexts/AuthContext";
import type { Inspection } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const statusLabels: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved",
  converted: "Converted",
  rejected: "Rejected",
};

export default function ClientInspectionsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [inspections, setInspections] = useState<Inspection[]>([]);

  useEffect(() => {
    if (!user?.organizationId) return;
    const inspectionsQuery = query(
      collection(db, COLLECTIONS.INSPECTIONS),
      where("organizationId", "==", user.organizationId),
      orderBy("createdAt", "desc")
    );
    const unsubscribe = onSnapshot(
      inspectionsQuery,
      (snapshot) => {
        setInspections(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<Inspection, "id">),
          }))
        );
      },
      () => setInspections([])
    );
    return () => unsubscribe();
  }, [user?.organizationId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-3xl font-headline font-bold tracking-tight">Inspections & Quotes</h2>
        <p className="text-muted-foreground">
          Inspection reports and quotes are delivered by email. This area is read-only for reference.
        </p>
      </div>

      {inspections.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            <ClipboardCheck className="mx-auto h-10 w-10 mb-4 opacity-50" />
            No inspections found.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {inspections.map((inspection) => (
            <Card key={inspection.id} className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">{inspection.inspectionNumber}</CardTitle>
                  <Badge variant="secondary">
                    {statusLabels[inspection.status] || inspection.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
                <div>{inspection.clientName}</div>
                <div>
                  Vehicles: {inspection.vehicleReports?.length || 0}
                  {inspection.quote?.status && (
                    <span className="ml-2 text-xs uppercase tracking-wide">
                      quote: {inspection.quote.status}
                    </span>
                  )}
                </div>
                <div className="pt-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/client/inspections/${inspection.id}`)}
                  >
                    View inspection
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
