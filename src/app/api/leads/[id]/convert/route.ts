import { NextRequest, NextResponse } from "next/server";
import { admin } from "@/lib/firebaseAdmin";
import { requireUserId } from "@/lib/server/firebaseAuth";
import { COLLECTIONS } from "@/lib/collections";
import type { Lead, Opportunity } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await requireUserId(req);
    const { id } = await params;
    const body = await req.json() as {
      organizationId?: string;
      createOrganization?: boolean;
      wonReason?: string;
    };

    const db = admin.firestore();
    const leadRef = db.collection(COLLECTIONS.LEADS).doc(id);
    const leadSnap = await leadRef.get();
    if (!leadSnap.exists) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

    const lead = { id: leadSnap.id, ...leadSnap.data() } as Lead;
    const now = admin.firestore.FieldValue.serverTimestamp();
    let organizationId = body.organizationId || lead.existingOrganizationId;

    // Create organization if needed
    if (!organizationId && body.createOrganization !== false) {
      const primaryContact = lead.contacts.find((c) => c.isPrimary) || lead.contacts[0];
      const orgPayload = {
        name: lead.companyName,
        website: lead.companyWebsite,
        sector: lead.sector,
        createdAt: now,
        updatedAt: now,
        createdBy: userId,
        sourceLeadId: id,
      };
      const orgRef = await db.collection(COLLECTIONS.CONTACT_ORGANIZATIONS).add(orgPayload);
      organizationId = orgRef.id;

      // Create contact if we have one
      if (primaryContact?.name) {
        await db.collection(COLLECTIONS.ORGANIZATION_CONTACTS).add({
          organizationId,
          name: primaryContact.name,
          title: primaryContact.title,
          email: primaryContact.email,
          phone: primaryContact.phone,
          linkedInUrl: primaryContact.linkedInUrl,
          isPrimary: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // Create opportunity record
    const opportunity: Omit<Opportunity, "id"> = {
      leadId: id,
      organizationId: organizationId || "",
      estimatedAnnualValue: lead.estimatedValue || 0,
      services: lead.estimatedServices,
      contractType: "one-off",
      wonDate: new Date().toISOString().split("T")[0],
      wonReason: body.wonReason,
      convertedJobIds: [],
      createdAt: now as unknown as import("firebase/firestore").Timestamp,
      updatedAt: now as unknown as import("firebase/firestore").Timestamp,
    };
    const oppRef = await db.collection(COLLECTIONS.OPPORTUNITIES).add(opportunity);

    // Update lead to won stage
    await leadRef.set({
      stage: "won",
      stageEnteredAt: new Date().toISOString(),
      existingOrganizationId: organizationId,
      isExistingClient: true,
      stageHistory: admin.firestore.FieldValue.arrayUnion({
        fromStage: lead.stage,
        toStage: "won",
        changedAt: new Date().toISOString(),
        changedBy: userId,
        reason: body.wonReason || "Converted to opportunity",
      }),
      updatedAt: now,
    }, { merge: true });

    return NextResponse.json({
      opportunityId: oppRef.id,
      organizationId,
      leadId: id,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Convert failed." }, { status: 400 });
  }
}
