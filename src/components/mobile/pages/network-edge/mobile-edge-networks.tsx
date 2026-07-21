"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Cloud,
  ExternalLink,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Route,
  Router,
  ScanLine,
  Server,
  Share2,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { EmptyState } from "@/components/shared/empty-state";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import {
  EDGE_NETWORKS_QUERY_KEY,
  EMPTY_EDGE_NETWORKS_OVERVIEW,
  edgeOverviewPresentation,
  edgeReconciliation,
  edgeServerState,
  isRuleApplied,
  sshEndpoint,
  tailscaleDetails,
  type EdgeNatRule,
  type EdgeNatServer,
  type EdgeNetworkTab,
  type EdgeNetworksOverview,
  type OtherEdgeNetwork,
} from "@/components/network/edge-networks-types";
import { MobileNatRuleSheet } from "./mobile-nat-rule-sheet";
import { cloudflareZoneForHostname } from "@/components/network/edge-network-utils";

const ADD_HREFS: Record<EdgeNetworkTab, string> = {
  edge: "/settings/integrations?add=EDGE_NAT_SERVER",
  tailscale: "/settings/integrations?add=TAILSCALE",
  cloudflare: "/settings/integrations?add=CLOUDFLARE",
};

/** Phone edge networks panel: same query and endpoints as the desktop panel. */
export function MobileEdgeNetworks({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const overviewQuery = useQuery({
    queryKey: EDGE_NETWORKS_QUERY_KEY,
    queryFn: () => apiFetch<EdgeNetworksOverview>("/api/network/edge-networks"),
    refetchInterval: 30_000,
  });
  const overview = overviewQuery.data ?? EMPTY_EDGE_NETWORKS_OVERVIEW;
  const { cloudflare, counts, hasAnyNetwork, defaultTab } = edgeOverviewPresentation(overview);
  const tabParam = searchParams.get("tab");
  const tab: EdgeNetworkTab = tabParam === "edge" || tabParam === "tailscale" || tabParam === "cloudflare" ? tabParam : defaultTab;

  return (
    <>
      <MobilePageHeader
        title="Edge networks"
        actions={
          <button
            type="button"
            aria-label="Refresh"
            disabled={overviewQuery.isFetching}
            onClick={() => void overviewQuery.refetch()}
            className="flex size-10 items-center justify-center rounded-full text-muted-foreground active:bg-muted"
          >
            <RefreshCw className={cn("size-4.5", overviewQuery.isFetching && "animate-spin")} />
          </button>
        }
      >
        <MobileSegmented
          items={[
            { label: `SSH · ${overview.edgeServers.length}`, href: "/network/edge-networks?tab=edge", active: tab === "edge" },
            { label: `Tailnet · ${overview.tailscale.length}`, href: "/network/edge-networks?tab=tailscale", active: tab === "tailscale" },
            { label: `Cloudflare · ${cloudflare.length}`, href: "/network/edge-networks?tab=cloudflare", active: tab === "cloudflare" },
          ]}
        />
      </MobilePageHeader>

      <MobilePage>
        {overviewQuery.isLoading && (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        )}

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
          />
        )}

        {!overviewQuery.isLoading && !overviewQuery.isError && hasAnyNetwork && tab === "edge" && (
          <>
            <MobileStatStrip>
              <MobileStat label="Online" value={`${counts.onlineServers}/${overview.edgeServers.length}`} icon={<Server />} />
              <MobileStat label="Rules" value={counts.enabledRules} icon={<Route />} />
              <MobileStat
                label="Review"
                value={counts.needsReconcile}
                icon={<TriangleAlert />}
                tone={counts.needsReconcile > 0 ? "text-warning" : undefined}
              />
            </MobileStatStrip>
            {overview.edgeServers.length === 0 ? (
              <EmptyState
                icon={Server}
                title="No SSH-managed edge boxes"
                description="Add an Edge NAT server to publish selected services through a remote IP."
              />
            ) : (
              overview.edgeServers.map((server) => (
                <MobileEdgeServerSection key={server.id} server={server} isAdmin={isAdmin} />
              ))
            )}
          </>
        )}

        {!overviewQuery.isLoading && !overviewQuery.isError && hasAnyNetwork && tab === "tailscale" && (
          overview.tailscale.length === 0 ? (
            <EmptyState
              icon={Share2}
              title="No Tailscale integration"
              description="Connect a tailnet to inventory private routes, exit nodes, devices, and DNS identity."
            />
          ) : (
            overview.tailscale.map((network, index) => (
              <MobileTailscaleSection key={network.id ?? network.integrationId ?? index} network={network} />
            ))
          )
        )}

        {!overviewQuery.isLoading && !overviewQuery.isError && hasAnyNetwork && tab === "cloudflare" && (
          cloudflare.length === 0 ? (
            <EmptyState
              icon={Cloud}
              title="No Cloudflare integration"
              description="Connect a Cloudflare account to document and manage published tunnel routes."
            />
          ) : (
            cloudflare.map((network) => (
              <MobileCloudflareSection key={network.id} network={network} isAdmin={isAdmin} />
            ))
          )
        )}
      </MobilePage>

      {isAdmin && (
        <MobileFab
          aria-label={
            tab === "edge" ? "Add Edge NAT server" : tab === "tailscale" ? "Connect Tailscale" : "Connect Cloudflare"
          }
          onClick={() => router.push(ADD_HREFS[tab])}
        >
          <Plus />
        </MobileFab>
      )}
    </>
  );
}

