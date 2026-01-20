"use client";

import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Building2, Mail, Phone } from "lucide-react";
import { db } from "@/lib/firebaseClient";
import { COLLECTIONS } from "@/lib/collections";
import type { ContactOrganization, OrganizationContact } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClientContactsPage() {
  const [asiOrganizations, setAsiOrganizations] = useState<ContactOrganization[]>([]);
  const [contacts, setContacts] = useState<OrganizationContact[]>([]);

  useEffect(() => {
    const loadAsiOrgs = async () => {
      try {
        const orgsRef = collection(db, COLLECTIONS.CONTACT_ORGANIZATIONS);
        const [categorySnap, domainSnap] = await Promise.all([
          getDocs(query(orgsRef, where("category", "==", "asi_staff"))),
          getDocs(query(orgsRef, where("domains", "array-contains", "asi-australia.com.au"))),
        ]);
        const byId = new Map<string, ContactOrganization>();
        categorySnap.docs.forEach((docSnap) => {
          byId.set(docSnap.id, {
            id: docSnap.id,
            ...(docSnap.data() as Omit<ContactOrganization, "id">),
          });
        });
        domainSnap.docs.forEach((docSnap) => {
          if (!byId.has(docSnap.id)) {
            byId.set(docSnap.id, {
              id: docSnap.id,
              ...(docSnap.data() as Omit<ContactOrganization, "id">),
            });
          }
        });
        setAsiOrganizations(Array.from(byId.values()));
      } catch (error) {
        console.warn("Failed to load ASI contacts:", error);
        setAsiOrganizations([]);
      }
    };
    loadAsiOrgs();
  }, []);

  useEffect(() => {
    if (asiOrganizations.length === 0) {
      setContacts([]);
      return;
    }
    const orgIds = asiOrganizations.map((org) => org.id).slice(0, 10);
    const contactsQuery = query(
      collection(db, COLLECTIONS.ORGANIZATION_CONTACTS),
      where("organizationId", "in", orgIds)
    );
    const unsubscribe = onSnapshot(
      contactsQuery,
      (snapshot) => {
        setContacts(
          snapshot.docs.map((docSnap) => ({
            id: docSnap.id,
            ...(docSnap.data() as Omit<OrganizationContact, "id">),
          }))
        );
      },
      () => setContacts([])
    );
    return () => unsubscribe();
  }, [asiOrganizations]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-3xl font-headline font-bold tracking-tight">ASI Contacts</h2>
        <p className="text-muted-foreground">
          Reach the ASI team for support, scheduling, and reporting.
        </p>
      </div>

      {contacts.length === 0 ? (
        <Card className="bg-card/50 backdrop-blur-lg border-border/20">
          <CardContent className="p-10 text-center text-muted-foreground">
            No ASI contacts available yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {contacts.map((contact) => (
            <Card key={contact.id} className="bg-card/50 backdrop-blur-lg border-border/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base">
                  {contact.firstName} {contact.lastName}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  {contact.jobTitle || "ASI Team"}
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4" />
                  {contact.email}
                </div>
                {(contact.mobile || contact.phone) && (
                  <div className="flex items-center gap-2">
                    <Phone className="h-4 w-4" />
                    {contact.mobile || contact.phone}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
