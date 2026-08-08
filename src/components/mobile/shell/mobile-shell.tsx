import type { ReactNode } from "react";
import { MobileTabBar } from "./mobile-tab-bar";
import type { MobileShellUser } from "./mobile-more-sheet";
import { DemoModeBanner } from "@/components/shell/demo-mode-banner";

/**
 * Phone app frame: content above a fixed bottom tab bar. Pages own their own
 * sticky headers (MobilePageHeader); the shell stays chromeless so full-bleed
 * screens (maps) can use the whole viewport.
 */
export function MobileShell({
  instanceName,
  user,
  demoLocked,
  children,
}: {
  instanceName: string;
  user: MobileShellUser;
  demoLocked: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col">
      {demoLocked && <DemoModeBanner />}
      <main className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <MobileTabBar instanceName={instanceName} user={user} />
    </div>
  );
}
