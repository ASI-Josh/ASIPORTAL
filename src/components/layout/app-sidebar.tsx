"use client";

import Link from "next/link";
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
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppLogo } from "@/components/app-logo";
import { cn } from "@/lib/utils";

const menuItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/dashboard/crm", label: "CRM", icon: KanbanSquare },
  { href: "/dashboard/bookings", label: "Bookings", icon: Briefcase },
  { href: "/dashboard/inspections", label: "Inspections", icon: ClipboardCheck },
  { href: "/dashboard/calendar", label: "Calendar", icon: Calendar },
  { href: "/dashboard/films", label: "Film Mgmt", icon: FileText },
  { href: "/dashboard/reports", label: "Reports", icon: FileText },
];

export function AppSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();

  const isActive = (href: string) => {
    if (href === "/dashboard") {
      return pathname === href;
    }
    return pathname.startsWith(href);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <AppLogo />
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
