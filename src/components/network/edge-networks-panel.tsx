"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CirclePause,
  Cloud,
  Clock,
  Ellipsis,
  ExternalLink,
  Loader2,
  LockKeyhole,
  Network,
  PlugZap,
  Plus,
  RefreshCw,
  Route,
  Router,
  ScanLine,
  Server,
  Share2,
  ShieldCheck,
  Trash2,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { buildEdgeBootstrapCommand } from "@/lib/integrations/edge-nat/bootstrap";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { CopyButton } from "@/components/ssh/copy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  connectorSummary,
  edgeInterfaceChoices,
  EDGE_NETWORKS_QUERY_KEY,
  EMPTY_EDGE_NETWORKS_OVERVIEW,
  edgeOverviewPresentation,
  edgeReconciliation,
  edgeServerState,
  sshEndpoint,
  tailscaleDetails,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
  // Aliased: this file already has a component called `EdgeNetworkTab`.
  type EdgeNetworkTab as EdgeNetworkTabValue,
  type EdgeNetworksOverview,
  type OtherEdgeNetwork,
} from "./edge-networks-types";
import {
  edgeServersNeedingCleanup,
  edgeSyncFacts,
  edgeSyncSummary,
  EDGE_TRAFFIC_PATH_CAVEAT,
  EDGE_TRAFFIC_PATH_STEPS,
  type EdgeSyncFact,
  type EdgeSyncSummary,
  type EdgeSyncTone,
} from "./edge-sync-presentation";
import { edgeCardsStartExpanded } from "./cloudflare-presentation";
import { EdgeCardCollapseTrigger } from "./edge-card-collapse";
import { CloudflarePublishedRoutes } from "./edge-cloudflare-routes";
import { ConnectorsCard, useAllConnectorsQuery, useConnectorsQuery } from "./connectors-card";
import { ConnectorsTab } from "./connectors-tab";
import { EdgeNatRulesTab, NatRuleDialog } from "./edge-nat-rules";
import { EdgeInterfacesTab } from "./edge-interfaces-tab";
import { EdgeWireguardCard, edgeWireguardTabStatus, useEdgeWireguardQuery } from "./edge-wireguard-card";

