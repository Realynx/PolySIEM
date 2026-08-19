"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Fingerprint,
  KeyRound,
  Loader2,
  Pencil,
  Power,
  RefreshCw,
  ScanLine,
  Server,
  Terminal,
  Trash2,
  TriangleAlert,
  Upload,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorAgentSummary,
  connectorApplyUrl,
  connectorHandshakeAt,
  connectorHostKeyQueryKey,
  connectorHostKeyUrl,
  connectorKindOf,
  connectorPeerProgress,
  connectorRotateTokenUrl,
  connectorSshPresentation,
  connectorStatusPresentation,
  connectorStatusQueryKey,
  connectorStatusUrl,
  connectorUrl,
  connectorWgStatePresentation,
  connectorsQueryKey,
  hostKeyAlgorithmLabel,
  isManualConnector,
  isValidConnectorSshUsername,
  isValidSshHost,
  isValidSshPort,
  CONNECTOR_SSH_DEFAULT_USERNAME,
  CONNECTOR_SSH_PORT_CHOICES,
  CONNECTOR_SSH_TRUST_FACTS,
  CONNECTOR_SSH_USERNAME_CHOICES,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorApplyResult,
  type ConnectorDto,
  type ConnectorHostKeyScan,
  type ConnectorInstallReveal,
  type ConnectorSshPresentation,
  type ConnectorSshStatus,
  type EdgeNatServer,
  type ObservedConnectorHostKey,
  type UpdateConnectorInput,
} from "@/components/network/edge-networks-types";
import {
  ConnectorCopyRow,
  ConnectorKindBadge,
  ConnectorStatusBadge,
  contactLabel,
  elide,
  sshEndpointLabel,
} from "./mobile-connector-atoms";
import { MobileSelectField } from "./mobile-form-controls";

/** Every fact PolySIEM holds about a connector, phrased per kind. */
function ConnectorFacts({ connector, manual }: { connector: ConnectorDto; manual: boolean }) {
  const kind = connectorKindOf(connector);
  const hint = manual ? connectorPeerProgress(connector).detail : connectorStatusPresentation(connector).hint;
  return (
    <>
      <MobileList>
        <MobileKeyRow label="Kind">
          <ConnectorKindBadge kind={kind} />
        </MobileKeyRow>
        <MobileKeyRow label="Status">
          <ConnectorStatusBadge connector={connector} />
        </MobileKeyRow>
        <MobileKeyRow label="Tunnel address" mono>
          {connector.tunnelAddress}
        </MobileKeyRow>
        <MobileKeyRow label="Tunnel key">{tunnelKeyLabel(connector, manual)}</MobileKeyRow>
        {!manual && (
          <>
            <MobileKeyRow label="Last handshake">{contactLabel(connector)}</MobileKeyRow>
            <MobileKeyRow label="Enrolled">
              {connector.enrolledAt ? formatRelative(connector.enrolledAt) : "Not enrolled"}
            </MobileKeyRow>
            <MobileKeyRow label="Agent">{connectorAgentSummary(connector) ?? "Not reported"}</MobileKeyRow>
          </>
        )}
        {connector.notes && <MobileKeyRow label="Notes">{connector.notes}</MobileKeyRow>}
      </MobileList>
      <p className="px-0.5 text-[11px] text-muted-foreground">{hint}</p>
    </>
  );
}

/** Where the tunnel key came from — pasted in by hand, or registered by the agent. */
function tunnelKeyLabel(connector: ConnectorDto, manual: boolean): string {
  if (connector.publicKey) return manual ? "Pasted in from the far side" : "Registered by the connector";
  return manual ? "Not pasted in yet" : "Not enrolled yet";
}

/** Manual kinds: PolySIEM only registers the peer, so the actions are different. */
function ConnectorManualPanel({
  connector,
  isAdmin,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  isAdmin: boolean;
  onPeerSetup: (connector: ConnectorDto) => void;
}) {
  return (
    <>
      <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
        PolySIEM does not manage this far end: no install token, no SSH key, no pushed rules. It is a WireGuard peer
        of the edge and you configure it yourself.
      </p>
      {isAdmin && (
        <Button variant="outline" className="w-full" onClick={() => onPeerSetup(connector)}>
          <Waypoints /> {connector.publicKey ? "Peer settings" : "Finish peer setup"}
        </Button>
      )}
    </>
  );
}

