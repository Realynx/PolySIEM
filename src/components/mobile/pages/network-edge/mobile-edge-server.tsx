"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Pencil, Plus, ScanLine, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  connectorDisplayName,
  connectorRouteWarning,
  edgeInterfaceChoices,
  edgeInterfaceOptions,
  edgeReconciliation,
  edgeServerState,
  edgeWireguardStatus,
  isRuleApplied,
  isValidEdgeInterfaceName,
  ruleRouteMode,
  sshEndpoint,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { MobileConnectorsBlock, connectorsTabBadge, useConnectorsQuery } from "./mobile-connectors";
import {
  MobileStateSegmented,
  MobileTabPanel,
  EDGE_SERVER_TABS,
  type EdgeServerTab,
  type MobileSegmentedTab,
} from "./mobile-edge-tabs";
import { MobileSelectField } from "./mobile-form-controls";
import { MobileNatRuleSheet } from "./mobile-nat-rule-sheet";
import { MobileWireguardBlock } from "./mobile-wireguard";

const DRIFT_LABEL: Record<string, string> = {
  in_sync: "In sync",
  pending: "Pending apply",
  drifted: "Drift detected",
  unknown: "Remote unknown",
};

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

function driftBadgeVariant(drift: string): "secondary" | "destructive" | "outline" {
  if (drift === "in_sync") return "secondary";
  return drift === "drifted" ? "destructive" : "outline";
}

/**
 * Always-visible identity and sync state: who this edge is, whether PolySIEM
 * can reach it, and whether the remote firewall matches what is saved here.
 * The four tabs below it change; this does not.
 */
function EdgeServerHeaderCard({
  server,
  reconciliation,
}: {
  server: EdgeNatServer;
  reconciliation: ReturnType<typeof edgeReconciliation>;
}) {
  return (
    <MobileList>
      <MobileListRow
        title={
          <>
            <span className="truncate">{server.name}</span>
            <ServerStateBadge state={edgeServerState(server)} />
          </>
        }
        subtitle={<span className="font-mono">ssh://{sshEndpoint(server.baseUrl)}</span>}
        trailing={
          <Badge variant={driftBadgeVariant(reconciliation.drift)} className="text-[10px]">
            {DRIFT_LABEL[reconciliation.drift] ?? "Remote unknown"}
          </Badge>
        }
      />
      <MobileKeyRow label="Rules confirmed remote">
        {reconciliation.desiredRuleCount ?? 0} desired · {reconciliation.appliedRuleCount ?? "unknown"} applied
      </MobileKeyRow>
      <MobileKeyRow label="Last checked">
        {server.lastSyncAt ? formatRelative(server.lastSyncAt) : "Not checked yet"}
      </MobileKeyRow>
    </MobileList>
  );
}

/** Sync errors, the disabled-but-still-forwarding warning, and unfinished enrollment. */
function EdgeServerAlerts({
  server,
  reconciliation,
  isAdmin,
}: {
  server: EdgeNatServer;
  reconciliation: ReturnType<typeof edgeReconciliation>;
  isAdmin: boolean;
}) {
  const settings = server.settings ?? {};
  const failure = settings.lastApplyError ?? server.lastSyncError;
  return (
    <>
      {failure && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {failure}
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
    </>
  );
}

/** Add rule / apply / verify — always reachable, whichever tab is showing. */
function EdgeApplyActions({
  server,
  pending,
  onAddRule,
}: {
  server: EdgeNatServer;
  pending: boolean;
  onAddRule: () => void;
}) {
  const queryClient = useQueryClient();
  const applyMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/apply`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Applied NAT rules on ${server.name}`);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not apply rules: ${error.message}`),
  });
  const verifyMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; detail: string }>(`/api/admin/integrations/${server.id}/test`, { method: "POST" }),
    onSuccess: (result) =>
      result.ok
        ? toast.success(result.detail || "SSH connection verified")
        : toast.error(result.detail || "SSH verification failed"),
    onError: (error: Error) => toast.error(`SSH verification failed: ${error.message}`),
  });

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" size="sm" onClick={onAddRule}>
        <Plus /> Add rule
      </Button>
      {server.hostKeyEnrolled ? (
        <Button size="sm" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>
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
  );
}

/** Only for a disabled server whose remote rules were never cleared. */
function EdgeCleanupAction({ server }: { server: EdgeNatServer }) {
  const queryClient = useQueryClient();
  const [clearOpen, setClearOpen] = useState(false);
  const clearMutation = useMutation({
    mutationFn: () => apiFetch(`/api/network/edge-networks/servers/${server.id}/clear`, { method: "POST" }),
    onSuccess: () => {
      toast.success(`Remote NAT rules cleared on ${server.name}`);
      setClearOpen(false);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Remote cleanup failed: ${error.message}`),
  });

  return (
    <>
      <Button variant="destructive" size="sm" onClick={() => setClearOpen(true)}>
        <Trash2 /> Clear remote rules
      </Button>
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear every remote NAT rule on {server.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This sends an empty managed ruleset to the edge server. Desired rules remain saved in PolySIEM, but
              traffic may continue until the remote server confirms cleanup.
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
    </>
  );
}