function ServerStateBadge({ state }: { state: ReturnType<typeof edgeServerState> }) {
  const label = { online: "Online", offline: "Offline", unverified: "Unverified", disabled: "Disabled" }[state];
  return (
    <Badge
      variant={state === "online" ? "secondary" : state === "offline" ? "destructive" : "outline"}
      className="text-[10px] font-normal"
    >
      {state === "online" && <span className="size-1.5 rounded-full bg-success" />}
      {label}
    </Badge>
  );
}

function MobileEdgeServerSection({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [selectedRule, setSelectedRule] = useState<EdgeNatRule | null>(null);
  const [ruleForm, setRuleForm] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const [deleteRule, setDeleteRule] = useState<EdgeNatRule | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const state = edgeServerState(server);
  const settings = server.settings ?? {};
  const reconciliation = edgeReconciliation(server);
  const pending =
    settings.pendingChanges || server.rules.some((rule) => rule.enabled && !isRuleApplied(rule, settings.lastAppliedAt));
  const driftLabel = {
    in_sync: "In sync",
    pending: "Pending apply",
    drifted: "Drift detected",
    unknown: "Remote unknown",
  }[reconciliation.drift];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });

  const applyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Applied NAT rules on ${server.name}`);
      invalidate();
    },
    onError: (error: Error) => toast.error(`Could not apply rules: ${error.message}`),
  });
  const verifyMutation = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; detail: string }>(`/api/admin/integrations/${server.id}/test`, { method: "POST" }),
    onSuccess: (result) =>
      result.ok
        ? toast.success(result.detail || "SSH connection verified")
        : toast.error(result.detail || "SSH verification failed"),
    onError: (error: Error) => toast.error(`SSH verification failed: ${error.message}`),
  });
  const deleteMutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("NAT rule removed. Apply changes to update the server.");
      setDeleteRule(null);
      setSelectedRule(null);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
  const clearMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/clear`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Remote NAT rules cleared on ${server.name}`);
      setClearOpen(false);
      invalidate();
    },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });

  const selectedApplied = selectedRule ? isRuleApplied(selectedRule, settings.lastAppliedAt) : false;

  return (
    <MobileSection title={server.name}>
      <MobileList>
        <MobileListRow
          title={
            <>
              <span className="truncate">{server.name}</span>
              <ServerStateBadge state={state} />
            </>
          }
          subtitle={<span className="font-mono">ssh://{sshEndpoint(server.baseUrl)}</span>}
          trailing={
            <Badge
              variant={
                reconciliation.drift === "in_sync" ? "secondary" : reconciliation.drift === "drifted" ? "destructive" : "outline"
              }
              className="text-[10px]"
            >
              {driftLabel}
            </Badge>
          }
        />
        <MobileKeyRow label="Public IP" mono>
          {settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? "Not detected"}
        </MobileKeyRow>
        <MobileKeyRow label="SSH host key">
          {server.hostKeyEnrolled || settings.hostKeyVerified
            ? state === "online"
              ? "Pinned and verified"
              : "Pinned; verify connection"
            : "Enrollment required"}
        </MobileKeyRow>
        <MobileKeyRow label="Forwarding">
          {(settings.syncedSnapshot?.ipForwarding ?? settings.enableIpForwarding) ? "Enabled" : "Disabled"}
        </MobileKeyRow>
        <MobileKeyRow label="Last checked">
          {server.lastSyncAt ? formatRelative(server.lastSyncAt) : "Not checked yet"}
        </MobileKeyRow>
        <MobileKeyRow label="Rules confirmed remote">
          {reconciliation.desiredRuleCount ?? 0} desired · {reconciliation.appliedRuleCount ?? "unknown"} applied
        </MobileKeyRow>
      </MobileList>

      {(server.lastSyncError || settings.lastApplyError) && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {settings.lastApplyError ?? server.lastSyncError}
        </p>
      )}
      {!server.enabled && (
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {reconciliation.cleanupRequired
            ? "Disabled here, but previously applied remote rules may still forward traffic until they are cleared."
            : "Disabled and remotely cleared."}
        </p>
      )}
      {isAdmin && server.enabled && !server.hostKeyEnrolled && (
        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          SSH enrollment is not finished. Complete the guided setup from the desktop view before applying rules.
        </p>
      )}

      {server.rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
          No ports are published. This server exposes no lab targets until a rule is added and applied.
        </p>
      ) : (
        <MobileList>
          {server.rules.map((rule) => {
            const applied = isRuleApplied(rule, settings.lastAppliedAt);
            return (
              <MobileListRow
                key={rule.id}
                onClick={() => setSelectedRule(rule)}
                title={
                  <>
                    <span className="truncate">{rule.name}</span>
                    <Badge variant={applied ? "secondary" : "outline"} className="text-[10px]">
                      {!rule.enabled ? "Disabled" : applied ? "Applied" : "Pending"}
                    </Badge>
                  </>
                }
                subtitle={
                  <span className="font-mono">
                    {rule.protocol} :{rule.publicPort} → {rule.targetAddress}:{rule.targetPort}
                  </span>
                }
                trailing={
                  rule.sourceCidr ? (
                    <span className="max-w-24 truncate font-mono text-[11px]">{rule.sourceCidr}</span>
                  ) : (
                    <span className="text-warning">any src</span>
                  )
                }
              />
            );
          })}
        </MobileList>
      )}

      {isAdmin && server.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRuleForm({ open: true, rule: null })}
          >
            <Plus /> Add rule
          </Button>
          {server.hostKeyEnrolled ? (
            <Button
              size="sm"
              disabled={applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
              {pending ? "Apply changes" : "Apply rules"}
            </Button>
          ) : (
            <Button size="sm" disabled>
              <Check /> Apply rules
            </Button>
          )}
          {server.hostKeyEnrolled && (
            <Button
              variant="outline"
              size="sm"
              className="col-span-2"
              disabled={verifyMutation.isPending}
              onClick={() => verifyMutation.mutate()}
            >
              {verifyMutation.isPending ? <Loader2 className="animate-spin" /> : <ScanLine />} Verify SSH
            </Button>
          )}
        </div>
      )}
      {isAdmin && !server.enabled && reconciliation.cleanupRequired && (
        <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}>
          <Trash2 /> Clear remote rules
        </Button>
      )}

      <BottomSheet
        open={selectedRule !== null}
        onOpenChange={(open) => !open && setSelectedRule(null)}
        title={selectedRule?.name ?? "NAT rule"}
        description={`Published on ${server.name}`}
      >
        {selectedRule && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="divide-y divide-border/60 rounded-xl border bg-card">
              <MobileKeyRow label="Edge listener" mono>
                {selectedRule.protocol} :{selectedRule.publicPort}
              </MobileKeyRow>
              <MobileKeyRow label="Private target" mono>
                {selectedRule.targetAddress}:{selectedRule.targetPort}
              </MobileKeyRow>
              <MobileKeyRow label="Allowed source" mono>
                {selectedRule.sourceCidr || "Any source"}
              </MobileKeyRow>
              <MobileKeyRow label="Status">
                {!selectedRule.enabled ? "Disabled" : selectedApplied ? "Applied" : "Pending apply"}
              </MobileKeyRow>
            </div>
            {isAdmin && server.enabled && (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setRuleForm({ open: true, rule: selectedRule });
                    setSelectedRule(null);
                  }}
                >
                  <Pencil /> Edit rule
                </Button>
                <Button variant="destructive" onClick={() => setDeleteRule(selectedRule)}>
                  <Trash2 /> Remove rule
                </Button>
              </div>
            )}
          </div>
        )}
      </BottomSheet>

      {ruleForm.open && (
        <MobileNatRuleSheet
          server={server}
          rule={ruleForm.rule}
          onOpenChange={(open) => setRuleForm((current) => ({ ...current, open }))}
        />
      )}

      <AlertDialog open={deleteRule !== null} onOpenChange={(open) => !open && setDeleteRule(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {deleteRule?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              The rule will be removed from PolySIEM, then must be applied before the edge server&apos;s firewall changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleteMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (deleteRule) deleteMutation.mutate(deleteRule.id);
              }}
            >
              {deleteMutation.isPending && <Loader2 className="animate-spin" />}
              Remove rule
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear every remote NAT rule on {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends an empty managed ruleset to the edge server. Desired rules remain saved in PolySIEM, but traffic
              may continue until the remote server confirms cleanup.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={clearMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                clearMutation.mutate();
              }}
            >
              {clearMutation.isPending && <Loader2 className="animate-spin" />}
              Clear remote rules
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileSection>
  );
}


function MobileTailscaleSection({ network }: { network: EdgeNetworksOverview["tailscale"][number] }) {
  const details = tailscaleDetails(network);
  return (
    <MobileSection title={network.name ?? network.tailnet ?? "Tailscale"}>
      <MobileList>
        <MobileKeyRow label="Domain" mono>
          {details.domain ?? "Not discovered"}
        </MobileKeyRow>
        {details.magicDnsEnabled !== undefined && (
          <MobileKeyRow label="MagicDNS">{details.magicDnsEnabled ? "On" : "Off"}</MobileKeyRow>
        )}
        <MobileKeyRow label="Devices">
          {details.onlineDeviceCount} online of {details.deviceCount}
        </MobileKeyRow>
        {details.nameservers.length > 0 && (
          <MobileKeyRow label="DNS" mono>
            {details.nameservers.join(", ")}
          </MobileKeyRow>
        )}
      </MobileList>
      {details.subnetRoutes.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Private routes</p>
          <div className="flex flex-wrap gap-1.5">
            {details.subnetRoutes.map((route) => (
              <Badge key={route} variant="secondary" className="font-mono text-[11px] font-normal">
                {route}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {details.exitNodes.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <p className="mb-1.5 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">
            Internet entry points
          </p>
          <div className="flex flex-wrap gap-1.5">
            {details.exitNodes.map((node) => (
              <Badge key={node.name} variant="outline" className="text-[11px]">
                <ExternalLink className="size-3" />
                {node.name}
                {node.online === false ? " · offline" : ""}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </MobileSection>
  );
}

interface MobileCloudflareRoute {
  tunnelId: string;
  tunnelName: string;
  hostname: string;
  service: string;
  path: string;
  zoneId: string | null;
}

function MobileCloudflareSection({ network, isAdmin }: { network: OtherEdgeNetwork; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MobileCloudflareRoute | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<MobileCloudflareRoute | null>(null);
  const tunnels = Array.isArray(network.tunnels) ? network.tunnels : [];
  const routes: MobileCloudflareRoute[] = tunnels.flatMap((tunnel) =>
    (tunnel.ingress ?? []).flatMap((ingress) => {
      if (!tunnel.id || !ingress.hostname) return [];
      return [
        {
          tunnelId: tunnel.id,
          tunnelName: tunnel.name,
          hostname: ingress.hostname,
          service: ingress.service,
          path: ingress.path ?? "",
          zoneId: cloudflareZoneForHostname(network, ingress.hostname)?.id ?? null,
        },
      ];
    }),
  );

  const removeMutation = useMutation({
    mutationFn: (route: MobileCloudflareRoute) =>
      apiFetch<{ warning?: string | null }>(`/api/network/edge-networks/cloudflare/${network.id}/routes`, {
        method: "DELETE",
        body: JSON.stringify({ tunnelId: route.tunnelId, zoneId: route.zoneId, hostname: route.hostname }),
      }),
    onSuccess: (result) => {
      toast.success("Cloudflare published route removed");
      if (result.warning) toast.warning(result.warning);
      setConfirmRemove(null);
      setSelected(null);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => {
      toast.error(error.message);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
  });

  return (
    <MobileSection title={network.name}>
      <MobileList>
        <MobileKeyRow label="Account">{network.account?.name ?? "Cloudflare account"}</MobileKeyRow>
        <MobileKeyRow label="Tunnels">{tunnels.length}</MobileKeyRow>
        <MobileKeyRow label="Published hostnames">{routes.length}</MobileKeyRow>
      </MobileList>

      {isAdmin && network.routeManagementCapability?.status === "denied" && (
        <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          Route changes need an edit-capable Cloudflare token. Upgrade it from the desktop view under Settings →
          Integrations.
        </p>
      )}

      {tunnels.length > 0 && (
        <MobileList>
          {tunnels.map((tunnel) => (
            <MobileListRow
              key={tunnel.id ?? tunnel.name}
              title={<span className="truncate">{tunnel.name}</span>}
              trailing={
                <>
                  <Badge variant="outline" className="text-[10px]">
                    {tunnel.status ?? "unknown"}
                  </Badge>
                  <Badge variant={tunnel.configSource === "cloudflare" ? "secondary" : "outline"} className="text-[10px]">
                    {tunnel.configSource === "cloudflare" ? "remote" : "local"}
                  </Badge>
                </>
              }
            />
          ))}
        </MobileList>
      )}

      {routes.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
          No published hostname routes found.
        </p>
      ) : (
        <MobileList>
          {routes.map((route) => (
            <MobileListRow
              key={`${route.tunnelId}:${route.hostname}`}
              onClick={() => setSelected(route)}
              title={<span className="truncate">{route.hostname}</span>}
              subtitle={
                <span className="font-mono">
                  {route.service}
                  {route.path && ` ${route.path}`}
                </span>
              }
              trailing={<span className="max-w-24 truncate">{route.tunnelName}</span>}
            />
          ))}
        </MobileList>
      )}

      <BottomSheet
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.hostname ?? "Published route"}
        description={`Tunnel ingress on ${network.name}`}
      >
        {selected && (
          <div className="flex flex-col gap-3 pb-2">
            <div className="divide-y divide-border/60 rounded-xl border bg-card">
              <MobileKeyRow label="Hostname" mono>
                {selected.hostname}
              </MobileKeyRow>
              <MobileKeyRow label="Tunnel">{selected.tunnelName}</MobileKeyRow>
              <MobileKeyRow label="Origin service" mono>
                {selected.service}
              </MobileKeyRow>
              {selected.path && (
                <MobileKeyRow label="Path" mono>
                  {selected.path}
                </MobileKeyRow>
              )}
            </div>
            {isAdmin && (
              <Button
                variant="destructive"
                className="w-full"
                disabled={!selected.zoneId}
                onClick={() => setConfirmRemove(selected)}
              >
                <Trash2 /> Remove route
              </Button>
            )}
          </div>
        )}
      </BottomSheet>

      <AlertDialog open={confirmRemove !== null} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {confirmRemove?.hostname}?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the tunnel ingress rule and its matching CNAME record from Cloudflare. Other tunnel routes and
              DNS records are preserved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={removeMutation.isPending || !confirmRemove?.zoneId}
              onClick={(event) => {
                event.preventDefault();
                if (confirmRemove?.zoneId) removeMutation.mutate(confirmRemove);
              }}
            >
              {removeMutation.isPending && <Loader2 className="animate-spin" />}
              Remove route
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </MobileSection>
  );
}
