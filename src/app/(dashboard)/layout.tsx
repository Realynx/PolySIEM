import { redirect } from "next/navigation";
import { requirePageUser } from "@/lib/auth/guards";
import { isLockedDemoMode } from "@/lib/demo/mode";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { getInstanceName, getOllamaConfig, isSetupCompleted } from "@/lib/settings";
import { ChatDock } from "@/components/chat/chat-dock";
import { PrivacyProvider } from "@/components/privacy/privacy-provider";
import { SidebarNav } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";
import { MobileShell } from "@/components/mobile/shell/mobile-shell";
import { DemoModeBanner } from "@/components/shell/demo-mode-banner";

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
          <Topbar instanceName={shellIdentity.instanceName} user={shellUser} />
          {demoLocked && <DemoModeBanner />}
          <main className="flex-1 p-4 md:p-6">{children}</main>
        </div>
        {aiConfig.enabled && <ChatDock />}
      </div>
    </PrivacyProvider>
  );
}
