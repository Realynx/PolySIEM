"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ellipsis,
  Loader2,
  LockKeyhole,
  Network,
  PlugZap,
  Plus,
  Route,
  ScanLine,
  Server,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
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
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  connectorSummary,
  edgeInterfaceChoices,
  EDGE_NETWORKS_QUERY_KEY,
  edgeServerState,
  sshEndpoint,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
} from "./edge-networks-types";
import { EdgeCardCollapseTrigger } from "./edge-card-collapse";
import { ConnectorsCard, useConnectorsQuery } from "./connectors-card";
import { EdgeNatRulesTab, NatRuleDialog } from "./edge-nat-rules";
import { EdgeInterfacesTab } from "./edge-interfaces-tab";
import { EdgeWireguardCard, edgeWireguardTabStatus, useEdgeWireguardQuery } from "./edge-wireguard-card";
import { SshEnrollmentDialog } from "./edge-ssh-enrollment-dialog";
import { EdgeSyncBar } from "./edge-sync-bar";
import { RelayPathDiagram } from "./edge-relay-path";
import { RelaySetupChecklist } from "./edge-setup-checklist";
import { relayHealthPath, relaySetupProgress, type RelaySetupAction } from "./edge-relay-presentation";

/** Every mutation the card head can start, so the card itself stays a layout. */
function useEdgeServerMutations(server: EdgeNatServer, callbacks: { onDeleted: () => void; onCleared: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
  const apply = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => { toast.success(`Applied relayed ports on ${server.name}`); refresh(); },
    onError: (error: Error) => toast.error(`Could not apply to ${server.name}: ${error.message}`),
  });
  const remove = useMutation({
    mutationFn: (ruleId: string) => apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Relayed port removed. Apply changes to update the relay server."); callbacks.onDeleted(); refresh(); },
    onError: (error: Error) => toast.error(error.message),
  });
  const verify = useMutation({
    mutationFn: () => apiFetch<{ ok: boolean; detail: string }>(`/api/admin/integrations/${server.id}/test`, { method: "POST" }),
    onSuccess: (result) => result.ok ? toast.success(result.detail || "SSH connection verified") : toast.error(result.detail || "SSH verification failed"),
    onError: (error: Error) => toast.error(`SSH verification failed: ${error.message}`),
  });
  const clear = useMutation({
    mutationFn: () => apiFetch<{ cleared: boolean; appliedRuleCount: number }>(`/api/network/edge-networks/servers/${server.id}/clear`, { method: "POST" }),
    onSuccess: () => { toast.success(`Relayed ports cleared on ${server.name}`); callbacks.onCleared(); refresh(); },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });
  return { apply, remove, verify, clear };
}

/**
 * One relay server.
 *
 * The head is the always-visible story: who this server is, the relay path
 * drawn as its health (Internet → relay → tunnel → connector → services, each
 * with its own state), the guided setup until it is finished, and the sync
 * line with the one button that resolves it. Everything that is a *place to
 * work* (ports, connectors, the tunnel, interfaces) sits behind the card's own
 * tab bar, and that work area collapses.
 */
export function EdgeServerCard({
  server,
  servers,
  isAdmin,
  defaultExpanded,
}: {
  server: EdgeNatServer;
  /** Every relay server, so a connector row can name the others it also serves. */
  servers: EdgeNatServer[];
  isAdmin: boolean;
  defaultExpanded: boolean;
}) {
  // Remembered per card, for as long as it is mounted.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [ruleDialog, setRuleDialog] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const [deleteRule, setDeleteRule] = useState<EdgeNatRule | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  // Owned here so the setup checklist and the rule editor can both send an
  // operator to the right tab instead of dead-ending.
  const [tab, setTab] = useState<EdgeServerTabValue>("routes");
  const [linkOpen, setLinkOpen] = useState(false);
  // Shared query keys with the tabs, so the head and the tabs read one fetch each.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];
  const wgQuery = useEdgeWireguardQuery(server);
  const context = { connectors, tunnel: wgQuery.data?.settings };
  const progress = relaySetupProgress(server, context);
  const mutations = useEdgeServerMutations(server, {
    onDeleted: () => setDeleteRule(null),
    onCleared: () => setClearOpen(false),
  });

  const openRule = (rule: EdgeNatRule | null) => setRuleDialog({ open: true, rule });
  const openTab = (next: EdgeServerTabValue) => { setTab(next); setExpanded(true); };
  const runSetupAction = (action: RelaySetupAction) => {
    const handlers: Record<RelaySetupAction, () => void> = {
      ssh: () => setEnrollmentOpen(true),
      tunnel: () => openTab("tunnel"),
      connectors: () => openTab("connectors"),
      "add-port": () => openRule(null),
      apply: () => mutations.apply.mutate(),
    };
    handlers[action]();
  };

  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-(--card-spacing)">
        <CardHeader className="gap-3 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <EdgeServerIdentity server={server} />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isAdmin && server.enabled && (
                <EdgeServerActions
                  server={server}
                  verifying={mutations.verify.isPending}
                  onSetupSsh={() => setEnrollmentOpen(true)}
                  onVerify={() => mutations.verify.mutate()}
                  onAddRule={() => openRule(null)}
                />
              )}
              <EdgeCardCollapseTrigger expanded={expanded} count={server.rules.length} name={server.name} />
            </div>
          </div>

          {server.enabled && <RelayPathDiagram hops={relayHealthPath(server, context)} />}
          {server.enabled && !progress.complete && (
            <RelaySetupChecklist
              progress={progress}
              isAdmin={isAdmin}
              busyAction={mutations.apply.isPending ? "apply" : null}
              onAction={runSetupAction}
            />
          )}
          <EdgeSyncBar
            server={server}
            isAdmin={isAdmin}
            applying={mutations.apply.isPending}
            onApply={() => mutations.apply.mutate()}
            onClear={() => setClearOpen(true)}
          />
          <EdgeServerAlerts server={server} />
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
        onLinkConnector={isAdmin ? () => { openTab("connectors"); setLinkOpen(true); } : undefined}
      />
      <RemovePortDialog
        rule={deleteRule}
        pending={mutations.remove.isPending}
        onCancel={() => setDeleteRule(null)}
        onConfirm={(rule) => mutations.remove.mutate(rule.id)}
      />
      <ClearRelayDialog
        server={server}
        open={clearOpen}
        pending={mutations.clear.isPending}
        onOpenChange={setClearOpen}
        onConfirm={() => mutations.clear.mutate()}
      />
    </Card>
  );
}