export function EdgeNetworksPanel({ isAdmin }: { isAdmin: boolean }) {
  const overviewQuery = useQuery({
    queryKey: EDGE_NETWORKS_QUERY_KEY,
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_EDGE_NETWORKS_OVERVIEW;
  const { cloudflare, counts, hasAnyNetwork, defaultTab } = edgeOverviewPresentation(overview);
  const loaded = !overviewQuery.isLoading && !overviewQuery.isError;
  // Connectors are a peer concept of edge boxes, so the page tab bar counts them
  // from their own instance-wide list rather than from any one server.
  const connectorCount = useAllConnectorsQuery().data?.length ?? 0;

  return (
    <div>
      <PageHeader
        title="Edge networks"
        description="Manage remote entry points that keep the home WAN address out of direct port-forward rules."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={overviewQuery.isFetching}
              onClick={() => void overviewQuery.refetch()}
            >
              <RefreshCw className={cn("size-4", overviewQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
            {isAdmin && (
              <Button asChild size="sm">
                <Link href="/settings/integrations?add=EDGE_NAT_SERVER">
                  <Plus className="size-4" /> Add Edge NAT server
                </Link>
              </Button>
            )}
          </>
        }
      />

      {overviewQuery.isLoading && <EdgeNetworksSkeleton />}

      {overviewQuery.isError && (
        <EmptyState
          icon={Router}
          title="Could not load edge networks"
          description={edgeOverviewErrorMessage(overviewQuery.error)}
          action={<Button onClick={() => void overviewQuery.refetch()}>Try again</Button>}
        />
      )}

      {loaded && !hasAnyNetwork && connectorCount === 0 && <EdgeNetworksEmpty isAdmin={isAdmin} />}

      {loaded && (hasAnyNetwork || connectorCount > 0) && (
        <EdgeNetworkTabs
          overview={overview}
          cloudflare={cloudflare}
          counts={counts}
          connectorCount={connectorCount}
          defaultTab={landingTab(hasAnyNetwork, defaultTab)}
          isAdmin={isAdmin}
        />
      )}
    </div>
  );
}

/**
 * The page's four surfaces. `Connectors` sits beside `SSH edge boxes` rather
 * than inside it: one installed connector can serve any number of edge boxes,
 * so it is a peer concept, not a child of one server.
 */
function EdgeNetworkTabs({
  overview,
  cloudflare,
  counts,
  connectorCount,
  defaultTab,
  isAdmin,
}: {
  overview: EdgeNetworksOverview;
  cloudflare: OtherEdgeNetwork[];
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  connectorCount: number;
  defaultTab: EdgeNetworkTabValue;
  isAdmin: boolean;
}) {
  return (
    <Tabs defaultValue={defaultTab} className="gap-5">
      <div className="overflow-x-auto pb-1">
        <TabsList className="grid h-10 min-w-[25rem] w-full grid-cols-4 sm:inline-grid sm:w-auto">
          <EdgeNetworkTab value="edge" label="SSH edge boxes" mobileLabel="SSH" count={overview.edgeServers.length} icon={Server} />
          <EdgeNetworkTab value="connectors" label="Connectors" mobileLabel="Connect" count={connectorCount} icon={PlugZap} />
          <EdgeNetworkTab value="tailscale" label="Tailscale" mobileLabel="Tailnet" count={overview.tailscale.length} icon={Share2} />
          <EdgeNetworkTab value="cloudflare" label="Cloudflare" mobileLabel="Cloudflare" count={cloudflare.length} icon={Cloud} />
        </TabsList>
      </div>

      <TabsContent value="edge" className="space-y-6">
        <EdgeServersTab servers={overview.edgeServers} counts={counts} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="connectors">
        <ConnectorsTab servers={overview.edgeServers} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="tailscale">
        <TailscaleTab networks={overview.tailscale} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="cloudflare">
        {cloudflare.length > 0 ? (
          <CloudflarePublishedRoutes integrations={cloudflare} isAdmin={isAdmin} />
        ) : (
          <EdgeNetworkTabEmpty
            icon={Cloud}
            title="No Cloudflare integration"
            description="Connect a Cloudflare account to document and manage published tunnel routes."
            addHref="/settings/integrations?add=CLOUDFLARE"
            addLabel="Connect Cloudflare"
            isAdmin={isAdmin}
          />
        )}
      </TabsContent>
    </Tabs>
  );
}

/**
 * Connectors can outlive every network they served, so they are the landing tab
 * when they are the only thing left to show.
 */
function landingTab(hasAnyNetwork: boolean, preferred: EdgeNetworkTabValue): EdgeNetworkTabValue {
  return hasAnyNetwork ? preferred : "connectors";
}

function edgeOverviewErrorMessage(error: unknown): string {
  return (error as Error | null)?.message ?? "The edge network inventory is unavailable.";
}

function EdgeNetworksEmpty({ isAdmin }: { isAdmin: boolean }) {
  return (
    <EmptyState
      icon={Router}
      title="No edge networks connected"
      description="Add an Edge NAT server to publish selected services through a remote IP, or connect Tailscale to inventory private routes and entry points."
      action={isAdmin ? (
        <Button asChild>
          <Link href="/settings/integrations?add=EDGE_NAT_SERVER">
            <Plus className="size-4" /> Add Edge NAT server
          </Link>
        </Button>
      ) : undefined}
    />
  );
}

function EdgeServersTab({
  servers,
  counts,
  isAdmin,
}: {
  servers: EdgeNatServer[];
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  isAdmin: boolean;
}) {
  if (servers.length === 0) {
    return (
      <EdgeNetworkTabEmpty
        icon={Server}
        title="No SSH-managed edge boxes"
        description="Add an Edge NAT server to publish selected services through a remote IP."
        addHref="/settings/integrations?add=EDGE_NAT_SERVER"
        addLabel="Add Edge NAT server"
        isAdmin={isAdmin}
      />
    );
  }
  return (
    <section className="space-y-4" aria-label="SSH-managed edge boxes">
      {/* The only thing above the first card: one strip of fleet state, plus the
          concept explainer that used to cost 110px of permanent diagram. */}
      <EdgeFleetStrip servers={servers} counts={counts} isAdmin={isAdmin} />
      <EdgeCleanupNotice servers={servers} />
      {servers.map((server) => (
        <EdgeServerCard
          key={server.id}
          server={server}
          servers={servers}
          isAdmin={isAdmin}
          /* Same rule as the Cloudflare tunnels: a few cards open, a fleet does not. */
          defaultExpanded={edgeCardsStartExpanded(servers.length)}
        />
      ))}
    </section>
  );
}

/** Compact fleet state. Replaces three stat tiles and a section header. */
function EdgeFleetStrip({
  servers,
  counts,
  isAdmin,
}: {
  servers: EdgeNatServer[];
  counts: ReturnType<typeof edgeOverviewPresentation>["counts"];
  isAdmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium tabular-nums">{counts.onlineServers} of {servers.length} online</span>
          <StripDot />
          <span className="text-muted-foreground tabular-nums">
            {counts.enabledRules} published port{counts.enabledRules === 1 ? "" : "s"}
          </span>
          {counts.needsReconcile > 0 && (
            <>
              <StripDot />
              <span className="text-muted-foreground tabular-nums">{counts.needsReconcile} not in sync</span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              How this works
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          {isAdmin && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/settings/integrations?add=EDGE_NAT_SERVER"><Plus /> Add server</Link>
            </Button>
          )}
        </div>
      </div>
      <CollapsibleContent>
        <div className="space-y-3 border-t p-3">
          <ol className="space-y-2">
            {EDGE_TRAFFIC_PATH_STEPS.map((step, index) => (
              <li key={step.title} className="flex gap-2.5 text-sm">
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[0.6875rem] font-medium text-primary">
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <span className="font-medium">{step.title}</span>
                  <span className="block text-xs text-muted-foreground">{step.detail}</span>
                </span>
              </li>
            ))}
          </ol>
          <p className="text-xs text-muted-foreground">{EDGE_TRAFFIC_PATH_CAVEAT}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function StripDot() {
  return <span className="text-muted-foreground/50" aria-hidden="true">·</span>;
}

/**
 * Conditional by design. The old copy warned about disabled servers on every
 * page load, including when nothing was disabled — a warning that is always on
 * is not a warning. It now appears only when a disabled server may still be
 * forwarding traffic.
 */
function EdgeCleanupNotice({ servers }: { servers: EdgeNatServer[] }) {
  const stale = edgeServersNeedingCleanup(servers);
  if (stale.length === 0) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>
        {stale.length === 1
          ? `${stale[0].name} is disabled here but may still be forwarding`
          : `${stale.length} disabled servers may still be forwarding`}
      </AlertTitle>
      <AlertDescription>
        Turning PolySIEM management off does not remove rules already installed on the edge. Traffic can keep flowing
        through the last applied ruleset until Clear remote rules succeeds and the server reports zero managed rules.
      </AlertDescription>
    </Alert>
  );
}

function TailscaleTab({
  networks,
  isAdmin,
}: {
  networks: EdgeNetworksOverview["tailscale"];
  isAdmin: boolean;
}) {
  if (networks.length === 0) {
    return (
      <EdgeNetworkTabEmpty
        icon={Share2}
        title="No Tailscale integration"
        description="Connect a tailnet to inventory private routes, exit nodes, devices, and DNS identity."
        addHref="/settings/integrations?add=TAILSCALE"
        addLabel="Connect Tailscale"
        isAdmin={isAdmin}
      />
    );
  }
  return (
    <section className="space-y-3" aria-labelledby="tailscale-edge-heading">
      <div>
        <h2 id="tailscale-edge-heading" className="text-lg font-semibold">Tailscale</h2>
        <p className="text-sm text-muted-foreground">Private overlay entry points, subnet routes, exit nodes, and DNS identity.</p>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {networks.map((network, index) => (
          <TailscaleCard key={network.id ?? network.integrationId ?? index} network={network} />
        ))}
      </div>
    </section>
  );
}

function EdgeNetworkTab({
  value,
  label,
  mobileLabel,
  count,
  icon: Icon,
}: {
  value: string;
  label: string;
  mobileLabel: string;
  count: number;
  icon: typeof Server;
}) {
  return (
    <TabsTrigger value={value} className="min-w-0 gap-1.5 px-2" aria-label={`${label}, ${count} configured`}>
      <Icon className="size-4" aria-hidden="true" />
      <span className="truncate sm:hidden">{mobileLabel}</span>
      <span className="hidden sm:inline">{label}</span>
      <Badge variant="secondary" className="h-5 min-w-5 justify-center px-1.5 text-[0.6875rem] tabular-nums" aria-hidden="true">
        {count}
      </Badge>
    </TabsTrigger>
  );
}

function EdgeNetworkTabEmpty({
  icon,
  title,
  description,
  addHref,
  addLabel,
  isAdmin,
}: {
  icon: typeof Server;
  title: string;
  description: string;
  addHref: string;
  addLabel: string;
  isAdmin: boolean;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      description={description}
      action={isAdmin ? (
        <Button asChild>
          <Link href={addHref}><Plus className="size-4" /> {addLabel}</Link>
        </Button>
      ) : undefined}
    />
  );
}


/**
 * One edge server.
 *
 * The card head is the always-visible health story — identity, sync state, and
 * the facts an operator scans for — and everything that is a *place to work*
 * (routes, connectors, the tunnel, interfaces) sits behind the card's own tab
 * bar, so a server with three connectors and a dozen rules stays one screen.
 *
 * That work area also collapses, exactly as a Cloudflare tunnel card does. What
 * stays visible when it is collapsed is the head: name, state badge, the sync
 * line, and the route count on the collapse control itself.
 */
function EdgeServerCard({
  server,
  servers,
  isAdmin,
  defaultExpanded,
}: {
  server: EdgeNatServer;
  /** Every edge box, so a connector row can name the others it also serves. */
  servers: EdgeNatServer[];
  isAdmin: boolean;
  defaultExpanded: boolean;
}) {
  const queryClient = useQueryClient();
  // Remembered per card, for as long as it is mounted.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const [deleteRule, setDeleteRule] = useState<EdgeNatRule | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  // Remembered per server, for as long as the card is mounted. Owned here so the
  // rule editor can send an operator to the Connectors tab instead of dead-ending.
  const [tab, setTab] = useState<EdgeServerTabValue>("routes");
  const [linkOpen, setLinkOpen] = useState(false);
  // Shared query key with the connectors card, so the rule editor, the list, and
  // the Connectors tab badge read one cached fetch.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];
  const applyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => { toast.success(`Applied NAT rules on ${server.name}`); void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY }); },
    onError: (error: Error) => toast.error(`Could not apply rules: ${error.message}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("NAT rule removed. Apply changes to update the server."); setDeleteRule(null); void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; detail: string }>(`/api/admin/integrations/${server.id}/test`, { method: "POST" }),
    onSuccess: (result) => result.ok ? toast.success(result.detail || "SSH connection verified") : toast.error(result.detail || "SSH verification failed"),
    onError: (error: Error) => toast.error(`SSH verification failed: ${error.message}`),
  });
  const clearMutation = useMutation({
    mutationFn: () => apiFetch<{ cleared: boolean; appliedRuleCount: number }>(`/api/network/edge-networks/servers/${server.id}/clear`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Remote NAT rules cleared on ${server.name}`);
      setClearOpen(false);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });

  const openRule = (rule: EdgeNatRule | null) => setRuleDialog({ open: true, rule });

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-(--card-spacing)">
        {/* Tier 1, never tabbed and never collapsed: who this box is, whether
            PolySIEM can reach it, whether what is configured is actually live,
            and the one button that resolves the difference. */}
        <CardHeader className="gap-3 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <EdgeServerIdentity server={server} />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isAdmin && server.enabled && (
                <EdgeServerActions
                  server={server}
                  verifying={verifyMutation.isPending}
                  onSetupSsh={() => setEnrollmentOpen(true)}
                  onVerify={() => verifyMutation.mutate()}
                  onAddRule={() => openRule(null)}
                />
              )}
              <EdgeCardCollapseTrigger expanded={expanded} count={server.rules.length} name={server.name} />
            </div>
          </div>

          <EdgeSyncBar
            server={server}
            isAdmin={isAdmin}
            applying={applyMutation.isPending}
            onApply={() => applyMutation.mutate()}
            onClear={() => setClearOpen(true)}
          />
          <EdgeServerAlerts server={server} isAdmin={isAdmin} onSetupSsh={() => setEnrollmentOpen(true)} />
        </CardHeader>

        <CollapsibleContent>
          <CardContent>
            {server.enabled ? (
              <EdgeServerTabs
                server={server}
                servers={servers}
                isAdmin={isAdmin}
                connectors={connectors}
                tab={tab}
                onTabChange={setTab}
                linkOpen={linkOpen}
                onLinkOpenChange={setLinkOpen}
                onAddRule={() => openRule(null)}
                onEditRule={(rule) => openRule(rule)}
                onDeleteRule={setDeleteRule}
                onSetupEdgeSsh={() => setEnrollmentOpen(true)}
              />
            ) : (
              <EdgeNatRulesTab
                server={server}
                connectors={connectors}
                isAdmin={isAdmin}
                onAdd={() => openRule(null)}
                onEdit={(rule) => openRule(rule)}
                onDelete={setDeleteRule}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      <SshEnrollmentDialog server={server} open={enrollmentOpen} onOpenChange={setEnrollmentOpen} />
      <NatRuleDialog
        server={server}
        rule={ruleDialog.rule}
        connectors={connectors}
        open={ruleDialog.open}
        onOpenChange={(open) => setRuleDialog((current) => ({ ...current, open }))}
        onLinkConnector={isAdmin ? () => { setTab("connectors"); setLinkOpen(true); } : undefined}
      />
      <AlertDialog open={deleteRule !== null} onOpenChange={(open) => !open && setDeleteRule(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove {deleteRule?.name}?</AlertDialogTitle><AlertDialogDescription>The rule will be removed from PolySIEM, then must be applied before the edge server&apos;s firewall changes.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={deleteMutation.isPending} onClick={(event) => { event.preventDefault(); if (deleteRule) deleteMutation.mutate(deleteRule.id); }}>{deleteMutation.isPending && <Loader2 className="animate-spin" />}Remove rule</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear every remote NAT rule on {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>This sends an empty managed ruleset to the edge server. Desired rules remain saved in PolySIEM, but traffic may continue until the remote server confirms cleanup.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={clearMutation.isPending} onClick={(event) => { event.preventDefault(); clearMutation.mutate(); }}>
              {clearMutation.isPending && <Loader2 className="animate-spin" />}Clear remote rules
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

/**
 * Identity and reachability on one line: who this box is, how PolySIEM talks to
 * it, what address it publishes, whether its key is pinned, and when it was last
 * heard from. `Forwarding` is deliberately absent — it is a kernel flag that the
 * next apply turns on, so it reads as a fault here. It lives in Sync details.
 */
function EdgeServerIdentity({ server }: { server: EdgeNatServer }) {
  const settings = server.settings ?? {};
  const publicIp = settings.syncedSnapshot?.publicIp ?? settings.publicIp;
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Server className="size-5" /></div>
      <div className="min-w-0">
        <CardTitle className="flex flex-wrap items-center gap-2">{server.name}<ServerStateBadge state={edgeServerState(server)} /></CardTitle>
        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono">ssh://{sshEndpoint(server.baseUrl)}</span>
          <StripDot />
          <span>publishes <span className="font-mono text-foreground/80">{publicIp ?? "an address not detected yet"}</span></span>
          <StripDot />
          <span>{hostKeyFactValue(server)}</span>
          <StripDot />
          <span>{server.lastSyncAt ? `checked ${formatRelative(server.lastSyncAt)}` : "not checked yet"}</span>
        </CardDescription>
      </div>
    </div>
  );
}

/**
 * Secondary actions only. `Apply changes` is not here: it belongs beside the
 * sentence that explains why you would press it. `SSH trust` and `Verify SSH`
 * used to sit side by side sounding like the same thing; they are now named for
 * what they each do, and are one click away in the overflow.
 */
function EdgeServerActions({
  server,
  verifying,
  onSetupSsh,
  onVerify,
  onAddRule,
}: {
  server: EdgeNatServer;
  verifying: boolean;
  onSetupSsh: () => void;
  onVerify: () => void;
  onAddRule: () => void;
}) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={onAddRule}><Plus /> Add NAT rule</Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label={`More actions for ${server.name}`}>
            <Ellipsis />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onSelect={onSetupSsh}>
            <LockKeyhole />
            {server.hostKeyEnrolled ? "Review SSH trust" : "Set up SSH"}
          </DropdownMenuItem>
          {server.hostKeyEnrolled && (
            <DropdownMenuItem disabled={verifying} onSelect={onVerify}>
              {verifying ? <Loader2 className="animate-spin" /> : <ScanLine />}
              Test connection
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function hostKeyFactValue(server: EdgeNatServer): string {
  if (!server.hostKeyEnrolled && !server.settings?.hostKeyVerified) return "host key not enrolled yet";
  return edgeServerState(server) === "online" ? "host key pinned and verified" : "host key pinned, connection unverified";
}

function EdgeServerAlerts({
  server,
  isAdmin,
  onSetupSsh,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  onSetupSsh: () => void;
}) {
  const settings = server.settings ?? {};
  return (
    <>
      {/* The disabled-server story is told once, by the sync line above: it
          states whether rules may still be live and carries Clear remote rules.
          Only genuine faults and unfinished setup get an alert here. */}
      {(server.lastSyncError || settings.lastApplyError) && (
        <Alert variant="destructive"><TriangleAlert /><AlertTitle>Server needs attention</AlertTitle><AlertDescription>{settings.lastApplyError ?? server.lastSyncError}</AlertDescription></Alert>
      )}

      {isAdmin && server.enabled && !server.hostKeyEnrolled && (
        <Alert>
          <LockKeyhole />
          <AlertTitle>Finish SSH enrollment before applying rules</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            Install this integration&apos;s generated public key, then pin the server&apos;s observed host key so PolySIEM cannot silently connect to an impostor.
            <Button size="sm" onClick={onSetupSsh}>Set up SSH</Button>
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

type EdgeServerTabValue = "routes" | "connectors" | "tunnel" | "interfaces";

/**
 * The card's own segmented control. Nested one level inside the page tabs, so it
 * is deliberately smaller and quieter than the page-level bar above it.
 */
function EdgeServerTabs({
  server,
  servers,
  isAdmin,
  connectors,
  tab,
  onTabChange,
  linkOpen,
  onLinkOpenChange,
  onAddRule,
  onEditRule,
  onDeleteRule,
  onSetupEdgeSsh,
}: {
  server: EdgeNatServer;
  servers: EdgeNatServer[];
  isAdmin: boolean;
  connectors: ConnectorDto[];
  tab: EdgeServerTabValue;
  onTabChange: (tab: EdgeServerTabValue) => void;
  linkOpen: boolean;
  onLinkOpenChange: (open: boolean) => void;
  onAddRule: () => void;
  onEditRule: (rule: EdgeNatRule) => void;
  onDeleteRule: (rule: EdgeNatRule) => void;
  onSetupEdgeSsh: () => void;
}) {
  const wgQuery = useEdgeWireguardQuery(server);
  const summary = connectorSummary(connectors);
  const tunnel = edgeWireguardTabStatus(server, wgQuery.data);
  const interfaceCount = edgeInterfaceChoices(server).length;

  return (
    <Tabs value={tab} onValueChange={(next) => onTabChange(next as EdgeServerTabValue)} className="gap-4">
      <div className="overflow-x-auto pb-1">
        <TabsList className="grid h-9 w-full min-w-[21rem] grid-cols-4 bg-muted/60 sm:inline-grid sm:w-auto">
          <EdgeServerTabTrigger
            value="routes"
            label="Routes"
            icon={Route}
            badge={String(server.rules.length)}
            ariaLabel={`Routes, ${server.rules.length} rules`}
          />
          <EdgeServerTabTrigger
            value="connectors"
            label="Connectors"
            icon={PlugZap}
            badge={`${summary.ready}/${summary.total}`}
            badgeTitle={`${summary.ready} of ${summary.total} connectors ready`}
            ariaLabel={`Connectors, ${summary.ready} of ${summary.total} ready`}
          />
          <EdgeServerTabTrigger
            value="tunnel"
            label="Tunnel"
            icon={Waypoints}
            badge={tunnel.tone === "on" ? "On" : tunnel.label}
            ariaLabel={`Tunnel, ${tunnel.label}`}
          />
          <EdgeServerTabTrigger
            value="interfaces"
            label="Interfaces"
            icon={Network}
            badge={String(interfaceCount)}
            ariaLabel={`Interfaces, ${interfaceCount} detected`}
          />
        </TabsList>
      </div>

      <TabsContent value="routes">
        <EdgeNatRulesTab
          server={server}
          connectors={connectors}
          isAdmin={isAdmin}
          onAdd={onAddRule}
          onEdit={onEditRule}
          onDelete={onDeleteRule}
        />
      </TabsContent>

      <TabsContent value="connectors">
        {/* The connectors THIS edge routes through. They are not owned by it —
            "Link a connector" reuses one that is already installed elsewhere,
            and the install flow walks both ends when a new one is added. */}
        <ConnectorsCard
          server={server}
          servers={servers}
          isAdmin={isAdmin}
          onSetupEdgeSsh={onSetupEdgeSsh}
          linkOpen={linkOpen}
          onLinkOpenChange={onLinkOpenChange}
        />
      </TabsContent>

      <TabsContent value="tunnel">
        <EdgeWireguardCard server={server} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="interfaces">
        <EdgeInterfacesTab server={server} isAdmin={isAdmin} />
      </TabsContent>
    </Tabs>
  );
}

function EdgeServerTabTrigger({
  value,
  label,
  icon: Icon,
  badge,
  badgeTitle,
  ariaLabel,
}: {
  value: EdgeServerTabValue;
  label: string;
  icon: typeof Server;
  badge: string;
  badgeTitle?: string;
  ariaLabel: string;
}) {
  return (
    <TabsTrigger value={value} className="min-w-0 gap-1.5 px-2 text-xs" aria-label={ariaLabel}>
      <Icon className="size-3.5" aria-hidden="true" />
      <span className="truncate">{label}</span>
      <Badge
        variant="secondary"
        className="h-5 min-w-5 justify-center px-1.5 text-[0.6875rem] font-normal tabular-nums"
        title={badgeTitle}
        aria-hidden="true"
      >
        {badge}
      </Badge>
    </TabsTrigger>
  );
}

interface HostKeyProbe {
  host: string;
  port: number;
  keys: Array<{ algorithm: string; fingerprint: string }>;
  enrolledFingerprint: string | null;
}

function SshEnrollmentDialog({ server, open, onOpenChange }: { server: EdgeNatServer; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const settings = server.settings ?? {};
  const publicKey = settings.publicKey ?? "";
  const bootstrapCommand = publicKey ? buildEdgeBootstrapCommand(publicKey) : "";
  const hostKeyQuery = useQuery({
    queryKey: ["edge-server-host-key", server.id],
    queryFn: () => apiFetch<HostKeyProbe>(`/api/network/edge-networks/servers/${server.id}/host-key`),
    enabled: open,
    retry: false,
  });
  const selected = preferredEdgeHostKey(selectedFingerprint, hostKeyQuery.data);
  const enrollMutation = useMutation({
    mutationFn: ({ fingerprint, username }: { fingerprint: string; username: string }) =>
      apiFetch<{ installed: boolean; detail: string }>(`/api/network/edge-networks/servers/${server.id}/provision`, {
        method: "POST",
        body: JSON.stringify({ adminUsername: username, fingerprint }),
      }),
    onSuccess: (result) => {
      toast.success(result.detail || "Edge service installed and SSH verified");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not install the Edge service: ${error.message}`),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Set up SSH for {server.name}</DialogTitle>
          <DialogDescription>PolySIEM generated a dedicated key for this server. You authorize it once, confirm the server identity, and PolySIEM installs and verifies the restricted service for you.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <EnrollmentStep number="1" title="Authorize one setup connection">
            <div className="grid gap-2">
              <Label htmlFor={`edge-admin-${server.id}`}>Existing SSH administrator</Label>
              <Input
                id={`edge-admin-${server.id}`}
                value={adminUsername}
                onChange={(event) => setAdminUsername(event.target.value)}
                placeholder="ubuntu"
                autoComplete="username"
                maxLength={32}
              />
              <p className="text-xs text-muted-foreground">Use the account you normally SSH into. It must be root or have passwordless <code>sudo</code> for this one installation. The username is sent only for this request and is not saved.</p>
            </div>
            <p className="text-sm text-muted-foreground">Sign in to that account and run this short command. It adds a forced, temporary installer key—not a general shell key.</p>
            <EnrollmentCommand bootstrapCommand={bootstrapCommand} publicKey={publicKey} />
            {settings.publicKeyFingerprint && <p className="text-xs text-muted-foreground">PolySIEM key fingerprint: <code>{settings.publicKeyFingerprint}</code></p>}
          </EnrollmentStep>

          <EnrollmentScanStep probeQuery={hostKeyQuery} selected={selected} onSelect={setSelectedFingerprint} />

          <EnrollmentStep number="3" title="Let PolySIEM install the service">
            <p className="text-sm text-muted-foreground">PolySIEM rescans and pins the selected host identity, connects through the temporary installer key, installs the restricted <code>polysiem-edge</code> service, removes the temporary admin authorization, and verifies the service.</p>
            {enrollMutation.isPending && (
              <Alert><Loader2 className="animate-spin" /><AlertTitle>Installing the restricted Edge service</AlertTitle><AlertDescription>Keep this window open. PolySIEM is connecting over pinned SSH, installing the helper, removing its temporary setup access, and checking the result.</AlertDescription></Alert>
            )}
          </EnrollmentStep>
        </div>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Finish later</Button></DialogClose>
          <Button
            disabled={!selected || enrollMutation.isPending || !publicKey || !/^(?!polysiem-edge$)[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(adminUsername.trim())}
            onClick={() => selected && enrollMutation.mutate({ fingerprint: selected, username: adminUsername.trim() })}
          >
            {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
            {enrollMutation.isPending ? "Installing service…" : "Trust host and install service"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** What the dialog offers to pin: an explicit pick, the enrolled key, or a lone observed one. */
function preferredEdgeHostKey(chosen: string, probe: HostKeyProbe | undefined): string {
  const keys = probe?.keys ?? [];
  return chosen || probe?.enrolledFingerprint || (keys.length === 1 ? keys[0].fingerprint : "");
}

/** Step ②: what the host presents, and which fingerprint gets pinned. */
function EnrollmentScanStep({
  probeQuery,
  selected,
  onSelect,
}: {
  probeQuery: UseQueryResult<HostKeyProbe>;
  selected: string;
  onSelect: (fingerprint: string) => void;
}) {
  const probe = probeQuery.data;
  return (
    <EnrollmentStep number="2" title="Scan the server identity">
      <p className="text-sm text-muted-foreground">Compare an observed fingerprint with the server console before trusting it. Pinning this key prevents a changed or impersonated SSH host from being accepted silently.</p>
      {probeQuery.isLoading && <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
      {probeQuery.isError && (
        <Alert
          variant="destructive"
          aria-label={`Could not scan the SSH host key: ${(probeQuery.error as Error).message}`}
        >
          <TriangleAlert />
          <AlertTitle>Could not scan the SSH host key:</AlertTitle>
          <AlertDescription>{` ${(probeQuery.error as Error).message}`}</AlertDescription>
        </Alert>
      )}
      {probe && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Observed at <code>{probe.host}:{probe.port}</code></p>
          {probe.keys.length === 0 ? <p className="text-sm text-warning">No host keys were returned.</p> : probe.keys.map((key) => (
            <EnrollmentHostKeyOption
              key={`${key.algorithm}:${key.fingerprint}`}
              algorithm={key.algorithm}
              fingerprint={key.fingerprint}
              active={selected === key.fingerprint}
              onSelect={() => onSelect(key.fingerprint)}
            />
          ))}
        </div>
      )}
      <Button type="button" variant="outline" size="sm" disabled={probeQuery.isFetching} onClick={() => void probeQuery.refetch()}><RefreshCw className={cn(probeQuery.isFetching && "animate-spin")} /> Scan again</Button>
    </EnrollmentStep>
  );
}

function EnrollmentHostKeyOption({
  algorithm,
  fingerprint,
  active,
  onSelect,
}: {
  algorithm: string;
  fingerprint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button type="button" onClick={onSelect} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent", active && "border-primary bg-primary/5")}>
      <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>{active && <Check className="size-3" />}</span>
      <span className="min-w-0"><span className="block text-xs font-medium uppercase text-muted-foreground">{algorithm}</span><code className="block break-all text-xs">{fingerprint}</code></span>
    </button>
  );
}

/** The setup one-liner, degrading to the raw key and then to an error. */
function EnrollmentCommand({ bootstrapCommand, publicKey }: { bootstrapCommand: string; publicKey: string }) {
  if (bootstrapCommand) return <CopyBlock value={bootstrapCommand} label="Setup command" />;
  if (publicKey) {
    return (
      <>
        <CopyBlock value={publicKey} label="Public key" />
        <p className="text-xs text-warning">The setup command could not be generated. Recreate this integration before continuing.</p>
      </>
    );
  }
  return (
    <Alert variant="destructive"><TriangleAlert /><AlertTitle>Generated public key unavailable</AlertTitle><AlertDescription>Edit or recreate the integration before continuing.</AlertDescription></Alert>
  );
}

function EnrollmentStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="grid gap-3 sm:grid-cols-[2rem_1fr]"><div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{number}</div><div className="min-w-0 space-y-3"><h3 className="font-medium">{title}</h3>{children}</div></section>;
}

function CopyBlock({ value, label }: { value: string; label: string }) {
  return <div className="relative rounded-lg bg-muted p-3 pr-12"><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs"><code>{value}</code></pre><CopyButton value={value} label={`Copy ${label}`} className="absolute right-2 top-2" /></div>;
}

const SYNC_TONES: Record<EdgeSyncTone, { icon: typeof Server; frame: string; text: string }> = {
  synced: { icon: CircleCheck, frame: "border-border bg-muted/20", text: "text-success" },
  staged: { icon: Clock, frame: "border-primary/30 bg-primary/5", text: "text-primary" },
  drifted: { icon: CircleAlert, frame: "border-destructive/30 bg-destructive/5", text: "text-destructive" },
  unknown: { icon: CircleHelp, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  disabled: { icon: CirclePause, frame: "border-border bg-muted/20", text: "text-muted-foreground" },
  cleanup: { icon: TriangleAlert, frame: "border-destructive/30 bg-destructive/5", text: "text-destructive" },
};

/**
 * What replaced `Desired vs. remote-applied state`.
 *
 * The old block gave the top third of the card to a revision number and two
 * sha256 hashes — debugging evidence no operator decision depends on. This says
 * the same thing in one sentence, puts the button that resolves it right there,
 * and keeps every original field one click away under Sync details.
 */
function EdgeSyncBar({
  server,
  isAdmin,
  applying,
  onApply,
  onClear,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  applying: boolean;
  onApply: () => void;
  onClear: () => void;
}) {
  const [open, setOpen] = useState(false);
  const summary = edgeSyncSummary(server);
  const tone = SYNC_TONES[summary.tone];
  const Icon = tone.icon;
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border", tone.frame)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3">
        <div className="flex min-w-0 items-start gap-2">
          <Icon className={cn("mt-0.5 size-4 shrink-0", tone.text)} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{summary.headline}</p>
            <p className="text-xs text-muted-foreground">{summary.detail}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              Sync details
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
            </Button>
          </CollapsibleTrigger>
          {isAdmin && (
            <EdgeSyncAction server={server} summary={summary} applying={applying} onApply={onApply} onClear={onClear} />
          )}
        </div>
      </div>
      <CollapsibleContent>
        <EdgeSyncDetails server={server} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The single primary action, sitting beside the sentence that motivates it. */
function EdgeSyncAction({
  server,
  summary,
  applying,
  onApply,
  onClear,
}: {
  server: EdgeNatServer;
  summary: EdgeSyncSummary;
  applying: boolean;
  onApply: () => void;
  onClear: () => void;
}) {
  if (!server.enabled) {
    if (!edgeReconciliation(server).cleanupRequired) return null;
    return <Button variant="destructive" size="sm" onClick={onClear}><Trash2 /> {summary.actionLabel}</Button>;
  }
  return (
    <Button
      size="sm"
      variant={summary.actionUrgent ? "default" : "outline"}
      disabled={applying || !server.hostKeyEnrolled}
      title={server.hostKeyEnrolled ? undefined : "Finish SSH enrollment before applying rules"}
      onClick={onApply}
    >
      {applying ? <Loader2 className="animate-spin" /> : <Check />}{summary.actionLabel}
    </Button>
  );
}

/** Tier 4: revisions, hashes, counts, the forwarding flag, the pinned key. */
function EdgeSyncDetails({ server }: { server: EdgeNatServer }) {
  return (
    <div className="space-y-2 border-t p-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {edgeSyncFacts(server).map((fact) => <SyncDetailFact key={fact.label} fact={fact} />)}
      </div>
      <p className="text-xs text-muted-foreground">
        Revisions and ruleset hashes are the evidence behind the line above: PolySIEM keeps what it observed on the edge
        separate from what is saved here, and compares the two. They are useful when a state looks wrong.
      </p>
    </div>
  );
}

function SyncDetailFact({ fact }: { fact: EdgeSyncFact }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{fact.label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("mt-0.5 min-w-0 flex-1 truncate font-medium", fact.mono && "font-mono text-xs")}>{fact.value}</p>
        {fact.copy && <CopyButton value={fact.copy} label={`Copy ${fact.label.toLowerCase()}`} />}
      </div>
    </div>
  );
}

function ServerFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p></div>;
}

function ServerStateBadge({ state }: { state: ReturnType<typeof edgeServerState> }) {
  const label = { online: "Online", offline: "Offline", unverified: "Awaiting verification", disabled: "Disabled" }[state];
  return <Badge variant={state === "online" ? "secondary" : state === "offline" ? "destructive" : "outline"} className="font-normal">{state === "online" && <span className="size-1.5 rounded-full bg-success" />}{label}</Badge>;
}

function TailscaleCard({ network }: { network: EdgeNetworksOverview["tailscale"][number] }) {
  const details = tailscaleDetails(network);
  return (
    <Card>
      <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Network className="size-4" />{network.name ?? network.tailnet ?? "Tailscale"}</CardTitle><CardDescription>{details.domain ?? "Tailnet domain not discovered"}</CardDescription></div>{details.magicDnsEnabled !== undefined && <Badge variant="outline">MagicDNS {details.magicDnsEnabled ? "on" : "off"}</Badge>}</div></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><ServerFact label="Devices" value={String(details.deviceCount)} /><ServerFact label="Online" value={String(details.onlineDeviceCount)} /><ServerFact label="Subnet routes" value={String(details.subnetRoutes.length)} /><ServerFact label="Exit nodes" value={String(details.exitNodes.length)} /></div>
        {details.subnetRoutes.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Private routes</p><div className="flex flex-wrap gap-1.5">{details.subnetRoutes.map((route) => <Badge key={route} variant="secondary" className="font-mono font-normal">{route}</Badge>)}</div></div>}
        {details.exitNodes.length > 0 && <div><p className="mb-2 text-xs font-medium text-muted-foreground">Internet entry points</p><div className="flex flex-wrap gap-1.5">{details.exitNodes.map((node) => <Badge key={node.name} variant="outline"><ExternalLink className="size-3" />{node.name}{node.online === false ? " · offline" : ""}</Badge>)}</div></div>}
        {details.nameservers.length > 0 && <p className="text-xs text-muted-foreground">DNS: <span className="font-mono text-foreground">{details.nameservers.join(", ")}</span></p>}
      </CardContent>
    </Card>
  );
}

function EdgeNetworksSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 rounded-lg" />
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
