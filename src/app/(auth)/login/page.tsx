import { redirect } from "next/navigation";
import { AppLogo } from "@/components/shell/app-logo";
import { getSession } from "@/lib/auth/session";
import { getPublicDemoConfig, isLockedDemoMode } from "@/lib/demo/mode";
import { getInstanceName, getSetupState } from "@/lib/settings";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const demo = isLockedDemoMode() ? getPublicDemoConfig() : null;
  const [setup, session, instanceName] = await Promise.all([
    getSetupState(),
    getSession(),
    getInstanceName(),
  ]);
  if (!setup.started) redirect("/setup");
  if (session) redirect(setup.completed ? "/" : "/setup");

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-primary-foreground/20">
            <AppLogo className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{instanceName}</h1>
          <p className="text-sm text-muted-foreground">Sign in to your homelab documentation</p>
        </div>
        <LoginForm
          demoCredentials={
            demo ? { username: demo.username, password: demo.password } : undefined
          }
        />
      </div>
    </main>
  );
}
