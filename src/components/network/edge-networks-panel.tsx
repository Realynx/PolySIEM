"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  Cloud,
  Copy,
  ExternalLink,
  Globe2,
  Loader2,
  LockKeyhole,
  Network,
  Pencil,
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { buildEdgeBootstrapCommand } from "@/lib/integrations/edge-nat/bootstrap";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
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
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  edgeOverviewCounts,
  edgeReconciliation,
  edgeServerState,
  isRuleApplied,
  sshEndpoint,
  tailscaleDetails,
  type EdgeNatRule,
  type EdgeNatServer,
  type EdgeNetworksOverview,
  type NatProtocol,
  type NatRuleInput,
  type OtherEdgeNetwork,
} from "./edge-networks-types";

const EMPTY_OVERVIEW: EdgeNetworksOverview = { edgeServers: [], tailscale: [], cloudflare: [], otherNetworks: [] };

export function EdgeNetworksPanel({ isAdmin }: { isAdmin: boolean }) {
  const overviewQuery = useQuery({
    queryKey: ["edge-networks"],
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_OVERVIEW;
  const cloudflare = overview.cloudflare ?? overview.otherNetworks.filter((network) => network.type === "CLOUDFLARE");
  const counts = edgeOverviewCounts(overview);
  const hasEdgeServers = overview.edgeServers.length > 0;
  const hasAnyNetwork = overview.edgeServers.length > 0 || overview.tailscale.length > 0 || cloudflare.length > 0;
  const defaultTab = hasEdgeServers ? "edge" : overview.tailscale.length > 0 ? "tailscale" : "cloudflare";

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
          description={(overviewQuery.error as Error)?.message ?? "The edge network inventory is unavailable."}
          action={<Button onClick={() => void overviewQuery.refetch()}>Try again</Button>}
        />
      )}

      {!overviewQuery.isLoading && !overviewQuery.isError && !hasAnyNetwork && (
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
      )}

      {!overviewQuery.isLoading && !overviewQuery.isError && hasAnyNetwork && (
        <Tabs defaultValue={defaultTab} className="gap-5">
          <div className="overflow-x-auto pb-1">
            <TabsList className="grid h-10 min-w-[19rem] w-full grid-cols-3 sm:inline-grid sm:w-auto">
              <EdgeNetworkTab value="edge" label="SSH edge boxes" mobileLabel="SSH" count={overview.edgeServers.length} icon={Server} />
              <EdgeNetworkTab value="tailscale" label="Tailscale" mobileLabel="Tailnet" count={overview.tailscale.length} icon={Share2} />
              <EdgeNetworkTab value="cloudflare" label="Cloudflare" mobileLabel="Cloudflare" count={cloudflare.length} icon={Cloud} />
            </TabsList>
          </div>

          <TabsContent value="edge" className="space-y-6">
            {hasEdgeServers ? (
              <>
                <TrafficBoundary servers={overview.edgeServers} />

                <div className="grid gap-3 sm:grid-cols-3">
                  <SummaryCard label="Edge servers online" value={`${counts.onlineServers}/${overview.edgeServers.length}`} icon={Server} />
                  <SummaryCard label="Enabled NAT rules" value={String(counts.enabledRules)} icon={Route} />
                  <SummaryCard label="Servers needing review" value={String(counts.needsReconcile)} icon={TriangleAlert} />
                </div>

                <section className="space-y-3" aria-labelledby="edge-nat-heading">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                      <h2 id="edge-nat-heading" className="text-lg font-semibold">SSH-managed edge boxes</h2>
                      <p className="text-sm text-muted-foreground">Only the selected edge IP and listening ports are published.</p>
                    </div>
                    {isAdmin && (
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/settings/integrations?add=EDGE_NAT_SERVER"><Plus /> Add server</Link>
                      </Button>
                    )}
                  </div>
                  <Alert>
                    <TriangleAlert />
                    <AlertTitle>Disabling PolySIEM management does not remove remote NAT rules</AlertTitle>
                    <AlertDescription>Previously applied rules can keep forwarding traffic until the edge server confirms an empty ruleset. Disabled servers stay listed here so cleanup remains visible and auditable.</AlertDescription>
                  </Alert>
                  <div className="space-y-4">
                    {overview.edgeServers.map((server) => (
                      <EdgeServerCard key={server.id} server={server} isAdmin={isAdmin} />
                    ))}
                  </div>
                </section>
              </>
            ) : (
              <EdgeNetworkTabEmpty
                icon={Server}
                title="No SSH-managed edge boxes"
                description="Add an Edge NAT server to publish selected services through a remote IP."
                addHref="/settings/integrations?add=EDGE_NAT_SERVER"
                addLabel="Add Edge NAT server"
                isAdmin={isAdmin}
              />
            )}
          </TabsContent>

          <TabsContent value="tailscale">
            {overview.tailscale.length > 0 ? (
              <section className="space-y-3" aria-labelledby="tailscale-edge-heading">
                <div>
                  <h2 id="tailscale-edge-heading" className="text-lg font-semibold">Tailscale</h2>
                  <p className="text-sm text-muted-foreground">Private overlay entry points, subnet routes, exit nodes, and DNS identity.</p>
                </div>
                <div className="grid gap-4 xl:grid-cols-2">
                  {overview.tailscale.map((network, index) => (
                    <TailscaleCard key={network.id ?? network.integrationId ?? index} network={network} />
                  ))}
                </div>
              </section>
            ) : (
              <EdgeNetworkTabEmpty
                icon={Share2}
                title="No Tailscale integration"
                description="Connect a tailnet to inventory private routes, exit nodes, devices, and DNS identity."
                addHref="/settings/integrations?add=TAILSCALE"
                addLabel="Connect Tailscale"
                isAdmin={isAdmin}
              />
            )}
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
      )}
    </div>
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

interface PublishedRouteRow {
  integrationId: string;
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  service: string;
  path: string;
  zoneId: string | null;
}

function zoneForHostname(network: OtherEdgeNetwork, hostname: string) {
  return [...(network.zones ?? [])]
    .filter((zone) => hostname === zone.name || hostname.endsWith(`.${zone.name}`))
    .sort((a, b) => b.name.length - a.name.length)[0] ?? null;
}

function CloudflarePublishedRoutes({ integrations, isAdmin }: { integrations: OtherEdgeNetwork[]; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [selectedIntegrationId, setSelectedIntegrationId] = useState(integrations[0]?.id ?? "");
  const [addFor, setAddFor] = useState<OtherEdgeNetwork | null>(null);
  const [upgradeFor, setUpgradeFor] = useState<OtherEdgeNetwork | null>(null);
  const [removeRoute, setRemoveRoute] = useState<PublishedRouteRow | null>(null);
  const selectedIntegration = integrations.find((network) => network.id === selectedIntegrationId) ?? integrations[0];
  const tunnels = selectedIntegration && Array.isArray(selectedIntegration.tunnels) ? selectedIntegration.tunnels : [];
  const editableTunnels = tunnels.filter((tunnel) => tunnel.configSource === "cloudflare");
  const rows = selectedIntegration && Array.isArray(selectedIntegration.tunnels)
    ? selectedIntegration.tunnels.flatMap((tunnel) => (tunnel.ingress ?? []).flatMap((ingress) => {
        if (!tunnel.id || !ingress.hostname) return [];
        return [{
          integrationId: selectedIntegration.id,
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          hostname: ingress.hostname,
          service: ingress.service,
          path: ingress.path ?? "",
          zoneId: zoneForHostname(selectedIntegration, ingress.hostname)?.id ?? null,
        }];
      }))
    : [];
  const removeMutation = useMutation({
    mutationFn: (route: PublishedRouteRow) => apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${route.integrationId}/routes`, {
      method: "DELETE",
      body: JSON.stringify({ tunnelId: route.tunnelId, zoneId: route.zoneId, hostname: route.hostname }),
    }),
    onSuccess: (result: { warning?: string | null }) => {
      toast.success("Cloudflare published route removed");
      if (result.warning) toast.warning(result.warning);
      setRemoveRoute(null);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
  });

  return (
    <section className="space-y-3" aria-labelledby="cloudflare-routes-heading">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="cloudflare-routes-heading" className="flex items-center gap-2 text-lg font-semibold"><Cloud className="size-5" />Cloudflare published routes</h2>
          <p className="text-sm text-muted-foreground">Manage public hostnames here; each observed route also becomes evidence for the Services catalog.</p>
        </div>
        {integrations.length > 1 && (
          <div className="grid min-w-64 gap-1.5">
            <Label htmlFor="cloudflare-integration" className="text-xs text-muted-foreground">Cloudflare integration</Label>
            <Select value={selectedIntegration?.id} onValueChange={setSelectedIntegrationId}>
              <SelectTrigger id="cloudflare-integration" className="w-full bg-background">
                <SelectValue placeholder="Choose an integration" />
              </SelectTrigger>
              <SelectContent>
                {integrations.map((network) => (
                  <SelectItem key={network.id} value={network.id}>
                    {network.name}{network.account?.name && network.account.name !== network.name ? ` · ${network.account.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {isAdmin && selectedIntegration?.routeManagementCapability?.status === "denied" && (
        <Alert className="border-warning/50 bg-warning/10">
          <LockKeyhole className="text-warning" />
          <AlertTitle>Route changes need an edit-capable Cloudflare token</AlertTitle>
          <AlertDescription>
            The Read All Resources policy is enough for discovery. To add or remove routes, use a token scoped to <strong>Cloudflare Tunnel Edit</strong>, <strong>Zone Read</strong>, and <strong>DNS Edit</strong> for the selected account and zones.
          </AlertDescription>
        </Alert>
      )}
      {selectedIntegration && (
        <Card size="sm">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{selectedIntegration.name}</CardTitle>
                <CardDescription>{selectedIntegration.account?.name ?? "Cloudflare account"} · {tunnels.length} tunnel{tunnels.length === 1 ? "" : "s"} · {rows.length} published hostname{rows.length === 1 ? "" : "s"}</CardDescription>
              </div>
              {isAdmin && <div className="flex flex-wrap justify-end gap-2">
                {selectedIntegration.routeManagementCapability?.status === "denied" && <Button variant="outline" size="sm" onClick={() => setUpgradeFor(selectedIntegration)}><LockKeyhole />Upgrade token</Button>}
                <Button size="sm" disabled={editableTunnels.length === 0 || !(selectedIntegration.zones?.length)} onClick={() => setAddFor(selectedIntegration)}><Plus />Add route</Button>
              </div>}
            </div>
          </CardHeader>
          <CardContent>
            {tunnels.length > 0 ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {tunnels.map((tunnel) => <div key={tunnel.id ?? tunnel.name} className="flex min-w-0 items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><span className="truncate font-medium">{tunnel.name}</span><div className="flex shrink-0 items-center gap-2"><Badge variant="outline">{tunnel.status ?? "unknown"}</Badge><Badge variant={tunnel.configSource === "cloudflare" ? "secondary" : "outline"}>{tunnel.configSource === "cloudflare" ? "remote" : "local"}</Badge></div></div>)}
              </div>
            ) : <p className="text-sm text-muted-foreground">No tunnels were found in the latest sync.</p>}
            {tunnels.length > 0 && editableTunnels.length === 0 && <p className="mt-2 text-xs text-warning">Local YAML tunnel configurations are read-only here; move the tunnel to remote configuration before editing routes.</p>}
          </CardContent>
        </Card>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Hostname</TableHead><TableHead>Tunnel</TableHead><TableHead>Origin service</TableHead>{isAdmin && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
          <TableBody>
            {rows.length === 0 ? <TableRow><TableCell colSpan={isAdmin ? 4 : 3} className="py-8 text-center text-muted-foreground">No published hostname routes found.</TableCell></TableRow> : rows.map((route) => (
              <TableRow key={`${route.integrationId}:${route.tunnelId}:${route.hostname}`}>
                <TableCell className="font-medium">{route.hostname}{route.path && <span className="font-normal text-muted-foreground">{route.path}</span>}</TableCell>
                <TableCell>{route.tunnelName}</TableCell>
                <TableCell className="font-mono text-xs">{route.service}</TableCell>
                {isAdmin && <TableCell><Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" disabled={!route.zoneId} aria-label={`Remove ${route.hostname}`} onClick={() => setRemoveRoute(route)}><Trash2 /></Button></TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {addFor && <CloudflareRouteDialog integration={addFor} open onOpenChange={(open) => !open && setAddFor(null)} />}
      {upgradeFor && <CloudflareTokenUpgradeDialog integration={upgradeFor} open onOpenChange={(open) => !open && setUpgradeFor(null)} />}
      <AlertDialog open={removeRoute !== null} onOpenChange={(open) => !open && setRemoveRoute(null)}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>Remove {removeRoute?.hostname}?</AlertDialogTitle><AlertDialogDescription>This removes the tunnel ingress rule and its matching CNAME record from Cloudflare. Other tunnel routes and DNS records are preserved.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction variant="destructive" disabled={removeMutation.isPending || !removeRoute?.zoneId} onClick={(event) => { event.preventDefault(); if (removeRoute?.zoneId) removeMutation.mutate(removeRoute); }}>{removeMutation.isPending && <Loader2 className="animate-spin" />}Remove route</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

const CLOUDFLARE_ROUTE_PERMISSION_TEXT = [
  "Account → Cloudflare Tunnel → Edit",
  "Zone → Zone → Read",
  "Zone → DNS → Edit",
  "Account resources → Include → the connected account",
  "Zone resources → Include → only the zones PolySIEM may publish",
].join("\n");

function CloudflareTokenUpgradeDialog({ integration, open, onOpenChange }: { integration: OtherEdgeNetwork; open: boolean; onOpenChange: (open: boolean) => void }) {
  const copyPermissions = async () => {
    try {
      await copyText(CLOUDFLARE_ROUTE_PERMISSION_TEXT);
      toast.success("Permission checklist copied");
    } catch {
      toast.error("Could not copy the permission checklist");
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100svh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enable route management for {integration.name}</DialogTitle>
          <DialogDescription>
            Use either path below. PolySIEM never needs permission to create or administer your other Cloudflare API tokens.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border bg-muted/30 p-4">
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-medium">Required token policy</p><p className="mt-1 text-xs text-muted-foreground">Scope it to {integration.account?.name ?? "this account"} and only the zones PolySIEM should publish.</p></div>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyPermissions()}><Copy />Copy</Button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Account permission</p><p className="mt-1 text-sm font-medium">Cloudflare Tunnel · Edit</p></div>
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone discovery</p><p className="mt-1 text-sm font-medium">Zone · Read</p></div>
              <div className="rounded-md border bg-background p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Zone permission</p><p className="mt-1 text-sm font-medium">DNS · Edit</p></div>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col rounded-lg border p-4">
              <Badge variant="secondary" className="mb-3 w-fit">Fastest</Badge>
              <h3 className="font-medium">Edit the current token</h3>
              <ol className="mt-2 flex-1 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
                <li>Open Cloudflare API Tokens and choose the token used by this integration.</li>
                <li>Edit its policies and add the two permissions above.</li>
                <li>Save it, return here, and retry Add route. The stored token secret normally stays valid.</li>
              </ol>
              <Button className="mt-4" variant="outline" asChild>
                <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Edit current token <ExternalLink /></a>
              </Button>
            </div>
            <div className="flex flex-col rounded-lg border p-4">
              <Badge variant="outline" className="mb-3 w-fit">Clean replacement</Badge>
              <h3 className="font-medium">Create a dedicated token</h3>
              <ol className="mt-2 flex-1 list-decimal space-y-2 pl-4 text-sm text-muted-foreground">
                <li>Create a Custom Token with the two permissions above.</li>
                <li>Restrict account and zone resources, then copy the secret shown once.</li>
                <li>Use the button below to open this exact integration with credential replacement ready.</li>
              </ol>
              <div className="mt-4 grid gap-2">
                <Button variant="outline" asChild><a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noreferrer">Create token <ExternalLink /></a></Button>
                <Button asChild><Link href={`/settings/integrations?edit=${encodeURIComponent(integration.id)}&upgrade=cloudflare-routes`}>Paste replacement token <ArrowRight /></Link></Button>
              </div>
            </div>
          </div>

          <Alert>
            <ShieldCheck />
            <AlertTitle>Least privilege stays intact</AlertTitle>
            <AlertDescription>Do not add API Tokens Edit or Account API Tokens Write. Those permissions manage credentials themselves and are not needed for tunnel routes or DNS.</AlertDescription>
          </Alert>
        </div>
        <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Done</Button></DialogClose></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CloudflareRouteDialog({ integration, open, onOpenChange }: { integration: OtherEdgeNetwork; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const tunnels = Array.isArray(integration.tunnels) ? integration.tunnels.filter((tunnel) => tunnel.id && tunnel.configSource === "cloudflare") : [];
  const zones = integration.zones ?? [];
  const [tunnelId, setTunnelId] = useState(tunnels[0]?.id ?? "");
  const [zoneId, setZoneId] = useState(zones[0]?.id ?? "");
  const [hostname, setHostname] = useState("");
  const [service, setService] = useState("http://");
  const [path, setPath] = useState("");
  const selectedZone = zones.find((zone) => zone.id === zoneId);
  const mutation = useMutation({
    mutationFn: () => apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${integration.id}/routes`, {
      method: "POST",
      body: JSON.stringify({ tunnelId, zoneId, hostname: hostname.trim(), service: service.trim(), path: path.trim() }),
    }),
    onSuccess: (result: { warning?: string | null }) => {
      toast.success(`Published ${hostname.trim()} through Cloudflare`);
      if (result.warning) toast.warning(result.warning);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
          <DialogHeader><DialogTitle>Add a Cloudflare hostname route</DialogTitle><DialogDescription>PolySIEM adds the tunnel ingress rule and a proxied CNAME pointing to the selected tunnel.</DialogDescription></DialogHeader>
          <div className="space-y-4 py-5">
            <div className="grid gap-2"><Label htmlFor="cf-route-tunnel">Tunnel</Label><Select value={tunnelId} onValueChange={setTunnelId}><SelectTrigger id="cf-route-tunnel"><SelectValue placeholder="Choose a remotely managed tunnel" /></SelectTrigger><SelectContent>{tunnels.map((tunnel) => <SelectItem key={tunnel.id} value={tunnel.id!}>{tunnel.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-zone">DNS zone</Label><Select value={zoneId} onValueChange={setZoneId}><SelectTrigger id="cf-route-zone"><SelectValue placeholder="Choose a zone" /></SelectTrigger><SelectContent>{zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-hostname">Published hostname</Label><Input id="cf-route-hostname" value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder={selectedZone ? `app.${selectedZone.name}` : "app.example.com"} required /><p className="text-xs text-muted-foreground">Enter the complete hostname in the selected zone.</p></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-service">Origin service</Label><Input id="cf-route-service" value={service} onChange={(event) => setService(event.target.value)} placeholder="http://10.0.3.20:8080" required /><p className="text-xs text-muted-foreground">The address cloudflared can reach inside the lab.</p></div>
            <div className="grid gap-2"><Label htmlFor="cf-route-path">Path filter (optional)</Label><Input id="cf-route-path" value={path} onChange={(event) => setPath(event.target.value)} placeholder="/api/*" /></div>
          </div>
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={mutation.isPending || !tunnelId || !zoneId}>{mutation.isPending && <Loader2 className="animate-spin" />}Publish route</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TrafficBoundary({ servers }: { servers: EdgeNatServer[] }) {
  const publicIps = servers.map((server) => server.settings?.syncedSnapshot?.publicIp ?? server.settings?.publicIp).filter(Boolean);
  return (
    <Card className="bg-primary/[0.03]">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-success" />Port forwards terminate at the edge</CardTitle>
        <CardDescription>Inbound traffic reaches the remote server first, keeping the home WAN address out of the public forwarding rule.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid items-center gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1fr]" role="img" aria-label="Internet traffic reaches the edge server public IP, passes an allowlisted NAT rule, then reaches a private lab target">
          <BoundaryNode icon={Globe2} label="Internet" detail="Untrusted source" />
          <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
          <BoundaryNode icon={Router} label="Edge public IP" detail={publicIps.length > 0 ? publicIps.join(", ") : "Remote address only"} emphasized />
          <ArrowRight className="mx-auto size-4 rotate-90 text-muted-foreground sm:rotate-0" aria-hidden="true" />
          <BoundaryNode icon={LockKeyhole} label="Private lab target" detail="WAN address absent from rule" />
        </div>
      </CardContent>
      <div className="border-t px-4 pt-3 text-xs text-muted-foreground">
        This protects the forwarding path, not every possible identity leak. Application responses, DNS, WebRTC, and logs still need their own review.
      </div>
    </Card>
  );
}

function BoundaryNode({ icon: Icon, label, detail, emphasized = false }: { icon: typeof Router; label: string; detail: string; emphasized?: boolean }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3 rounded-lg border p-3", emphasized && "border-primary/30 bg-primary/5")}>
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted"><Icon className="size-4" /></div>
      <div className="min-w-0"><p className="font-medium">{label}</p><p className="truncate text-xs text-muted-foreground">{detail}</p></div>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Server }) {
  return <Card size="sm"><CardContent className="flex items-center justify-between gap-3"><div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p></div><Icon className="size-5 text-muted-foreground" /></CardContent></Card>;
}

function EdgeServerCard({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const [deleteRule, setDeleteRule] = useState<EdgeNatRule | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const state = edgeServerState(server);
  const settings = server.settings ?? {};
  const reconciliation = edgeReconciliation(server);
  const pending = settings.pendingChanges || server.rules.some((rule) => rule.enabled && !isRuleApplied(rule, settings.lastAppliedAt));
  const applyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => { toast.success(`Applied NAT rules on ${server.name}`); void queryClient.invalidateQueries({ queryKey: ["edge-networks"] }); },
    onError: (error: Error) => toast.error(`Could not apply rules: ${error.message}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) => apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("NAT rule removed. Apply changes to update the server."); setDeleteRule(null); void queryClient.invalidateQueries({ queryKey: ["edge-networks"] }); },
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
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });

  return (
    <Card>
      <CardHeader className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Server className="size-5" /></div>
            <div className="min-w-0">
              <CardTitle className="flex flex-wrap items-center gap-2">{server.name}<ServerStateBadge state={state} /></CardTitle>
              <CardDescription className="mt-1 font-mono">ssh://{sshEndpoint(server.baseUrl)}</CardDescription>
            </div>
          </div>
          {isAdmin && (
            <div className="flex flex-wrap gap-2">
              {!server.enabled && reconciliation.cleanupRequired && <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}><Trash2 /> Clear remote rules</Button>}
              {server.enabled && <Button variant="outline" size="sm" onClick={() => setEnrollmentOpen(true)}>
                <LockKeyhole /> {server.hostKeyEnrolled ? "SSH trust" : "Set up SSH"}
              </Button>}
              {server.enabled && server.hostKeyEnrolled && <Button variant="outline" size="sm" disabled={verifyMutation.isPending} onClick={() => verifyMutation.mutate()}>{verifyMutation.isPending ? <Loader2 className="animate-spin" /> : <ScanLine />} Verify SSH</Button>}
              {server.enabled && <Button variant="outline" size="sm" onClick={() => setRuleDialog({ open: true, rule: null })}><Plus /> Add NAT rule</Button>}
              {server.enabled && <Button size="sm" disabled={applyMutation.isPending || !server.hostKeyEnrolled} onClick={() => applyMutation.mutate()}>
                {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}{pending ? "Apply changes" : "Apply rules"}
              </Button>}
            </div>
          )}
        </div>

        <ReconciliationStatus server={server} />

        {!server.enabled && (
          <Alert variant={reconciliation.cleanupRequired ? "destructive" : "default"}>
            <TriangleAlert />
            <AlertTitle>{reconciliation.cleanupRequired ? "Disabled here, but remote rules may still be live" : "Disabled and remotely cleared"}</AlertTitle>
            <AlertDescription>
              {reconciliation.cleanupRequired
                ? "Sync and normal management are off. Traffic can continue through the last applied ruleset until Clear remote rules succeeds and the remote server reports zero managed rules."
                : "The integration is disabled and the last observed remote state contains no PolySIEM-managed NAT rules."}
            </AlertDescription>
          </Alert>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <ServerFact label="Public IP" value={settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? "Not detected"} mono />
          <ServerFact
            label="SSH host key"
            value={server.hostKeyEnrolled || settings.hostKeyVerified
              ? state === "online" ? "Pinned and verified" : "Pinned; verify connection"
              : "Enrollment required"}
          />
          <ServerFact label="Forwarding" value={settings.syncedSnapshot?.ipForwarding ?? settings.enableIpForwarding ? "Enabled" : "Disabled"} />
          <ServerFact label="Last checked" value={server.lastSyncAt ? formatRelative(server.lastSyncAt) : "Not checked yet"} />
        </div>

        {(server.lastSyncError || settings.lastApplyError) && (
          <Alert variant="destructive"><TriangleAlert /><AlertTitle>Server needs attention</AlertTitle><AlertDescription>{settings.lastApplyError ?? server.lastSyncError}</AlertDescription></Alert>
        )}

        {isAdmin && server.enabled && !server.hostKeyEnrolled && (
          <Alert>
            <LockKeyhole />
            <AlertTitle>Finish SSH enrollment before applying rules</AlertTitle>
            <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
              Install this integration&apos;s generated public key, then pin the server&apos;s observed host key so PolySIEM cannot silently connect to an impostor.
              <Button size="sm" onClick={() => setEnrollmentOpen(true)}>Set up SSH</Button>
            </AlertDescription>
          </Alert>
        )}

        {server.rules.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">No ports are published</p>
            <p className="mt-1 text-sm text-muted-foreground">This server exposes no lab targets until an explicit rule is added and applied.</p>
            {isAdmin && server.enabled && <Button variant="outline" size="sm" className="mt-3" onClick={() => setRuleDialog({ open: true, rule: null })}><Plus /> Add first rule</Button>}
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border">
            <Table>
              <TableHeader><TableRow><TableHead>Rule</TableHead><TableHead>Edge listener</TableHead><TableHead>Private target</TableHead><TableHead className="hidden md:table-cell">Allowed source</TableHead><TableHead>Status</TableHead>{isAdmin && server.enabled && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}</TableRow></TableHeader>
              <TableBody>{server.rules.map((rule) => {
                const applied = isRuleApplied(rule, settings.lastAppliedAt);
                return (
                <TableRow key={rule.id}>
                  <TableCell className="font-medium">{rule.name}</TableCell>
                  <TableCell className="font-mono text-xs"><span className="uppercase">{rule.protocol}</span> :{rule.publicPort}</TableCell>
                  <TableCell className="font-mono text-xs">{rule.targetAddress}:{rule.targetPort}</TableCell>
                  <TableCell className="hidden font-mono text-xs md:table-cell">{rule.sourceCidr || <span className="font-sans text-warning">Any source</span>}</TableCell>
                  <TableCell><Badge variant={applied ? "secondary" : "outline"}>{!rule.enabled ? "Disabled" : applied ? "Applied" : "Pending apply"}</Badge></TableCell>
                  {isAdmin && server.enabled && <TableCell><div className="flex justify-end gap-1"><Button variant="ghost" size="icon-sm" aria-label={`Edit ${rule.name}`} onClick={() => setRuleDialog({ open: true, rule })}><Pencil /></Button><Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${rule.name}`} onClick={() => setDeleteRule(rule)}><Trash2 /></Button></div></TableCell>}
                </TableRow>
                );
              })}</TableBody>
            </Table>
          </div>
        )}
        <p className="text-xs text-muted-foreground">Only rules marked Applied are confirmed in the last successful remote ruleset. The forwarding rule publishes the edge address instead of directly publishing the home router&apos;s WAN address.</p>
      </CardContent>

      <SshEnrollmentDialog server={server} open={enrollmentOpen} onOpenChange={setEnrollmentOpen} />
      <NatRuleDialog server={server} rule={ruleDialog.rule} open={ruleDialog.open} onOpenChange={(open) => setRuleDialog((current) => ({ ...current, open }))} />
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
  const selected = selectedFingerprint || hostKeyQuery.data?.enrolledFingerprint || (hostKeyQuery.data?.keys.length === 1 ? hostKeyQuery.data.keys[0]?.fingerprint : "");
  const enrollMutation = useMutation({
    mutationFn: ({ fingerprint, username }: { fingerprint: string; username: string }) =>
      apiFetch<{ installed: boolean; detail: string }>(`/api/network/edge-networks/servers/${server.id}/provision`, {
        method: "POST",
        body: JSON.stringify({ adminUsername: username, fingerprint }),
      }),
    onSuccess: (result) => {
      toast.success(result.detail || "Edge service installed and SSH verified");
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
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
            {bootstrapCommand ? (
              <CopyBlock value={bootstrapCommand} label="Setup command" />
            ) : publicKey ? (
              <>
                <CopyBlock value={publicKey} label="Public key" />
                <p className="text-xs text-warning">The setup command could not be generated. Recreate this integration before continuing.</p>
              </>
            ) : (
              <Alert variant="destructive"><TriangleAlert /><AlertTitle>Generated public key unavailable</AlertTitle><AlertDescription>Edit or recreate the integration before continuing.</AlertDescription></Alert>
            )}
            {settings.publicKeyFingerprint && <p className="text-xs text-muted-foreground">PolySIEM key fingerprint: <code>{settings.publicKeyFingerprint}</code></p>}
          </EnrollmentStep>

          <EnrollmentStep number="2" title="Scan the server identity">
            <p className="text-sm text-muted-foreground">Compare an observed fingerprint with the server console before trusting it. Pinning this key prevents a changed or impersonated SSH host from being accepted silently.</p>
            {hostKeyQuery.isLoading && <div className="space-y-2"><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
            {hostKeyQuery.isError && (
              <Alert
                variant="destructive"
                aria-label={`Could not scan the SSH host key: ${(hostKeyQuery.error as Error).message}`}
              >
                <TriangleAlert />
                <AlertTitle>Could not scan the SSH host key:</AlertTitle>
                <AlertDescription>{` ${(hostKeyQuery.error as Error).message}`}</AlertDescription>
              </Alert>
            )}
            {hostKeyQuery.data && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Observed at <code>{hostKeyQuery.data.host}:{hostKeyQuery.data.port}</code></p>
                {hostKeyQuery.data.keys.length === 0 ? <p className="text-sm text-warning">No host keys were returned.</p> : hostKeyQuery.data.keys.map((key) => (
                  <button key={`${key.algorithm}:${key.fingerprint}`} type="button" onClick={() => setSelectedFingerprint(key.fingerprint)} className={cn("flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent", selected === key.fingerprint && "border-primary bg-primary/5")}>
                    <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", selected === key.fingerprint && "border-primary bg-primary text-primary-foreground")}>{selected === key.fingerprint && <Check className="size-3" />}</span>
                    <span className="min-w-0"><span className="block text-xs font-medium uppercase text-muted-foreground">{key.algorithm}</span><code className="block break-all text-xs">{key.fingerprint}</code></span>
                  </button>
                ))}
              </div>
            )}
            <Button type="button" variant="outline" size="sm" disabled={hostKeyQuery.isFetching} onClick={() => void hostKeyQuery.refetch()}><RefreshCw className={cn(hostKeyQuery.isFetching && "animate-spin")} /> Scan again</Button>
          </EnrollmentStep>

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

function EnrollmentStep({ number, title, children }: { number: string; title: string; children: ReactNode }) {
  return <section className="grid gap-3 sm:grid-cols-[2rem_1fr]"><div className="flex size-7 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">{number}</div><div className="min-w-0 space-y-3"><h3 className="font-medium">{title}</h3>{children}</div></section>;
}

function CopyBlock({ value, label }: { value: string; label: string }) {
  return <div className="relative rounded-lg bg-muted p-3 pr-12"><pre className="max-h-36 overflow-auto whitespace-pre-wrap break-all text-xs"><code>{value}</code></pre><CopyButton value={value} label={`Copy ${label}`} className="absolute right-2 top-2" /></div>;
}

function ReconciliationStatus({ server }: { server: EdgeNatServer }) {
  const state = edgeReconciliation(server);
  const statusLabel = { in_sync: "In sync", pending: "Pending apply", drifted: "Drift detected", unknown: "Remote state unknown" }[state.drift];
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">Desired vs. remote-applied state</p>
          <p className="text-xs text-muted-foreground">Remote evidence is kept separate from saved intent.</p>
        </div>
        <Badge variant={state.drift === "in_sync" ? "secondary" : state.drift === "drifted" ? "destructive" : "outline"}>{statusLabel}</Badge>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ReconciliationFact label="Desired revision" value={formatRevision(state.desiredRevision)} />
        <ReconciliationFact label="Applied revision" value={formatRevision(state.appliedRevision)} />
        <ReconciliationFact label="Desired hash" value={shortHash(state.desiredHash)} mono />
        <ReconciliationFact label="Applied hash" value={shortHash(state.appliedHash)} mono />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Desired {state.desiredRuleCount ?? 0} · confirmed remote {state.appliedRuleCount ?? "unknown"}
        {state.observedAt ? ` · observed ${formatRelative(state.observedAt)}` : " · no remote observation yet"}
      </p>
    </div>
  );
}

function ReconciliationFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-0.5 font-medium", mono && "font-mono text-xs")}>{value}</p></div>;
}

function shortHash(value?: string | null) {
  return value ? value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value : "Unknown";
}

function formatRevision(value?: string | number | null) {
  return value === null || value === undefined ? "Unknown" : String(value);
}

function ServerFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p></div>;
}

function ServerStateBadge({ state }: { state: ReturnType<typeof edgeServerState> }) {
  const label = { online: "Online", offline: "Offline", unverified: "Awaiting verification", disabled: "Disabled" }[state];
  return <Badge variant={state === "online" ? "secondary" : state === "offline" ? "destructive" : "outline"} className="font-normal">{state === "online" && <span className="size-1.5 rounded-full bg-success" />}{label}</Badge>;
}

function NatRuleDialog({ server, rule, open, onOpenChange }: { server: EdgeNatServer; rule: EdgeNatRule | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => ruleToForm(rule), [rule]);
  const [form, setForm] = useState<NatRuleForm>(initial);
  const currentForm = open && form.ruleId !== (rule?.id ?? null) ? initial : form;
  const mutation = useMutation({
    mutationFn: (input: NatRuleInput) => apiFetch(
      rule ? `/api/network/edge-networks/servers/${server.id}/rules/${rule.id}` : `/api/network/edge-networks/servers/${server.id}/rules`,
      { method: rule ? "PATCH" : "POST", body: JSON.stringify(input) },
    ),
    onSuccess: () => { toast.success(`${rule ? "Updated" : "Added"} NAT rule. Apply changes when ready.`); onOpenChange(false); void queryClient.invalidateQueries({ queryKey: ["edge-networks"] }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const publicPort = Number(currentForm.publicPort);
    const targetPort = Number(currentForm.targetPort);
    if (!currentForm.name.trim() || !currentForm.targetAddress.trim() || !validPort(publicPort) || !validPort(targetPort)) { toast.error("Enter a name, private target, and valid ports from 1–65535."); return; }
    mutation.mutate({ name: currentForm.name.trim(), protocol: currentForm.protocol, publicPort, targetAddress: currentForm.targetAddress.trim(), targetPort, sourceCidr: currentForm.sourceCidr.trim() || undefined, enabled: currentForm.enabled });
  };
  const update = (patch: Partial<NatRuleForm>) => setForm({ ...currentForm, ...patch });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader><DialogTitle>{rule ? "Edit" : "Add"} NAT rule</DialogTitle><DialogDescription>Publish one listener on {server.name} and send it to a private lab address.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5"><Label htmlFor="nat-name">Rule name</Label><Input id="nat-name" value={currentForm.name} onChange={(event) => update({ name: event.target.value })} placeholder="Plex HTTPS" autoFocus /></div>
            <div className="grid gap-3 sm:grid-cols-[0.7fr_1fr]">
              <div className="grid gap-1.5"><Label>Protocol</Label><Select value={currentForm.protocol} onValueChange={(value) => update({ protocol: value as NatProtocol })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tcp">TCP</SelectItem><SelectItem value="udp">UDP</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="public-port">Edge port</Label><Input id="public-port" inputMode="numeric" value={currentForm.publicPort} onChange={(event) => update({ publicPort: event.target.value })} placeholder="443" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr]">
              <div className="grid gap-1.5"><Label htmlFor="target-address">Private target address</Label><Input id="target-address" value={currentForm.targetAddress} onChange={(event) => update({ targetAddress: event.target.value })} placeholder="100.64.0.12 or 10.0.3.20" /></div>
              <div className="grid gap-1.5"><Label htmlFor="target-port">Target port</Label><Input id="target-port" inputMode="numeric" value={currentForm.targetPort} onChange={(event) => update({ targetPort: event.target.value })} placeholder="32400" /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="source-cidr">Allowed source CIDR <span className="font-normal text-muted-foreground">(recommended)</span></Label><Input id="source-cidr" value={currentForm.sourceCidr} onChange={(event) => update({ sourceCidr: event.target.value })} placeholder="203.0.113.0/24" /><p className={cn("text-xs", currentForm.sourceCidr ? "text-muted-foreground" : "text-warning")}>{currentForm.sourceCidr ? "Only this source range can enter the rule." : "Blank allows traffic from any internet address."}</p></div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><Label htmlFor="nat-enabled">Rule enabled</Label><p className="text-xs text-muted-foreground">Disabled rules remain saved but are not installed.</p></div><Switch id="nat-enabled" checked={currentForm.enabled} onCheckedChange={(enabled) => update({ enabled })} /></div>
          </div>
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={mutation.isPending}>{mutation.isPending && <Loader2 className="animate-spin" />}{rule ? "Save rule" : "Add rule"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface NatRuleForm { ruleId: string | null; name: string; protocol: NatProtocol; publicPort: string; targetAddress: string; targetPort: string; sourceCidr: string; enabled: boolean }
function ruleToForm(rule: EdgeNatRule | null): NatRuleForm { return { ruleId: rule?.id ?? null, name: rule?.name ?? "", protocol: rule?.protocol ?? "tcp", publicPort: rule ? String(rule.publicPort) : "", targetAddress: rule?.targetAddress ?? "", targetPort: rule ? String(rule.targetPort) : "", sourceCidr: rule?.sourceCidr ?? "", enabled: rule?.enabled ?? true }; }
function validPort(value: number) { return Number.isInteger(value) && value >= 1 && value <= 65535; }

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
  return <div className="space-y-6"><Skeleton className="h-40 rounded-xl" /><div className="grid gap-3 sm:grid-cols-3">{Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-24 rounded-xl" />)}</div><Skeleton className="h-72 rounded-xl" /></div>;
}
