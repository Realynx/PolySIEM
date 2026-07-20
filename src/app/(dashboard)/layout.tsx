import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isLockedDemoMode } from "@/lib/demo/mode";
import { getInstanceName, getOllamaConfig, isSetupCompleted } from "@/lib/settings";
import { ChatDock } from "@/components/chat/chat-dock";
import { NavigationProgress } from "@/components/shell/navigation-progress";
import { SidebarNav } from "@/components/shell/sidebar";
import { Topbar } from "@/components/shell/topbar";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await isSetupCompleted())) redirect("/setup");
  const { user } = await requirePageUser();
  const [instanceName, aiConfig] = await Promise.all([
    getInstanceName(),
    getOllamaConfig(),
  ]);
  const demoLocked = isLockedDemoMode();

  return (
    <div className="flex min-h-svh">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r bg-sidebar md:block">
        <SidebarNav instanceName={instanceName} isAdmin={user.role === "ADMIN"} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col md:pl-60">
        <NavigationProgress />
        <Topbar
          instanceName={instanceName}
          user={{ username: user.username, displayName: user.displayName, role: user.role }}
        />
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
  );
}