/** Rename / rotate / disable / delete, plus the sentence explaining what each does. */
function ConnectorAdminActions({
  server,
  connector,
  manual,
  onEdit,
  onDelete,
  onRotated,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  manual: boolean;
  onEdit: (connector: ConnectorDto) => void;
  onDelete: (connector: ConnectorDto) => void;
  onRotated: (connector: ConnectorDto, minted: ConnectorInstallReveal) => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
    void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
  };

  const rotateMutation = useMutation({
    mutationFn: (id: string) => apiFetch<ConnectorInstallReveal>(connectorRotateTokenUrl(id), { method: "POST" }),
    onSuccess: (minted) => {
      toast.success("New install command ready — it is shown only once.");
      onRotated(connector, minted);
      invalidate();
    },
    onError: (error: Error) => toast.error(`Could not rotate the token: ${error.message}`),
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiFetch<ConnectorDto>(connectorUrl(id), {
        method: "PATCH",
        body: JSON.stringify({ disabled } satisfies UpdateConnectorInput),
      }),
    onSuccess: (_result, variables) => {
      toast.success(variables.disabled ? "Connector disabled. Apply to drop its edge peer." : "Connector enabled.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const disabled = connector.status === "disabled";
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" onClick={() => onEdit(connector)}>
          <Pencil /> Rename
        </Button>
        {!manual && (
          <Button
            variant="outline"
            disabled={rotateMutation.isPending}
            onClick={() => rotateMutation.mutate(connector.id)}
          >
            {rotateMutation.isPending ? <Loader2 className="animate-spin" /> : <Terminal />}
            {connector.status === "pending" ? "Install command" : "Rotate token"}
          </Button>
        )}
        <Button
          variant="outline"
          disabled={disableMutation.isPending}
          onClick={() => disableMutation.mutate({ id: connector.id, disabled: !disabled })}
        >
          {disableMutation.isPending ? <Loader2 className="animate-spin" /> : <Power />}
          {disabled ? "Enable" : "Disable"}
        </Button>
        <Button variant="destructive" onClick={() => onDelete(connector)}>
          <Trash2 /> Delete
        </Button>
      </div>
      <p className="px-0.5 text-[11px] text-muted-foreground">
        {manual
          ? "Disabling drops this peer from the edge on the next apply; the far side keeps its own config until you remove it there."
          : "Rotating issues a fresh one-time token and a new install command; the old one stops working."}
      </p>
    </>
  );
}

/**
 * One connector, everything about it. Managed kinds get the SSH management
 * block; manual kinds get the peer panel instead — the sheet only decides which
 * of the two it shows.
 */
export function ConnectorDetailSheet({
  server,
  connector,
  isAdmin,
  onOpenChange,
  onEdit,
  onEditSsh,
  onScanHostKey,
  onPeerSetup,
  onDelete,
  onRotated,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (connector: ConnectorDto) => void;
  onEditSsh: (connector: ConnectorDto) => void;
  onScanHostKey: (connector: ConnectorDto) => void;
  onPeerSetup: (connector: ConnectorDto) => void;
  onDelete: (connector: ConnectorDto) => void;
  onRotated: (connector: ConnectorDto, minted: ConnectorInstallReveal) => void;
}) {
  const manual = connector ? isManualConnector(connector) : false;
  return (
    <BottomSheet
      open={connector !== null}
      onOpenChange={onOpenChange}
      title={connector?.name ?? "Connector"}
      description={
        manual ? `WireGuard peer of ${server.name}, configured by hand` : `Reverse tunnel into ${server.name}`
      }
    >
      {connector && (
        <div className="flex flex-col gap-3 pb-2">
          <ConnectorCopyRow label="Connector ID" value={connector.connectorId} />
          <ConnectorFacts connector={connector} manual={manual} />

          {manual ? (
            <ConnectorManualPanel connector={connector} isAdmin={isAdmin} onPeerSetup={onPeerSetup} />
          ) : (
            <ConnectorSshBlock
              server={server}
              connector={connector}
              isAdmin={isAdmin}
              onEditSsh={onEditSsh}
              onScanHostKey={onScanHostKey}
            />
          )}

          {isAdmin && (
            <ConnectorAdminActions
              server={server}
              connector={connector}
              manual={manual}
              onEdit={onEdit}
              onDelete={onDelete}
              onRotated={onRotated}
            />
          )}
        </div>
      )}
    </BottomSheet>
  );
}

/** Ready / untrusted / unconfigured, in the same words as desktop. */
function SshReadinessBadge({ ssh }: { ssh: ConnectorSshPresentation }) {
  return (
    <Badge
      variant={ssh.readiness === "ready" ? "secondary" : "outline"}
      className={cn("text-[10px] font-normal", ssh.tone === "warning" && "text-warning")}
    >
      {ssh.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
      {ssh.label}
    </Badge>
  );
}

/** Endpoint, pinned host key and managed key — tappable rows for an admin. */
function ConnectorSshRows({
  connector,
  isAdmin,
  onEditSsh,
  onScanHostKey,
}: {
  connector: ConnectorDto;
  isAdmin: boolean;
  onEditSsh: (connector: ConnectorDto) => void;
  onScanHostKey: (connector: ConnectorDto) => void;
}) {
  return (
    <MobileList>
      {isAdmin ? (
        <MobileListRow
          onClick={() => onEditSsh(connector)}
          leading={<Server className="size-4" />}
          title="SSH endpoint"
          subtitle={<span className="font-mono">{sshEndpointLabel(connector)}</span>}
          trailing={<Pencil className="size-3.5" />}
        />
      ) : (
        <MobileKeyRow label="SSH endpoint" mono>
          {sshEndpointLabel(connector)}
        </MobileKeyRow>
      )}
      {isAdmin ? (
        <MobileListRow
          onClick={() => onScanHostKey(connector)}
          leading={<Fingerprint className="size-4" />}
          title="Host key"
          subtitle={<span className="font-mono">{elide(connector.sshHostKeyFingerprint, "Not enrolled")}</span>}
          trailing={<ScanLine className="size-3.5" />}
        />
      ) : (
        <MobileKeyRow label="Host key" mono>
          {elide(connector.sshHostKeyFingerprint, "Not enrolled")}
        </MobileKeyRow>
      )}
      <MobileKeyRow label="Managed key">{managedKeyLabel(connector)}</MobileKeyRow>
    </MobileList>
  );
}

function managedKeyLabel(connector: ConnectorDto): string {
  if (!connector.hasSshCredentials) return "Not issued";
  return connector.sshProvisionedAt
    ? `Held by PolySIEM · ${formatRelative(connector.sshProvisionedAt)}`
    : "Held by PolySIEM";
}

/** What the connector itself reports over its SSH session. */
function ConnectorSshStatusFacts({ status }: { status: ConnectorSshStatus }) {
  const handshakeAt = connectorHandshakeAt(status);
  const revision = status.appliedRevision;
  return (
    <MobileList>
      <MobileKeyRow label="Agent version">{status.agentVersion ?? "Not reported"}</MobileKeyRow>
      <MobileKeyRow label="WireGuard">
        {connectorWgStatePresentation(status.wgState).label}
        {status.wgAddress && status.wgAddress !== "-" ? ` · ${status.wgAddress}` : ""}
      </MobileKeyRow>
      <MobileKeyRow label="Latest handshake">
        {handshakeAt ? formatRelative(handshakeAt) : "No handshake yet"}
      </MobileKeyRow>
      <MobileKeyRow label="Applied revision">
        {revision === null || revision === undefined ? "None" : String(revision)}
      </MobileKeyRow>
      <MobileKeyRow label="Applied hash" mono>
        {elide(status.appliedHash, "None")}
      </MobileKeyRow>
      <MobileKeyRow label="Last-hop routes">
        {status.routeCount ?? 0}
        {status.ipForward === false ? " · forwarding off" : ""}
      </MobileKeyRow>
      {status.hostname && <MobileKeyRow label="Hostname">{status.hostname}</MobileKeyRow>}
    </MobileList>
  );
}

function ConnectorSshStatusPanel({
  status,
  isLoading,
  error,
}: {
  status: ConnectorSshStatus | undefined;
  isLoading: boolean;
  error: Error | null;
}) {
  return (
    <>
      {isLoading && <Skeleton className="h-32 rounded-xl" />}
      {error && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Status unavailable: {error.message}
        </p>
      )}
      {status && <ConnectorSshStatusFacts status={status} />}
      {status?.drift && (
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          The connector&apos;s live rules no longer match the revision PolySIEM applied. Push the configuration again
          to reconcile it.
        </p>
      )}
    </>
  );
}

/** Push config now / refresh status — the two admin verbs of the SSH transport. */
function ConnectorSshActions({
  server,
  connector,
  canManage,
  isRefreshing,
  onRefresh,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  canManage: boolean;
  isRefreshing: boolean;
  onRefresh: () => void;
}) {
  const queryClient = useQueryClient();
  const applyMutation = useMutation({
    mutationFn: () => apiFetch<ConnectorApplyResult>(connectorApplyUrl(connector.id), { method: "POST" }),
    onSuccess: (result) => {
      toast.success(result?.detail ?? pushedRoutesMessage(result?.routeCount, connector.name));
      void queryClient.invalidateQueries({ queryKey: connectorStatusQueryKey(connector.id) });
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not push the configuration: ${error.message}`),
  });

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={!canManage || applyMutation.isPending}
        onClick={() => applyMutation.mutate()}
      >
        {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Push config now
      </Button>
      <Button variant="outline" size="sm" disabled={!canManage || isRefreshing} onClick={onRefresh}>
        <RefreshCw className={cn(isRefreshing && "animate-spin")} /> Refresh status
      </Button>
    </div>
  );
}

function pushedRoutesMessage(routeCount: number | null | undefined, name: string): string {
  if (typeof routeCount !== "number") return `Configuration pushed to ${name}`;
  return `Pushed ${routeCount} ${routeCount === 1 ? "route" : "routes"} to ${name}`;
}

/**
 * SSH management for one connector — the primary transport. PolySIEM pushes the
 * ruleset straight over SSH once an endpoint, a pinned host key and the managed
 * key all exist; otherwise the connector still self-heals by polling with its
 * token, so this block explains which path is live instead of blocking.
 */
export function ConnectorSshBlock({
  server,
  connector,
  isAdmin,
  onEditSsh,
  onScanHostKey,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  isAdmin: boolean;
  onEditSsh: (connector: ConnectorDto) => void;
  onScanHostKey: (connector: ConnectorDto) => void;
}) {
  const ssh = connectorSshPresentation(connector);

  // STATUS opens a real SSH session, so it is fetched on demand and refreshed by
  // hand rather than polled like the token-poll list. Never on a timer, and
  // never on focus: a PWA regains focus constantly and every fetch is a real SSH
  // round trip. This block only mounts with the detail sheet, so opening the
  // sheet is the trigger.
  const statusQuery = useQuery({
    queryKey: connectorStatusQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorSshStatus>(connectorStatusUrl(connector.id)),
    enabled: ssh.canManage,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          <KeyRound className="size-3.5" /> SSH management
        </span>
        <SshReadinessBadge ssh={ssh} />
      </div>

      <ConnectorSshRows
        connector={connector}
        isAdmin={isAdmin}
        onEditSsh={onEditSsh}
        onScanHostKey={onScanHostKey}
      />

      {connector.sshAuthorizedKey && (
        <ConnectorCopyRow label="Restricted authorized_keys line" value={connector.sshAuthorizedKey} />
      )}

      {ssh.canManage && (
        <ConnectorSshStatusPanel
          status={statusQuery.data}
          isLoading={statusQuery.isLoading}
          error={statusQuery.error as Error | null}
        />
      )}

      {isAdmin && (
        <ConnectorSshActions
          server={server}
          connector={connector}
          canManage={ssh.canManage}
          isRefreshing={statusQuery.isFetching}
          onRefresh={() => void statusQuery.refetch()}
        />
      )}

      <p className="px-0.5 text-[11px] text-muted-foreground">
        {ssh.detail}
        {ssh.readiness === "ready" ? "" : " The token poll keeps working either way."}
      </p>
    </div>
  );
}

/** Host/port/username for the SSH push transport. */
export function ConnectorSshEndpointSheet({
  server,
  connector,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ssh = connectorSshPresentation(connector);
  const [host, setHost] = useState(connector.sshHost ?? "");
  const [port, setPort] = useState(String(connector.sshPort || 22));
  const [username, setUsername] = useState(ssh.username);

  const hostValid = isValidSshHost(host);
  const portValid = isValidSshPort(Number(port));
  const usernameValid = isValidConnectorSshUsername(username);

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_result, input) => {
      toast.success(input.sshHost === null ? "SSH endpoint removed — token poll only." : "SSH endpoint saved");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: connectorHostKeyQueryKey(connector.id) });
      void queryClient.invalidateQueries({ queryKey: connectorStatusQueryKey(connector.id) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!hostValid || !portValid || !usernameValid) {
      toast.error("Enter the connector's hostname or IP, a port from 1–65535, and a Linux username.");
      return;
    }
    mutation.mutate({ sshHost: host.trim(), sshPort: Number(port), sshUsername: username.trim() });
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`SSH endpoint for ${connector.name}`}
      description="Where PolySIEM reaches this connector to push configuration directly."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-ssh-host">SSH host</Label>
          <Input
            id="m-cx-ssh-host"
            value={host}
            onChange={(event) => setHost(event.target.value)}
            placeholder="10.0.3.42"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            inputMode="url"
            className={cn(host && !hostValid && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">
            The address PolySIEM can reach from here — usually the connector&apos;s LAN or tunnel address.
          </p>
        </div>
        <div className="grid grid-cols-[0.8fr_1fr] gap-3">
          <MobileSelectField
            id="m-cx-ssh-port"
            label="Port"
            value={port}
            onChange={setPort}
            choices={CONNECTOR_SSH_PORT_CHOICES}
            inputMode="numeric"
            mono
            invalid={Boolean(port) && !portValid}
            customPlaceholder="22"
          />
          <MobileSelectField
            id="m-cx-ssh-user"
            label="Username"
            value={username}
            onChange={setUsername}
            choices={CONNECTOR_SSH_USERNAME_CHOICES}
            mono
            invalid={Boolean(username) && !usernameValid}
            customPlaceholder={CONNECTOR_SSH_DEFAULT_USERNAME}
          />
        </div>

        <ul className="flex flex-col gap-2 rounded-xl border border-info/30 bg-info/5 p-3 text-xs text-info">
          {CONNECTOR_SSH_TRUST_FACTS.map((fact) => (
            <li key={fact.title}>
              <span className="block font-medium">{fact.title}</span>
              <span className="mt-0.5 block leading-snug opacity-90">{fact.detail}</span>
            </li>
          ))}
        </ul>

        <Button
          type="submit"
          className="w-full"
          disabled={mutation.isPending || !hostValid || !portValid || !usernameValid}
        >
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />} Save endpoint
        </Button>
        {connector.sshHost && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ sshHost: null })}
          >
            Stop managing over SSH
          </Button>
        )}
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Removing the endpoint leaves the connector on its token poll — it keeps pulling its configuration on its own.
        </p>
      </form>
    </BottomSheet>
  );
}

/** Which fingerprint the enroll button would pin, before the operator picks one. */
function resolveHostKeySelection(
  chosen: string,
  enrolled: string | null | undefined,
  keys: readonly ObservedConnectorHostKey[],
): string {
  if (chosen) return chosen;
  if (enrolled) return enrolled;
  return keys.length === 1 ? keys[0]?.fingerprint ?? "" : "";
}

/** One scanned host key, as a phone-sized radio row. */
function HostKeyOption({
  hostKey,
  selected,
  onSelect,
}: {
  hostKey: ObservedConnectorHostKey;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "flex min-h-13 w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-card active:bg-muted/70",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          selected && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {selected && <Check className="size-3" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">
          {hostKeyAlgorithmLabel(hostKey)}
        </span>
        <span className="block break-all font-mono text-xs">{hostKey.fingerprint}</span>
      </span>
    </button>
  );
}

/** What the scan is doing right now: loading, failed, or came back empty. */
function HostKeyScanState({
  isLoading,
  error,
  scanned,
  keyCount,
}: {
  isLoading: boolean;
  error: Error | null;
  scanned: boolean;
  keyCount: number;
}) {
  return (
    <>
      {isLoading && <Skeleton className="h-24 rounded-xl" />}
      {error && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Could not scan the host key: {error.message}
        </p>
      )}
      {scanned && keyCount === 0 && (
        <p className="rounded-xl border border-dashed px-4 py-5 text-center text-xs text-muted-foreground">
          The connector presented no host keys. Check that its SSH service is reachable on this address.
        </p>
      )}
    </>
  );
}

function HostKeyFacts({
  connector,
  scan,
  endpoint,
}: {
  connector: ConnectorDto;
  scan: ConnectorHostKeyScan | undefined;
  endpoint: string;
}) {
  return (
    <MobileList>
      <MobileKeyRow label="Scanned" mono>
        {scan ? `${scan.host}:${scan.port}` : endpoint}
      </MobileKeyRow>
      <MobileKeyRow label="Enrolled" mono>
        {elide(scan?.enrolledFingerprint ?? connector.sshHostKeyFingerprint, "Not enrolled")}
      </MobileKeyRow>
    </MobileList>
  );
}

/** Scan the connector's SSH host keys and pin one, mirroring the edge flow. */
export function ConnectorHostKeySheet({
  server,
  connector,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const ssh = connectorSshPresentation(connector);
  const [selectedFingerprint, setSelectedFingerprint] = useState("");

  const scanQuery = useQuery({
    queryKey: connectorHostKeyQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorHostKeyScan>(connectorHostKeyUrl(connector.id)),
    enabled: ssh.endpoint !== null,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const keys = scanQuery.data?.keys ?? [];
  const selected = resolveHostKeySelection(selectedFingerprint, scanQuery.data?.enrolledFingerprint, keys);

  const enrollMutation = useMutation({
    mutationFn: (fingerprint: string) =>
      apiFetch(connectorHostKeyUrl(connector.id), { method: "POST", body: JSON.stringify({ fingerprint }) }),
    onSuccess: () => {
      toast.success(`Host key pinned for ${connector.name}`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: connectorStatusQueryKey(connector.id) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not enroll the host key: ${error.message}`),
  });

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Host key for ${connector.name}`}
      description="Confirm the connector's SSH identity before PolySIEM trusts it."
    >
      <div className="flex flex-col gap-3 pb-2">
        {ssh.endpoint === null ? (
          <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            Add an SSH host for this connector first — there is nothing to scan yet.
          </p>
        ) : (
          <>
            <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
              {scanQuery.data?.warning ??
                "Compare the fingerprint against the machine's own console before enrolling it. Once pinned, every connection is checked against this key."}
            </p>

            <HostKeyFacts connector={connector} scan={scanQuery.data} endpoint={ssh.endpoint} />

            <HostKeyScanState
              isLoading={scanQuery.isLoading}
              error={scanQuery.error as Error | null}
              scanned={Boolean(scanQuery.data)}
              keyCount={keys.length}
            />

            {keys.length > 0 && (
              <div className="grid gap-2">
                {keys.map((key) => (
                  <HostKeyOption
                    key={`${hostKeyAlgorithmLabel(key)}:${key.fingerprint}`}
                    hostKey={key}
                    selected={selected === key.fingerprint}
                    onSelect={() => setSelectedFingerprint(key.fingerprint)}
                  />
                ))}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={scanQuery.isFetching} onClick={() => void scanQuery.refetch()}>
                <RefreshCw className={cn(scanQuery.isFetching && "animate-spin")} /> Scan again
              </Button>
              <Button
                disabled={!selected || enrollMutation.isPending}
                onClick={() => selected && enrollMutation.mutate(selected)}
              >
                {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <Fingerprint />} Trust key
              </Button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}
