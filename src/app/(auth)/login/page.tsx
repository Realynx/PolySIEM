import { redirect } from "next/navigation";
import { AppLogo } from "@/components/shell/app-logo";
import { getSession } from "@/lib/auth/session";
import { getPublicDemoConfig, isLockedDemoMode } from "@/lib/demo/mode";
import { getInstanceName, getSetupState } from "@/lib/settings";
import { LoginForm } from "./login-form";
import { randomSplash } from "./splashes";

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
  const splash = randomSplash();

  return (
    <main className="relative flex min-h-svh items-center justify-center overflow-hidden bg-muted/40 p-4">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="login-blob login-blob-1" />
        <div className="login-blob login-blob-2" />
        <div className="login-blob login-blob-3" />
      </div>
      <div className="relative w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="login-logo-badge login-rise flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground ring-1 ring-primary-foreground/20">
            <AppLogo className="size-8" />
          </div>
          <div className="login-rise login-rise-1">
            <h1 className="text-2xl font-semibold tracking-tight">{instanceName}</h1>
            <p className="text-sm text-muted-foreground">Sign in to your homelab documentation</p>
          </div>
        </div>
        <div className="login-rise login-rise-2">
          <LoginForm
            demoCredentials={
              demo ? { username: demo.username, password: demo.password } : undefined
            }
          />
        </div>
        <p
          aria-hidden
          className="login-rise login-rise-3 text-center text-xs italic text-muted-foreground/80"
        >
          {splash}
        </p>
      </div>
    </main>
  );
}
