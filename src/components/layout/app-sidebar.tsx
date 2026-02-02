"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  KanbanSquare,
  Briefcase,
  ClipboardCheck,
  Calendar,
  FileText,
  Settings,
  LogOut,
  User as UserIcon,
  Users,
  PanelLeftClose,
  PanelLeft,
  Building2,
  ClipboardList,
  GitBranch,
  Wrench,
  Trash2,
  Layers,
  Bot,
  MessagesSquare,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const adminMenuItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/crm", label: "CRM", icon: KanbanSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: Briefcase },
  { href: "/dashboard/job-lifecycle", label: "Job Lifecycle", icon: GitBranch },
  { href: "/dashboard/inspections", label: "Inspections", icon: ClipboardCheck },
  { href: "/dashboard/goods-received", label: "Stock Control", icon: ClipboardCheck },
  { href: "/dashboard/daily-prestart", label: "Daily Prestart", icon: ClipboardCheck },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/contacts", label: "Contacts", icon: Building2 },
  { href: "/dashboard/films", label: "Film Management", icon: FileText },
  { href: "/dashboard/works-register", label: "Works Register", icon: ClipboardList },
  { href: "/dashboard/ims", label: "ASI IMS", icon: Layers },
  { href: "/dashboard/agent-hub", label: "Agent Hub", icon: Bot },
  { href: "/dashboard/agent-community", label: "Agent Community", icon: MessagesSquare },
  { href: "/dashboard/recycle-bin", label: "Recycle Bin", icon: Trash2 },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { state, toggleSidebar, isMobile } = useSidebar();
  const menuItems = user
    ? {
        admin: adminMenuItems,
        technician: [
          { href: "/technician", label: "Technician Dashboard", icon: Wrench },
          { href: "/dashboard/daily-prestart", label: "Daily Prestart", icon: ClipboardCheck },
          { href: "/dashboard/ims", label: "ASI IMS", icon: Layers },
        ],
        client: [
          { href: "/client", label: "Dashboard", icon: LayoutDashboard },
          { href: "/client/bookings", label: "Bookings", icon: Briefcase },
          { href: "/client/inspections", label: "Inspections", icon: ClipboardCheck },
          { href: "/client/works-register", label: "Works Register", icon: ClipboardList },
          { href: "/client/contacts", label: "ASI Contacts", icon: Users },
        ],
        contractor: [
          { href: "/contractor", label: "Contractor Portal", icon: Building2 },
        ],
      }[user.role] || adminMenuItems
    : adminMenuItems;

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="p-4 space-y-3">
        <div className="flex items-center justify-center group-data-[collapsible=icon]:justify-between">
          <span className="text-xl font-bold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent group-data-[collapsible=icon]:hidden">
            ASI PORTAL
          </span>
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent absolute right-2 top-4"
            >
              {state === "expanded" ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarMenu>
          {menuItems.map((item) => (
            <SidebarMenuItem key={item.label}>
              <Link href={item.href}>
                <SidebarMenuButton
                  isActive={isActive(item.href)}
                  tooltip={{ children: item.label }}
                >
                  <item.icon />
                  <span>{item.label}</span>
                </SidebarMenuButton>
              </Link>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarContent>
      <SidebarFooter>
        {/* ASI Logo - centered above settings */}
        <div className="flex justify-center py-4 group-data-[collapsible=icon]:py-2">
          <Link href="/dashboard">
            <Image
              src="/logos/ASI BRANDING - OFFICIAL MAIN.png"
              alt="ASI Logo"
              width={600}
              height={240}
              className="h-36 w-auto group-data-[collapsible=icon]:h-10"
              priority
            />
          </Link>
        </div>
        <SidebarMenu>
            <SidebarMenuItem>
        <Link href="/dashboard/settings">
          <SidebarMenuButton isActive={isActive('/dashboard/settings')} tooltip={{ children: 'Settings' }}>
            <Settings />
            <span>Settings</span>
          </SidebarMenuButton>
        </Link>
            </SidebarMenuItem>
        </SidebarMenu>
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button className={cn(
                    "flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-colors hover:bg-sidebar-accent focus-visible:ring-2",
                    "group-data-[collapsible=icon]:size-10 group-data-[collapsible=icon]:p-2 group-data-[collapsible=icon]:justify-center"
                )}>
                    <Avatar className="h-8 w-8">
                        <AvatarImage src={user?.avatarUrl} alt={user?.name} />
                        <AvatarFallback>{user?.name?.charAt(0) || 'U'}</AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col truncate group-data-[collapsible=icon]:hidden">
                        <span className="font-semibold">{user?.name}</span>
                        <span className="text-xs text-sidebar-foreground/70">{user?.email}</span>
                    </div>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-56">
                <DropdownMenuLabel>{user?.name}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>
                    <UserIcon className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                    <Link href="/dashboard/settings">
                        <Settings className="mr-2 h-4 w-4" />
                        <span>Settings</span>
                    </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
