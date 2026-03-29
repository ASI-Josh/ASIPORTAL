"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "Meetings", href: "/dashboard/meetings" },
  { label: "Actions", href: "/dashboard/meetings/actions" },
  { label: "Templates", href: "/dashboard/meetings/templates" },
];

export function MeetingsTabsNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard/meetings") {
      return (
        pathname === href ||
        (!!pathname &&
          pathname.startsWith("/dashboard/meetings/") &&
          !pathname.startsWith("/dashboard/meetings/actions") &&
          !pathname.startsWith("/dashboard/meetings/templates"))
      );
    }
    if (!pathname) return false;
    return pathname.startsWith(href);
  };

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-border/40 bg-muted/30 p-2">
      {TABS.map((tab) => {
        const active = isActive(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
