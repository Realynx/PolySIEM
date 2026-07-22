import type { ReactNode } from "react";
import { SettingsRouteSkeleton } from "@/components/settings/settings-loading-skeleton";
import { DetailPageSkeleton, ListPageSkeleton } from "@/components/inventory/skeletons";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function PageHeaderSkeleton({ action = true }: { action?: boolean }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton className="h-7 w-48 max-w-2/3" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      {action && <Skeleton className="h-9 w-32 shrink-0" />}
    </div>
  );
}

export function OperationsOverviewSkeleton({ metrics = 4 }: { metrics?: number }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="flex items-center justify-between gap-4 border-b px-5 py-4">
        <div className="flex items-center gap-3">
          <Skeleton className="size-10 rounded-xl" />
          <div className="space-y-2"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-64 max-w-full" /></div>
        </div>
        <Skeleton className="h-7 w-32 rounded-full" />
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: metrics }, (_, index) => (
          <div key={index} className="space-y-2 border-t p-4 sm:border-l xl:border-t-0">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>
    </section>
  );
}

function TableRows({ rows = 7 }: { rows?: number }) {
  return (
    <Card className="divide-y overflow-hidden py-0">
      <div className="flex gap-4 px-4 py-3">
        {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-4 min-w-12 flex-1" />)}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-4 min-w-16 flex-1" />
          <Skeleton className="hidden h-5 w-20 sm:block" />
          <Skeleton className="hidden h-4 w-24 lg:block" />
          <Skeleton className="ml-auto size-7" />
        </div>
      ))}
    </Card>
  );
}

export function TableOnlySkeleton({ rows = 7 }: { rows?: number }) {
  return <TableRows rows={rows} />;
}

export function InfoTablePageSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <Skeleton className="mb-6 h-32 w-full rounded-xl" />
      <TableRows />
    </div>
  );
}

export function OperationsListPageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <PageHeaderSkeleton />
      <OperationsOverviewSkeleton />
      <TableRows />
    </div>
  );
}

export function SecurityPageSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        <Skeleton className="h-56 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
        </div>
        <Skeleton className="h-40 rounded-xl" />
      </div>
    </div>
  );
}

export function MapPageSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <Skeleton className="h-[calc(100vh-13rem)] min-h-[600px] w-full rounded-xl" />
    </div>
  );
}

export function WifiPageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <PageHeaderSkeleton />
      <OperationsOverviewSkeleton />
      {Array.from({ length: 2 }, (_, index) => (
        <section key={index} className="space-y-3">
          <Skeleton className="h-4 w-36" />
          <TableRows rows={index === 0 ? 4 : 3} />
        </section>
      ))}
    </div>
  );
}

export function SwitchDetailSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <div className="space-y-6">
        {Array.from({ length: 3 }, (_, card) => (
          <Card key={card} className="overflow-hidden py-0">
            <div className="border-b p-5"><Skeleton className="h-4 w-24" /></div>
            <div className="space-y-4 p-5">
              {Array.from({ length: 4 }, (_, row) => (
                <div key={row} className="flex items-center gap-4"><Skeleton className="h-4 w-20" /><Skeleton className="h-4 w-40" /><Skeleton className="hidden h-4 w-28 md:block" /><Skeleton className="ml-auto h-4 w-24" /></div>
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function FirewallRulesSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex gap-2"><Skeleton className="h-8 w-64" /><Skeleton className="h-8 w-40" /><Skeleton className="h-8 w-32" /></div>
      <div className="space-y-4">{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-48 rounded-xl" />)}</div>
    </div>
  );
}

export function EditorPageSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton action={false} />
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_260px]">
          <Skeleton className="h-14" /><Skeleton className="h-14" />
        </div>
        <Skeleton className="h-[60svh] w-full" />
        <div className="flex justify-end gap-2"><Skeleton className="h-8 w-20" /><Skeleton className="h-8 w-28" /></div>
      </div>
    </div>
  );
}

export function DocsIndexSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Skeleton className="h-[32rem] rounded-xl" />
        <Skeleton className="h-[32rem] rounded-xl" />
      </div>
    </div>
  );
}

export function DashboardPageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <PageHeaderSkeleton action={false} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-20 rounded-xl" />)}
      </div>
      <Skeleton className="h-[clamp(600px,72vh,820px)] rounded-xl" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
      </div>
    </div>
  );
}

export function LoginPageSkeleton() {
  return (
    <div className="flex min-h-[calc(100svh-2.5rem)] items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3"><Skeleton className="size-14 rounded-2xl" /><Skeleton className="h-7 w-40" /><Skeleton className="h-4 w-64" /></div>
        <Card className="space-y-5 p-6"><Skeleton className="h-6 w-24" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></Card>
        <Skeleton className="mx-auto h-3 w-48" />
      </div>
    </div>
  );
}

export function SetupPageSkeleton() {
  return (
    <div className="flex min-h-[calc(100svh-2.5rem)] items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-5xl space-y-6">
        <div className="flex flex-col items-center gap-3"><Skeleton className="size-14 rounded-2xl" /><Skeleton className="h-7 w-44" /><Skeleton className="h-4 w-96 max-w-full" /></div>
        <div className="mx-auto flex max-w-3xl justify-center gap-3">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-2 w-16" />)}</div>
        <Skeleton className="mx-auto h-[30rem] w-full max-w-3xl rounded-xl" />
      </div>
    </div>
  );
}

