import type { ReactNode } from "react";

import { MeetingsTabsNav } from "@/components/meetings/meetings-tabs-nav";

type MeetingsLayoutProps = {
  children: ReactNode;
};

export default function MeetingsLayout({ children }: MeetingsLayoutProps) {
  return (
    <div className="space-y-6">
      <MeetingsTabsNav />
      {children}
    </div>
  );
}
