"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  CircleAlert,
  DatabaseBackup,
  Loader2,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { AppLogo } from "@/components/shell/app-logo";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { UpdateCheckResult } from "@/lib/updates/release";
import type { UpdateRequest } from "@/lib/updates/request";

interface ApiEnvelope<T> {
  data?: T;
  error?: { message?: string };
}

async function apiData<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !body?.data) {
    throw new Error(body?.error?.message ?? `Request failed (HTTP ${response.status})`);
  }
  return body.data;
}

const STEPS = ["Review", "Back up & install", "Finish"];

export function UpdateWindow({
  currentVersion,
  capable,
}: {
  currentVersion: string;
  capable: boolean;
}) {
  const [release, setRelease] = useState<UpdateCheckResult | null>(null);
  const [request, setRequest] = useState<UpdateRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRequest = useCallback(async () => {
    const data = await apiData<{ capable: boolean; request: UpdateRequest | null }>(
      "/api/admin/updates/request",
    );
    setRequest(data.request);
    setOffline(false);
    return data.request;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      apiData<UpdateCheckResult>("/api/admin/updates"),
      loadRequest(),
    ])
      .then(([nextRelease]) => {
        if (!cancelled) setRelease(nextRelease);
      })
      .catch((caught: unknown) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : "Could not load update details");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadRequest]);

  const requestIsTerminal = request?.status === "completed" || request?.status === "failed";
  const visibleRequest =
    requestIsTerminal &&
    ((release?.updateAvailable && request.targetVersion !== release.latestVersion) ||
      (!release && error))
      ? null
      : request;
  const active = visibleRequest?.status === "queued" || visibleRequest?.status === "installing";
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      void loadRequest().catch(() => setOffline(true));
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [active, loadRequest]);

  async function startUpdate() {
    setStarting(true);
    setError(null);
    try {
      const data = await apiData<{ capable: boolean; request: UpdateRequest }>(
        "/api/admin/updates/request",
        { method: "POST" },
      );
      setRequest(data.request);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not request the update");
    } finally {
      setStarting(false);
    }
  }

  function returnToPolySIEM() {
    if (window.opener && !window.opener.closed) {
      window.opener.location.reload();
      window.close();
      return;
    }
    window.location.assign("/settings/about");
  }

  const stage = visibleRequest?.status === "completed" || visibleRequest?.status === "failed" ? 2 : active ? 1 : 0;
  const progress = visibleRequest?.status === "queued" ? 20 : visibleRequest?.status === "installing" ? 65 : stage === 2 ? 100 : 0;

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4 py-8">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-primary-foreground/20">
            <AppLogo className="size-8" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Update PolySIEM</h1>
          <p className="text-sm text-muted-foreground">A guided, transactional update from your browser</p>
        </div>

        <ol className="flex items-center justify-center gap-2">
          {STEPS.map((label, index) => (
            <li key={label} className="flex items-center gap-2">
              <span className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                index < stage ? "bg-primary text-primary-foreground" : index === stage ? "border-2 border-primary text-primary" : "border border-border text-muted-foreground",
              )}>
                {index < stage ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className={cn("hidden text-sm sm:inline", index === stage ? "font-medium" : "text-muted-foreground")}>{label}</span>
              {index < STEPS.length - 1 && <span className="mx-1 h-px w-5 bg-border" />}
            </li>
          ))}
        </ol>

        <Card>
          {loading ? (
            <CardContent className="flex min-h-64 items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="size-5 animate-spin" /> Checking the latest verified release…
            </CardContent>
          ) : visibleRequest?.status === "completed" ? (
            <>
              <CardHeader className="text-center">
                <div className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-success/10 text-success"><Check className="size-6" /></div>
                <CardTitle>Update complete</CardTitle>
                <CardDescription>PolySIEM v{visibleRequest.targetVersion} is online and passed its health check.</CardDescription>
              </CardHeader>
              <CardContent><Progress value={100} /></CardContent>
              <CardFooter><Button className="w-full" onClick={returnToPolySIEM}>Return to PolySIEM</Button></CardFooter>
            </>
          ) : visibleRequest?.status === "failed" ? (
            <>
              <CardHeader>
                <CardTitle>Update rolled back</CardTitle>
                <CardDescription>The previous release was restored and your pre-update backup was retained.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={100} className="[&_[data-slot=progress-indicator]]:bg-destructive" />
                <Alert variant="destructive"><CircleAlert /><AlertTitle>The update did not complete</AlertTitle><AlertDescription>{visibleRequest.message ?? "Inspect the host updater logs before retrying."}</AlertDescription></Alert>
              </CardContent>
              <CardFooter className="gap-2"><Button variant="outline" onClick={returnToPolySIEM}><ArrowLeft /> Return</Button><Button onClick={() => void startUpdate()} disabled={starting}>{starting && <Loader2 className="animate-spin" />}Retry update</Button></CardFooter>
            </>
          ) : active ? (
            <>
              <CardHeader>
                <CardTitle>{visibleRequest?.status === "queued" ? "Update queued" : "Installing the update"}</CardTitle>
                <CardDescription>
                  {visibleRequest?.status === "queued" ? "The isolated host service will claim this request shortly." : "Keep this window open. Brief connection interruptions are expected while PolySIEM restarts."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <Progress value={progress} className="transition-all" />
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <div className="flex items-center gap-2"><DatabaseBackup className="size-4 text-primary" /> Back up data</div>
                  <div className="flex items-center gap-2"><RefreshCw className={cn("size-4 text-primary", visibleRequest?.status === "installing" && "animate-spin")} /> Replace release</div>
                  <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /> Verify health</div>
                </div>
                {offline && <Alert><RefreshCw className="animate-spin" /><AlertTitle>Reconnecting…</AlertTitle><AlertDescription>The application is restarting. This window will resume automatically.</AlertDescription></Alert>}
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle>{release?.updateAvailable ? `Install PolySIEM v${release.latestVersion}` : "No update available"}</CardTitle>
                <CardDescription>Currently running v{currentVersion}. Release artifacts are fetched from the configured GitHub repository.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {!capable && <Alert variant="destructive"><CircleAlert /><AlertTitle>Website updates are unavailable</AlertTitle><AlertDescription>This installation is not connected to the isolated host update service. Use the update command shown on Settings → About.</AlertDescription></Alert>}
                {error && <Alert variant="destructive"><CircleAlert /><AlertTitle>Could not start the update</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
                {release?.updateAvailable && capable && <Alert><ShieldCheck /><AlertTitle>Safe update workflow</AlertTitle><AlertDescription>A configuration and PostgreSQL backup is created first. If the new release fails its health check, PolySIEM automatically restores the previous database and application image.</AlertDescription></Alert>}
                {release && !release.updateAvailable && <Alert><Check /><AlertTitle>PolySIEM is up to date</AlertTitle><AlertDescription>No installation is needed.</AlertDescription></Alert>}
              </CardContent>
              <CardFooter className="justify-between gap-2">
                <Button variant="outline" onClick={returnToPolySIEM}><ArrowLeft /> Back</Button>
                {release?.updateAvailable && capable && <Button onClick={() => void startUpdate()} disabled={starting}>{starting ? <Loader2 className="animate-spin" /> : <ShieldCheck />}Back up and install</Button>}
              </CardFooter>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