export function UpdatePageSkeleton() {
  return (
    <div className="flex min-h-[calc(100svh-2.5rem)] items-center justify-center" aria-hidden="true">
      <div className="w-full max-w-2xl space-y-6">
        <div className="flex flex-col items-center gap-3"><Skeleton className="size-14 rounded-2xl" /><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72" /></div>
        <div className="flex justify-center gap-3">{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-5 w-24" />)}</div>
        <Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  );
}

export function WorkflowBuilderSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="mb-4 flex items-center gap-3">
        <Skeleton className="size-8 rounded-md" />
        <div className="space-y-2"><Skeleton className="h-6 w-56" /><Skeleton className="h-3 w-40" /></div>
        <Skeleton className="ml-auto h-8 w-64" />
      </div>
      <Skeleton className="h-[calc(100vh-12rem)] min-h-[520px] w-full rounded-xl" />
    </div>
  );
}

export function ResearchPageSkeleton() {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <Skeleton className="h-[650px] rounded-xl" />
        <Skeleton className="h-[650px] rounded-xl" />
      </div>
    </div>
  );
}

export function InsightsPageSkeleton() {
  return (
    <div className="space-y-4" aria-hidden="true">
      <div className="flex justify-end gap-2">
        <Skeleton className="h-8 w-44" /><Skeleton className="h-8 w-36" /><Skeleton className="h-8 w-24" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-32 rounded-xl" />)}
      </div>
      <Skeleton className="h-[28rem] rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
    </div>
  );
}

function OverviewPageSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-2"><Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" /></div>
      <Skeleton className="h-[30rem] rounded-xl" />
    </div>
  );
}

function LogPageSkeleton({ threats = false }: { threats?: boolean }) {
  return (
    <div aria-hidden="true">
      <PageHeaderSkeleton />
      <div className="space-y-4">
        {threats && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-xl" />)}
          </div>
        )}
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-28 rounded-xl" />
        <TableRows rows={8} />
      </div>
    </div>
  );
}

function EdgeNetworksSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <PageHeaderSkeleton />
      <Skeleton className="h-28 rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }, (_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

function isDetailPath(pathname: string): boolean {
  return /^\/inventory\/(hosts|vms|containers|services)\/[^/]+$/.test(pathname)
    || /^\/keys\/[^/]+$/.test(pathname)
    || /^\/network\/[^/]+$/.test(pathname);
}

function primaryRouteSkeleton(pathname: string): ReactNode | null {
  if (pathname === "/login") return <LoginPageSkeleton />;
  if (pathname === "/setup") return <SetupPageSkeleton />;
  if (pathname === "/update") return <UpdatePageSkeleton />;
  if (pathname.startsWith("/settings")) return <SettingsRouteSkeleton pathname={pathname} />;
  if (pathname === "/") return <DashboardPageSkeleton />;
  if (pathname === "/security") return <SecurityPageSkeleton />;
  if (pathname === "/security/research") return <ResearchPageSkeleton />;
  if (pathname === "/workflows") return <OperationsListPageSkeleton />;
  if (pathname === "/workflows/runs") return <ListPageSkeleton />;
  if (/^\/workflows\/[^/]+$/.test(pathname)) return <WorkflowBuilderSkeleton />;
  if (pathname === "/credentials") return <InfoTablePageSkeleton />;
  return null;
}

function networkRouteSkeleton(pathname: string): ReactNode | null {
  if (pathname === "/inventory/map" || pathname === "/network/access-map") return <MapPageSkeleton />;
  if (pathname === "/network/edge-networks") return <EdgeNetworksSkeleton />;
  if (pathname === "/network/insights") return <InsightsPageSkeleton />;
  if (pathname === "/network/wifi") return <WifiPageSkeleton />;
  if (pathname === "/network/ips") return <ListPageSkeleton />;
  if (pathname === "/firewall") return <OverviewPageSkeleton />;
  if (pathname === "/firewall/rules") return <FirewallRulesSkeleton />;
  if (pathname === "/firewall/aliases") return <TableOnlySkeleton />;
  if (pathname === "/network/dhcp" || pathname === "/network/switches") return <OperationsListPageSkeleton />;
  if (/^\/network\/switches\/[^/]+$/.test(pathname)) return <SwitchDetailSkeleton />;
  return null;
}

function contentRouteSkeleton(pathname: string): ReactNode | null {
  if (pathname === "/logs" || pathname === "/logs/threats") return <LogPageSkeleton threats={pathname.endsWith("threats")} />;
  if (pathname === "/docs") return <DocsIndexSkeleton />;
  if (pathname === "/docs/new" || pathname.endsWith("/edit")) return <EditorPageSkeleton />;
  if (isDetailPath(pathname) || /^\/docs\/[^/]+$/.test(pathname)) return <DetailPageSkeleton />;
  return null;
}

/** Chooses the immediate skeleton from the destination URL, before its RSC arrives. */
export function RouteLoadingSkeleton({ pathname }: { pathname: string }) {
  const primary = primaryRouteSkeleton(pathname);
  if (primary !== null) return primary;
  const network = networkRouteSkeleton(pathname);
  if (network !== null) return network;
  const content = contentRouteSkeleton(pathname);
  if (content !== null) return content;
  return <ListPageSkeleton />;
}
