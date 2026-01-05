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
  PanelLeftClose,
  PanelLeft,
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

const menuItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/crm", label: "CRM", icon: KanbanSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: Briefcase },
  { href: "/dashboard/inspections", label: "Inspections", icon: ClipboardCheck },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/films", label: "Film Management Hub", icon: FileText },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { state, toggleSidebar, isMobile } = useSidebar();

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
        <div className="flex items-center justify-between">
          <Link href="/dashboard" className="flex flex-col items-center gap-2 group-data-[collapsible=icon]:hidden">
            <Image
              src="/logos/ASI BRANDING - OFFICIAL MAIN.png"
              alt="ASI Logo"
              width={200}
              height={80}
              className="h-12 w-auto"
              priority
            />
            <span className="text-lg font-bold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
              ASI PORTAL
            </span>
          </Link>
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              className="h-8 w-8 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
            >
              {state === "expanded" ? (
                <PanelLeftClose className="h-4 w-4" />
              ) : (
                <PanelLeft className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>
        {/* Collapsed state - just show icon */}
        <Link href="/dashboard" className="hidden group-data-[collapsible=icon]:flex justify-center">
          <Image
            src="/logos/ASI BRANDING - OFFICIAL MAIN.png"
            alt="ASI Logo"
            width={40}
            height={40}
            className="h-8 w-auto"
            priority
          />
        </Link>
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
