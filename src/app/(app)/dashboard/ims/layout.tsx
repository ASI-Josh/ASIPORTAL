import type { ReactNode } from "react";

import { ImsTabsNav } from "@/components/ims/ims-tabs-nav";

type ImsLayoutProps = {
  children: ReactNode;
};

export default function ImsLayout({ children }: ImsLayoutProps) {
  return (
    <div className="space-y-6">
      <ImsTabsNav />
      {children}
    </div>
  );
}
