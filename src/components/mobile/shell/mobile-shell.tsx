import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";
import { NavigationProgress } from "@/components/shell/navigation-progress";
import { MobileTabBar } from "./mobile-tab-bar";
import type { MobileShellUser } from "./mobile-more-sheet";

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
      <NavigationProgress />
      {demoLocked && (
        <div className="flex items-center justify-center gap-2 border-b border-violet-500/20 bg-violet-500/10 px-4 py-2 text-center text-xs font-medium text-violet-700 dark:text-violet-300">
          <LockKeyhole className="size-3.5 shrink-0" /> Public demo — persistent changes are locked.
        </div>
      )}
      <main className="flex flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
      <MobileTabBar instanceName={instanceName} user={user} />
    </div>
  );
}
