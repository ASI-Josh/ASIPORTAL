"use client";

import { usePathname, useRouter } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Search, Bell, Check } from "lucide-react";
import { Input } from "../ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useNotifications } from "@/contexts/NotificationsContext";
import type { Notification } from "@/lib/types";

export function AppHeader() {
    const pathname = usePathname();
    const router = useRouter();
    const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
    const getTitle = () => {
        const pathParts = pathname.split('/').filter(p => p);
        if (pathParts.length === 0) return 'Dashboard';
        const lastPart = pathParts[pathParts.length - 1];
        if (lastPart === 'dashboard' && pathParts.length > 1) {
             const secondToLast = pathParts[pathParts.length - 2];
             return secondToLast.charAt(0).toUpperCase() + secondToLast.slice(1);
        }
        if (lastPart === 'dashboard') return 'Dashboard';
        return lastPart.charAt(0).toUpperCase() + lastPart.slice(1);
    }

    const formatNotificationTime = (timestamp: any) => {
      if (!timestamp) return "Just now";
      const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
      return date.toLocaleString("en-AU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });
    };

    const handleNotificationClick = async (notification: Notification) => {
      if (!notification.read) {
        await markAsRead(notification.id);
      }
      if (notification.relatedEntityType === "job" && notification.relatedEntityId) {
        router.push(`/dashboard/jobs/${notification.relatedEntityId}`);
      }
    };
  return (
    <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-4 backdrop-blur-sm md:px-6">
      <div className="md:hidden">
        <SidebarTrigger />
      </div>
      <div className="flex-1">
        <h1 className="text-2xl font-headline font-bold bg-gradient-to-r from-accent to-primary bg-clip-text text-transparent">
          {getTitle()}
        </h1>
      </div>
      <div className="flex items-center gap-2">
        <div className="relative flex-1 md:grow-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="w-full rounded-lg bg-muted pl-8 md:w-[200px] lg:w-[320px]"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge className="absolute -right-1.5 -top-1.5 h-5 min-w-5 justify-center rounded-full px-1 text-xs">
                  {unreadCount}
                </Badge>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => void markAllAsRead()}
                disabled={unreadCount === 0}
              >
                <Check className="mr-1 h-3.5 w-3.5" />
                Mark all read
              </Button>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <DropdownMenuItem className="text-sm text-muted-foreground">
                No notifications yet.
              </DropdownMenuItem>
            ) : (
              notifications.slice(0, 8).map((notification) => (
                <DropdownMenuItem
                  key={notification.id}
                  onClick={() => void handleNotificationClick(notification)}
                  className={`flex flex-col items-start gap-1 ${
                    notification.read ? "opacity-70" : ""
                  }`}
                >
                  <span className="text-sm font-medium">{notification.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {notification.message}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {formatNotificationTime(notification.createdAt)}
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
