import { cn } from "@/lib/utils";
import type { SVGProps } from "react";

export function AppLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 20"
      className={cn("h-8 w-auto", className)}
      {...props}
    >
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style={{ stopColor: "hsl(var(--accent))" }} />
          <stop offset="100%" style={{ stopColor: "hsl(var(--primary))" }} />
        </linearGradient>
      </defs>
      <text
        x="50"
        y="15"
        fontFamily="Space Grotesk, sans-serif"
        fontSize="20"
        fontWeight="bold"
        fill="url(#logo-gradient)"
        textAnchor="middle"
      >
        ASI PORTAL
      </text>
    </svg>
  );
}