function RemovePortDialog({
  rule,
  pending,
  onCancel,
  onConfirm,
}: {
  rule: EdgeNatRule | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (rule: EdgeNatRule) => void;
}) {
  return (
    <AlertDialog open={rule !== null} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop relaying {rule?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The port is removed from PolySIEM straight away, but the relay server keeps forwarding it until you apply.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={(event) => { event.preventDefault(); if (rule) onConfirm(rule); }}>
            {pending && <Loader2 className="animate-spin" />}Remove relayed port
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ClearRelayDialog({
  server,
  open,
  pending,
  onOpenChange,
  onConfirm,
}: {
  server: EdgeNatServer;
  open: boolean;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop relaying everything on {server.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            This sends an empty managed ruleset to the relay server. Your saved ports stay in PolySIEM, but traffic may
            keep flowing until the relay server confirms the cleanup.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={(event) => { event.preventDefault(); onConfirm(); }}>
            {pending && <Loader2 className="animate-spin" />}Clear remote rules
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
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
          <span>{hostKeyFactValue(server)}</span>
          {/* Address and last check live on the relay node of the path below;
              a disabled server has no path, so it keeps them here. */}
          {!server.enabled && (
            <>
              <StripDot />
              <span>relays from <span className="font-mono text-foreground/80">{publicIp ?? "an address not detected yet"}</span></span>
              <StripDot />
              <span>{server.lastSyncAt ? `checked ${formatRelative(server.lastSyncAt)}` : "not checked yet"}</span>
            </>
          )}
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
      <Button variant="outline" size="sm" onClick={onAddRule}><Plus /> Relay a port</Button>
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

/**
 * Genuine faults only. Unfinished setup is the checklist's job and the
 * disabled-server story is the sync line's, so neither is repeated here.
 * Each alert names which half failed and what to try next.
 */
function EdgeServerAlerts({ server }: { server: EdgeNatServer }) {
  const settings = server.settings ?? {};
  if (settings.lastApplyError) {
    return (
      <Alert variant="destructive">
        <TriangleAlert />
        <AlertTitle>The last apply failed</AlertTitle>
        <AlertDescription>
          <p className="break-words">{settings.lastApplyError}</p>
          <p>The relay server keeps running its previous ruleset. Fix the cause, then apply again.</p>
        </AlertDescription>
      </Alert>
    );
  }
  if (!server.lastSyncError) return null;
  return (
    <Alert variant="destructive">
      <TriangleAlert />
      <AlertTitle>PolySIEM cannot reach this relay server</AlertTitle>
      <AlertDescription>
        <p className="break-words">{server.lastSyncError}</p>
        <p>If the VPS itself is up, relayed ports keep working; only changes and health checks wait. Check the VPS, then use Test connection.</p>
      </AlertDescription>
    </Alert>
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
            label="Ports"
            icon={Route}
            badge={String(server.rules.length)}
            ariaLabel={`Relayed ports, ${server.rules.length}`}
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
            ariaLabel={`Relay tunnel, ${tunnel.label}`}
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


function ServerStateBadge({ state }: { state: ReturnType<typeof edgeServerState> }) {
  const label = { online: "Online", offline: "Offline", unverified: "Awaiting verification", disabled: "Disabled" }[state];
  return <Badge variant={state === "online" ? "secondary" : state === "offline" ? "destructive" : "outline"} className="font-normal">{state === "online" && <span className="size-1.5 rounded-full bg-success" />}{label}</Badge>;
}

function StripDot() {
  return <span className="text-muted-foreground/50" aria-hidden="true">·</span>;
}