/** One published listener, with its applied/pending state and route mode. */
function EdgeRuleRow({
  rule,
  applied,
  onSelect,
}: {
  rule: EdgeNatRule;
  applied: boolean;
  onSelect: () => void;
}) {
  return (
    <MobileListRow
      onClick={onSelect}
      title={
        <>
          <span className="truncate">{rule.name}</span>
          <Badge variant={applied ? "secondary" : "outline"} className="text-[10px]">
            {ruleStateLabel(rule, applied)}
          </Badge>
          {ruleRouteMode(rule) === "connector" && (
            <Badge variant="outline" className="text-[10px] font-normal">
              connector
            </Badge>
          )}
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
}

function ruleStateLabel(rule: EdgeNatRule, applied: boolean): string {
  if (!rule.enabled) return "Disabled";
  return applied ? "Applied" : "Pending";
}

function EdgeRuleDeleteDialog({
  server,
  rule,
  onOpenChange,
  onDeleted,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (ruleId: string) =>
      apiFetch(`/api/network/edge-networks/servers/${server.id}/rules/${ruleId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("NAT rule removed. Apply changes to update the server.");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onDeleted();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={rule !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {rule?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The rule will be removed from PolySIEM, then must be applied before the edge server&apos;s firewall
            changes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (rule) mutation.mutate(rule.id);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Everything about one rule, including where its traffic actually ends up. */
function EdgeRuleDetailSheet({
  server,
  rule,
  connectors,
  isAdmin,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  connectors: readonly ConnectorDto[];
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (rule: EdgeNatRule) => void;
  onDelete: (rule: EdgeNatRule) => void;
}) {
  return (
    <BottomSheet
      open={rule !== null}
      onOpenChange={onOpenChange}
      title={rule?.name ?? "NAT rule"}
      description={`Published on ${server.name}`}
    >
      {rule && (
        <div className="flex flex-col gap-3 pb-2">
          <EdgeRuleFacts server={server} rule={rule} connectors={connectors} />
          {isAdmin && server.enabled && (
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={() => onEdit(rule)}>
                <Pencil /> Edit rule
              </Button>
              <Button variant="destructive" onClick={() => onDelete(rule)}>
                <Trash2 /> Remove rule
              </Button>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function EdgeRuleFacts({
  server,
  rule,
  connectors,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule;
  connectors: readonly ConnectorDto[];
}) {
  const settings = server.settings ?? {};
  const applied = isRuleApplied(rule, settings.lastAppliedAt);
  const viaConnector = ruleRouteMode(rule) === "connector";
  const connectorName = connectorDisplayName(connectors, rule.connectorId);
  const connector = rule.connectorId ? connectors.find((entry) => entry.id === rule.connectorId) ?? null : null;
  // Non-null only when the rule ends at a manual peer PolySIEM cannot program.
  const warning = connector ? connectorRouteWarning(connector, { publicPort: rule.publicPort }) : null;
  return (
    <>
      <div className="divide-y divide-border/60 rounded-xl border bg-card">
        <MobileKeyRow label="Edge listener" mono>
          {rule.protocol} :{rule.publicPort}
        </MobileKeyRow>
        <MobileKeyRow label="Route mode">
          {viaConnector ? `Via connector${connectorName ? ` · ${connectorName}` : ""}` : "Direct (edge → target)"}
        </MobileKeyRow>
        <MobileKeyRow label={viaConnector ? "Internal target" : "Private target"} mono>
          {rule.targetAddress}:{rule.targetPort}
        </MobileKeyRow>
        <MobileKeyRow label="Allowed source" mono>
          {rule.sourceCidr || "Any source"}
        </MobileKeyRow>
        <MobileKeyRow label="Status">{ruleStateLabel(rule, applied)}</MobileKeyRow>
      </div>
      {warning && (
        <div className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="block font-medium">{warning.title}</span>
            <span className="mt-0.5 block leading-snug">{warning.detail}</span>
          </span>
        </div>
      )}
    </>
  );
}

/** The Routes tab: what this edge publishes today. */
function EdgeRoutesPanel({
  server,
  isAdmin,
  onEditRule,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  onEditRule: (rule: EdgeNatRule) => void;
}) {
  const [selected, setSelected] = useState<EdgeNatRule | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<EdgeNatRule | null>(null);
  const settings = server.settings ?? {};
  // Shares the connectors block's query key, so this is a cache read, not a second fetch path.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];

  return (
    <>
      {server.rules.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
          No ports are published. This server exposes no lab targets until a rule is added and applied.
        </p>
      ) : (
        <MobileList>
          {server.rules.map((rule) => (
            <EdgeRuleRow
              key={rule.id}
              rule={rule}
              applied={isRuleApplied(rule, settings.lastAppliedAt)}
              onSelect={() => setSelected(rule)}
            />
          ))}
        </MobileList>
      )}

      <EdgeRuleDetailSheet
        server={server}
        rule={selected}
        connectors={connectors}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setSelected(null)}
        onEdit={(rule) => {
          setSelected(null);
          onEditRule(rule);
        }}
        onDelete={(rule) => setConfirmDelete(rule)}
      />

      <EdgeRuleDeleteDialog
        server={server}
        rule={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        onDeleted={() => {
          setConfirmDelete(null);
          setSelected(null);
        }}
      />
    </>
  );
}

/** The Interfaces tab: the edge's own plumbing — where traffic lands and leaves. */
function EdgeInterfacesPanel({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [editing, setEditing] = useState(false);
  const { publicInterface, outboundInterface, forwarding, publicIp } = edgeInterfaceFacts(server);
  const detected = edgeInterfaceOptions(server);

  return (
    <>
      <MobileList>
        {isAdmin ? (
          <MobileListRow
            onClick={() => setEditing(true)}
            title="Interfaces"
            subtitle={
              <span className="font-mono">
                {publicInterface} → {outboundInterface}
              </span>
            }
            trailing={<Pencil className="size-3.5" />}
          />
        ) : (
          <MobileKeyRow label="Interfaces" mono>
            {publicInterface} → {outboundInterface}
          </MobileKeyRow>
        )}
        <MobileKeyRow label="Forwarding">{forwarding ? "Enabled" : "Disabled"}</MobileKeyRow>
        <MobileKeyRow label="Detected on edge">
          {detected.length > 0 ? `${detected.length} interfaces` : "Not synced yet"}
        </MobileKeyRow>
        <MobileKeyRow label="Public IP" mono>
          {publicIp}
        </MobileKeyRow>
        <MobileKeyRow label="SSH host key">{hostKeyLabel(server)}</MobileKeyRow>
      </MobileList>
      <p className="px-0.5 text-[11px] text-muted-foreground">
        Both fields are real Linux interface names on the edge: where published traffic arrives, and which interface
        carries it toward the target.
      </p>

      {editing && <MobileEdgeInterfacesSheet server={server} onOpenChange={setEditing} />}
    </>
  );
}

/** The interface facts the panel shows, preferring the edge's last synced snapshot. */
function edgeInterfaceFacts(server: EdgeNatServer): {
  publicInterface: string;
  outboundInterface: string;
  forwarding: boolean;
  publicIp: string;
} {
  const settings = server.settings ?? {};
  return {
    publicInterface: settings.publicInterface ?? "eth0",
    outboundInterface: settings.outboundInterface ?? "tailscale0",
    forwarding: Boolean(settings.syncedSnapshot?.ipForwarding ?? settings.enableIpForwarding),
    publicIp: settings.syncedSnapshot?.publicIp ?? settings.publicIp ?? "Not detected",
  };
}

function hostKeyLabel(server: EdgeNatServer): string {
  const verified = server.hostKeyEnrolled || server.settings?.hostKeyVerified;
  if (!verified) return "Enrollment required";
  return edgeServerState(server) === "online" ? "Pinned and verified" : "Pinned; verify connection";
}

/**
 * Edge NAT interface configuration. Both fields describe a traffic role, not a
 * trust zone, and both are real Linux interface names — so they are dropdowns
 * populated from the interfaces the edge actually reported in its last synced
 * snapshot, with a Custom… escape hatch for anything not in that list (and a
 * plain text input when no snapshot exists yet).
 */
function MobileEdgeInterfacesSheet({
  server,
  onOpenChange,
}: {
  server: EdgeNatServer;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const settings = server.settings ?? {};
  const [publicInterface, setPublicInterface] = useState(settings.publicInterface ?? "eth0");
  const [outboundInterface, setOutboundInterface] = useState(settings.outboundInterface ?? "tailscale0");
  const [forwarding, setForwarding] = useState(settings.enableIpForwarding ?? true);

  // The edge's REAL interfaces, parsed from its last synced snapshot by the
  // shared helper (plus the configured WireGuard interface when it is missing).
  const choices = edgeInterfaceChoices(server);
  const publicValid = isValidEdgeInterfaceName(publicInterface);
  const outboundValid = isValidEdgeInterfaceName(outboundInterface);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/integrations/${server.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: {
            publicInterface: publicInterface.trim(),
            outboundInterface: outboundInterface.trim(),
            enableIpForwarding: forwarding,
          },
        }),
      }),
    onSuccess: () => {
      toast.success("Interfaces saved. Apply rules to push the change.");
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not save the interfaces: ${error.message}`),
  });

  const save = () => {
    if (!publicValid || !outboundValid) {
      toast.error("Use Linux interface names, for example eth0 or wg0.");
      return;
    }
    mutation.mutate();
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Interfaces — ${server.name}`}
      description="Where published traffic arrives, and which interface carries it toward the target."
    >
      <div className="flex flex-col gap-4 pb-2">
        {choices.length > 0 ? (
          <>
            <MobileSelectField
              id="m-edge-public-if"
              label="Listener interface"
              value={publicInterface}
              onChange={setPublicInterface}
              choices={choices}
              mono
              invalid={!publicValid}
              customPlaceholder="eth0"
              help="The interface published traffic arrives on — usually the one holding the edge's public address."
            />
            <MobileSelectField
              id="m-edge-outbound-if"
              label="Target-path interface"
              value={outboundInterface}
              onChange={setOutboundInterface}
              choices={choices}
              mono
              invalid={!outboundValid}
              customPlaceholder="wg0"
              help="The interface the route to the target uses. It may be the same interface, or a tunnel such as wg0."
            />
          </>
        ) : (
          <EdgeInterfaceTextFields
            publicInterface={publicInterface}
            outboundInterface={outboundInterface}
            publicValid={publicValid}
            outboundValid={outboundValid}
            onPublicChange={setPublicInterface}
            onOutboundChange={setOutboundInterface}
          />
        )}

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-edge-forwarding">IP forwarding</Label>
            <p className="text-xs text-muted-foreground">Required for the edge to forward published traffic at all.</p>
          </div>
          <Switch id="m-edge-forwarding" checked={forwarding} onCheckedChange={setForwarding} />
        </div>

        <Button className="w-full" disabled={mutation.isPending || !publicValid || !outboundValid} onClick={save}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save interfaces
        </Button>
      </div>
    </BottomSheet>
  );
}

/** Free-text fallback for an edge that has never reported its interfaces. */
function EdgeInterfaceTextFields({
  publicInterface,
  outboundInterface,
  publicValid,
  outboundValid,
  onPublicChange,
  onOutboundChange,
}: {
  publicInterface: string;
  outboundInterface: string;
  publicValid: boolean;
  outboundValid: boolean;
  onPublicChange: (value: string) => void;
  onOutboundChange: (value: string) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-edge-public-if">Listener interface</Label>
        <Input
          id="m-edge-public-if"
          value={publicInterface}
          onChange={(event) => onPublicChange(event.target.value)}
          placeholder="eth0"
          autoCapitalize="none"
          spellCheck={false}
          className={cn("font-mono", !publicValid && "border-destructive")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-edge-outbound-if">Target-path interface</Label>
        <Input
          id="m-edge-outbound-if"
          value={outboundInterface}
          onChange={(event) => onOutboundChange(event.target.value)}
          placeholder="wg0"
          autoCapitalize="none"
          spellCheck={false}
          className={cn("font-mono", !outboundValid && "border-destructive")}
        />
      </div>
      <p className="rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
        This edge has not reported its interfaces yet, so these stay free text. Sync the server and the real interfaces
        become selectable.
      </p>
    </>
  );
}

/** Rule count for the Routes segment: "none", "1 rule", "6 rules". */
function routesBadge(count: number): string {
  if (count === 0) return "none";
  return count === 1 ? "1 rule" : `${count} rules`;
}

/** On / Incomplete / Off, from the same helper the tunnel block's badge uses. */
function tunnelBadge(server: EdgeNatServer): { badge: string; tone: "muted" | "success" | "warning" } {
  const status = edgeWireguardStatus(server.settings?.wireguard);
  if (status.tone === "on") return { badge: "On", tone: "success" };
  return status.tone === "pending" ? { badge: "Incomplete", tone: "warning" } : { badge: "Off", tone: "muted" };
}

/**
 * The four tabs with their compact badges — the same information the desktop
 * card's tab strip carries, sized for a 412px phone.
 */
function edgeServerTabs(
  server: EdgeNatServer,
  connectors: readonly ConnectorDto[],
): MobileSegmentedTab<EdgeServerTab>[] {
  const connectorSummary = connectorsTabBadge(connectors);
  const tunnel = tunnelBadge(server);
  const detected = edgeInterfaceOptions(server).length;
  return [
    { key: "routes", label: "Routes", badge: routesBadge(server.rules.length) },
    {
      key: "connectors",
      label: "Connectors",
      badge: connectorSummary.badge,
      tone: connectorSummary.ready ? "success" : "muted",
    },
    { key: "tunnel", label: "Tunnel", badge: tunnel.badge, tone: tunnel.tone },
    { key: "interfaces", label: "Interfaces", badge: detected > 0 ? `${detected} found` : "not synced" },
  ];
}

/** Renders exactly the selected tab — a phone never scrolls through all four. */
function EdgeServerTabContent({
  tab,
  server,
  isAdmin,
  onEditRule,
}: {
  tab: EdgeServerTab;
  server: EdgeNatServer;
  isAdmin: boolean;
  onEditRule: (rule: EdgeNatRule) => void;
}) {
  if (tab === "routes") return <EdgeRoutesPanel server={server} isAdmin={isAdmin} onEditRule={onEditRule} />;
  if (tab === "connectors") return <MobileConnectorsBlock server={server} isAdmin={isAdmin} />;
  if (tab === "tunnel") return <MobileWireguardBlock server={server} isAdmin={isAdmin} />;
  return <EdgeInterfacesPanel server={server} isAdmin={isAdmin} />;
}

/**
 * One edge server on a phone. Identity, sync state and the primary actions stay
 * pinned; Routes / Connectors / Tunnel / Interfaces switch below them in the
 * same order as the desktop card, and only the selected one renders.
 */
export function MobileEdgeServerSection({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [tab, setTab] = useState<EdgeServerTab>(EDGE_SERVER_TABS[0]);
  const [ruleForm, setRuleForm] = useState<{ open: boolean; rule: EdgeNatRule | null }>({ open: false, rule: null });
  const settings = server.settings ?? {};
  const reconciliation = edgeReconciliation(server);
  const pending =
    settings.pendingChanges || server.rules.some((rule) => rule.enabled && !isRuleApplied(rule, settings.lastAppliedAt));
  // One shared connectors query (same key as the connectors tab) feeds the badge
  // even while another tab is showing.
  const connectors = useConnectorsQuery(server.id, { enabled: server.enabled }).data ?? [];
  const openRuleForm = (rule: EdgeNatRule | null) => {
    setTab("routes");
    setRuleForm({ open: true, rule });
  };

  return (
    <MobileSection title={server.name}>
      <EdgeServerHeaderCard server={server} reconciliation={reconciliation} />
      <EdgeServerAlerts server={server} reconciliation={reconciliation} isAdmin={isAdmin} />

      {isAdmin && server.enabled && (
        <EdgeApplyActions server={server} pending={Boolean(pending)} onAddRule={() => openRuleForm(null)} />
      )}
      {isAdmin && !server.enabled && reconciliation.cleanupRequired && <EdgeCleanupAction server={server} />}

      <MobileStateSegmented
        idBase={`edge-${server.id}`}
        ariaLabel={`${server.name} sections`}
        tabs={edgeServerTabs(server, connectors)}
        value={tab}
        onChange={setTab}
        className="mt-0.5"
      />
      <MobileTabPanel idBase={`edge-${server.id}`} tab={tab}>
        <EdgeServerTabContent tab={tab} server={server} isAdmin={isAdmin} onEditRule={openRuleForm} />
      </MobileTabPanel>

      {ruleForm.open && (
        <MobileNatRuleSheet
          server={server}
          rule={ruleForm.rule}
          onOpenChange={(open) => setRuleForm((current) => ({ ...current, open }))}
        />
      )}
    </MobileSection>
  );
}
