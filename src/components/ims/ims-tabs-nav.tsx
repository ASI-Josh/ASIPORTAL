"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { label: "IMS Filing", href: "/dashboard/ims" },
  { label: "Doc Manager", href: "/dashboard/ims/doc-manager" },
  { label: "Doc Manager Chat", href: "/dashboard/ims/doc-manager/chat" },
  { label: "IMS Auditor", href: "/dashboard/ims/ims-auditor" },
];

export function ImsTabsNav() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard/ims") {
      return pathname === href;
    }
    if (!pathname) return false;
    if (href === "/dashboard/ims/doc-manager") {
      return (
        pathname === href ||
        (pathname.startsWith(`${href}/`) && !pathname.startsWith(`${href}/chat`))
      );
    }
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
