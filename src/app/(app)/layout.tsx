"use client";

import { useEffect, useState } from "react";
import { AppHeader } from "@/components/layout/app-header";
import { AppSidebar } from "@/components/layout/app-sidebar";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { JobsProvider } from "@/contexts/JobsContext";
import { NotificationsProvider } from "@/contexts/NotificationsContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, updateUserProfile } = useAuth();
  const { toast } = useToast();
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [profilePhone, setProfilePhone] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  const isStaff = user?.role === "admin" || user?.role === "technician";
  const needsProfile =
    Boolean(isStaff) &&
    Boolean(user) &&
    (!user?.phone || !user?.name || user.name === "User");

  useEffect(() => {
    if (!user) return;
    if (!needsProfile) {
      setProfileOpen(false);
      return;
    }
    setProfileName(user.name || "");
    setProfilePhone(user.phone || "");
    setProfileOpen(true);
  }, [needsProfile, user]);

  const handleSaveProfile = async () => {
    const name = profileName.trim();
    const phone = profilePhone.trim();
    if (!name || !phone) return;
    setSavingProfile(true);
    try {
      await updateUserProfile({ name, phone });
      toast({
        title: "Profile updated",
        description: "Your staff contact details have been saved.",
      });
      setProfileOpen(false);
    } catch (error: any) {
      toast({
        title: "Unable to update profile",
        description: error.message || "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const canSaveProfile = profileName.trim() !== "" && profilePhone.trim() !== "";

  return (
    <ProtectedRoute>
      <JobsProvider>
        <NotificationsProvider>
          <SidebarProvider>
            <AppSidebar />
            <SidebarInset>
              <AppHeader />
              <main className="flex-1 p-4 md:p-6 lg:p-8">
                {children}
              </main>
            </SidebarInset>
            <Dialog
              open={profileOpen}
              onOpenChange={(open) => {
                if (!open && needsProfile) return;
                setProfileOpen(open);
              }}
            >
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Complete your staff profile</DialogTitle>
                  <DialogDescription>
                    Add your contact details so we can assign jobs and keep records up to date.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="staff-name">Full name</Label>
                    <Input
                      id="staff-name"
                      value={profileName}
                      onChange={(event) => setProfileName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="staff-phone">Phone number</Label>
                    <Input
                      id="staff-phone"
                      value={profilePhone}
                      onChange={(event) => setProfilePhone(event.target.value)}
                    />
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button
                      onClick={handleSaveProfile}
                      disabled={!canSaveProfile || savingProfile}
                    >
                      {savingProfile ? "Saving..." : "Save details"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </SidebarProvider>
        </NotificationsProvider>
      </JobsProvider>
    </ProtectedRoute>
  );
}
