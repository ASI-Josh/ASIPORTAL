"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";
import { Input } from "../ui/input";

export function AppHeader() {
    const pathname = usePathname();
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
       <div className="relative flex-1 md:grow-0">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search..."
            className="w-full rounded-lg bg-muted pl-8 md:w-[200px] lg:w-[320px]"
          />
        </div>
    </header>
  );
}
