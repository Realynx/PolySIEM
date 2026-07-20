import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isLockedDemoMode } from "@/lib/demo/mode";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { getInstanceName, getOllamaConfig, isSetupCompleted } from "@/lib/settings";
import { ChatDock } from "@/components/chat/chat-dock";
import { NavigationProgress } from "@/components/shell/navigation-progress";
import { PrivacyProvider } from "@/components/privacy/privacy-provider";
import { SidebarNav } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { MobileShell } from "@/components/mobile/shell/mobile-shell";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupCompleted())) redirect("/setup");
  const { user } = await requirePageUser();
  const [instanceName, aiConfig] = await Promise.all([
    getInstanceName(),
    getOllamaConfig(),
  ]);
  const demoLocked = isLockedDemoMode();
  const mobile = await isMobileView();
  // Shell identity (instance name, own username) leaks into every screenshot,
  // so it goes through the same display anonymizer as page data.
  const shellIdentity = await anonymizeForDisplay({
    instanceName,
    username: user.username,
    displayName: user.displayName,
  });
  const shellUser = {
    username: shellIdentity.username,
    displayName: shellIdentity.displayName,
    role: user.role,
  };

  if (mobile) {
    return (
      <PrivacyProvider
        settings={{
          anonymousMode: user.anonymousMode,
          shieldOnCapture: user.shieldOnCapture,
          shieldOnBlur: user.shieldOnBlur,
        }}
      >
        <MobileShell
          instanceName={shellIdentity.instanceName}
          user={shellUser}
          demoLocked={demoLocked}
        >
          {children}
        </MobileShell>
        {aiConfig.enabled && <ChatDock />}
      </PrivacyProvider>
    );
  }

  return (
    <PrivacyProvider
      settings={{
        anonymousMode: user.anonymousMode,
        shieldOnCapture: user.shieldOnCapture,
        shieldOnBlur: user.shieldOnBlur,
      }}
    >
      <div className="flex min-h-svh">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r bg-sidebar md:block">
          <SidebarNav instanceName={shellIdentity.instanceName} isAdmin={user.role === "ADMIN"} />
        </aside>
        <div className="flex min-w-0 flex-1 flex-col md:pl-60">
          <NavigationProgress />
          <Topbar instanceName={shellIdentity.instanceName} user={shellUser} />
          {demoLocked && (
            <div className="flex items-center justify-center gap-2 border-b border-violet-500/20 bg-violet-500/10 px-4 py-2 text-center text-xs font-medium text-violet-700 dark:text-violet-300">
              <LockKeyhole className="size-3.5" /> Public demo — exploration and
              mock AI are enabled; persistent changes are locked.
            </div>
          )}
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
        {aiConfig.enabled && <ChatDock />}
      </div>
    </PrivacyProvider>
  );
}
