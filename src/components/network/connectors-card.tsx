"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  KeyRound,
  Loader2,
  LockKeyhole,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldCheck,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConnectorInstallDialog } from "./connector-install-dialog";
import { ConfigSelect } from "./config-select";
import {
  connectorAgentSummary,
  connectorApplyUrl,
  connectorContactFallback,
  connectorHandshakeAt,
  connectorHostKeyQueryKey,
  connectorHostKeyUrl,
  connectorInstallReveal,
  connectorKindLabel,
  connectorKindOf,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorRotateTokenUrl,
  connectorSshPresentation,
  connectorSshUsername,
  connectorStatusPresentation,
  connectorStatusQueryKey,
  connectorStatusUrl,
  connectorUrl,
  connectorWgStatePresentation,
  connectorsListUrl,
  connectorsQueryKey,
  edgeTunnelEndpoint,
  hostKeyAlgorithmLabel,
  isManualConnector,
  isValidConnectorName,
  isValidConnectorSshUsername,
  isValidSshHost,
  isValidSshPort,
  CONNECTOR_KIND_CHOICES,
  CONNECTOR_SSH_DEFAULT_PORT,
  CONNECTOR_SSH_DEFAULT_USERNAME,
  CONNECTOR_SSH_PORT_CHOICES,
  CONNECTOR_SSH_TRUST_FACTS,
  CONNECTOR_SSH_USERNAME_CHOICES,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorApplyResult,
  type ConnectorDto,
  type ConnectorHostKeyEnrollResult,
  type ConnectorHostKeyScan,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorKind,
  type ConnectorPeerConfigDto,
  type ConnectorSshPresentation,
  type ConnectorSshStatus,
  type CreateConnectorResult,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "./edge-networks-types";

/**
 * Connectors list for one edge server. Shared with the NAT-rule dialog and the
 * card's tab badge (same query key), so a single fetch backs all three.
 */
export function useConnectorsQuery(
  integrationId: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: connectorsQueryKey(integrationId),
    queryFn: () => apiFetch<ConnectorDto[]>(connectorsListUrl(integrationId)),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

/**
 * What the setup dialog is showing. `reveal` exists for the `agent` kind only —
 * a manual connector never receives a token or an install command, and is
 * configured from its peer block instead.
 */
interface ConnectorSetupState {
  connector: ConnectorDto;
  reason: ConnectorInstallReason;
  reveal: ConnectorInstallReveal | null;
  peerConfig?: ConnectorPeerConfigDto | null;
}

/**
 * Connectors tab on an Edge server card. A connector is anything that dials OUT
 * to this edge over WireGuard, so no public IP or inbound port is needed at
 * home: PolySIEM's own agent on a Linux host, an OPNsense box, or any other
 * WireGuard endpoint. Its tunnel address is allocated by PolySIEM and is
 * presented read-only everywhere.
 */
export function ConnectorsCard({
  server,
  isAdmin,
  onSetupEdgeSsh,
}: {
  server: EdgeNatServer;
  isAdmin: boolean;
  /** Opens the edge server's own SSH enrollment dialog (owned by the panel). */
  onSetupEdgeSsh?: () => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [setup, setSetup] = useState<ConnectorSetupState | null>(null);
  const [editing, setEditing] = useState<ConnectorDto | null>(null);
  const [rotating, setRotating] = useState<ConnectorDto | null>(null);
  const [deleting, setDeleting] = useState<ConnectorDto | null>(null);

  const connectorsQuery = useConnectorsQuery(server.id, {
    enabled: server.enabled,
    // While an agent is installing, watch it flip to "connected". A manual peer
    // has no agent to check in, so nothing would ever change on a timer.
    refetchInterval: setup && !isManualConnector(setup.connector) ? 5_000 : false,
  });
  const connectors = connectorsQuery.data ?? [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          A connector <span className="font-medium text-foreground">dials out</span> from inside your network and holds
          the tunnel open. Routes set to <span className="font-medium text-foreground">Via connector</span> hand the last
          hop to it, so the target only has to be reachable from the connector — not from the edge. Pick the kind when
          you add one: PolySIEM&apos;s agent manages the far end for you, while an{" "}
          <span className="font-medium text-foreground">OPNsense</span> box or another WireGuard peer is configured by
          hand from the settings PolySIEM hands you.
        </p>
        {isAdmin && (connectors.length > 0 || connectorsQuery.isError) && (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Add connector
          </Button>
        )}
      </div>

      <ConnectorsListBody
        query={connectorsQuery}
        connectors={connectors}
        integrationId={server.id}
        isAdmin={isAdmin}
        onAdd={() => setCreateOpen(true)}
        onEdit={setEditing}
        onRotate={setRotating}
        onDelete={setDeleting}
        onPeerSetup={(connector) => setSetup({ connector, reason: "created", reveal: null })}
      />

      {isAdmin && (
        <ConnectorAdminDialogs
          server={server}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
          onCreated={(result) => {
            setCreateOpen(false);
            setSetup({
              connector: result.connector,
              reason: "created",
              reveal: connectorInstallReveal(result),
              peerConfig: result.peerConfig ?? null,
            });
          }}
          editing={editing}
          onEditingChange={setEditing}
          rotating={rotating}
          onRotatingChange={setRotating}
          onRotated={(connector, reveal) => {
            setRotating(null);
            setSetup({ connector, reason: "rotated", reveal });
          }}
          deleting={deleting}
          onDeletingChange={setDeleting}
        />
      )}

      {setup && (
        <ConnectorInstallDialog
          key={setup.reveal?.installToken ?? setup.connector.id}
          open
          onOpenChange={(open) => !open && setSetup(null)}
          reveal={setup.reveal}
          peerConfig={setup.peerConfig}
          reason={setup.reason}
          connector={setup.connector}
          liveConnector={connectors.find((entry) => entry.id === setup.connector.id)}
          server={server}
          edgeEndpointLabel={edgeTunnelEndpoint(server).label}
          onSetupEdgeSsh={onSetupEdgeSsh}
        />
      )}
    </div>
  );
}

/** Loading, error, empty, and populated states of the connectors list. */
function ConnectorsListBody({
  query,
  connectors,
  integrationId,
  isAdmin,
  onAdd,
  onEdit,
  onRotate,
  onDelete,
  onPeerSetup,
}: {
  query: UseQueryResult<ConnectorDto[]>;
  connectors: ConnectorDto[];
  integrationId: string;
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (connector: ConnectorDto) => void;
  onRotate: (connector: ConnectorDto) => void;
  onDelete: (connector: ConnectorDto) => void;
  onPeerSetup: (connector: ConnectorDto) => void;
}) {
  return (
    <>
      {query.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
      {query.isError && (
        <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Connectors are unavailable: {(query.error as Error).message}
        </p>
      )}

      {!query.isLoading && !query.isError && connectors.length === 0 && (
        <ConnectorsEmptyState isAdmin={isAdmin} onAdd={onAdd} />
      )}

      {connectors.length > 0 && (
        <>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {connectors.map((connector) => (
              <ConnectorRow
                key={connector.id}
                connector={connector}
                integrationId={integrationId}
                isAdmin={isAdmin}
                onEdit={() => onEdit(connector)}
                onRotate={() => onRotate(connector)}
                onDelete={() => onDelete(connector)}
                onPeerSetup={() => onPeerSetup(connector)}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Tunnel addresses are allocated by PolySIEM — you never assign one. Adding, disabling, or removing a
            connector takes effect on the edge after <span className="font-medium">Apply</span>.
          </p>
        </>
      )}
    </>
  );
}

/** Create / edit / rotate / delete, all of which are admin-only. */
function ConnectorAdminDialogs({
  server,
  createOpen,
  onCreateOpenChange,
  onCreated,
  editing,
  onEditingChange,
  rotating,
  onRotatingChange,
  onRotated,
  deleting,
  onDeletingChange,
}: {
  server: EdgeNatServer;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
  onCreated: (result: CreateConnectorResult) => void;
  editing: ConnectorDto | null;
  onEditingChange: (connector: ConnectorDto | null) => void;
  rotating: ConnectorDto | null;
  onRotatingChange: (connector: ConnectorDto | null) => void;
  onRotated: (connector: ConnectorDto, reveal: ConnectorInstallReveal) => void;
  deleting: ConnectorDto | null;
  onDeletingChange: (connector: ConnectorDto | null) => void;
}) {
  return (
    <>
      <CreateConnectorDialog server={server} open={createOpen} onOpenChange={onCreateOpenChange} onCreated={onCreated} />

      {editing && (
        <EditConnectorDialog
          key={editing.id}
          server={server}
          connector={editing}
          open
          onOpenChange={(open) => !open && onEditingChange(null)}
        />
      )}

      {rotating && (
        <RotateTokenDialog
          key={rotating.id}
          server={server}
          connector={rotating}
          onOpenChange={(open) => !open && onRotatingChange(null)}
          onRotated={onRotated}
        />
      )}

      {deleting && (
        <DeleteConnectorDialog
          key={deleting.id}
          server={server}
          connector={deleting}
          onOpenChange={(open) => !open && onDeletingChange(null)}
        />
      )}
    </>
  );
}

function ConnectorsEmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PlugZap className="size-5" aria-hidden="true" />
      </div>
      <p className="mt-3 font-medium">No connectors yet</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
        A connector dials out from inside your network, so nothing needs a public IP or an inbound port — like a
        Cloudflare tunnel connector. Install PolySIEM&apos;s agent on a machine that can already reach the service you
        want to publish, or add your OPNsense box (or any other WireGuard endpoint) as a connector and configure that
        side by hand.
      </p>
      {isAdmin && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
          <Plus /> Add connector
        </Button>
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  integrationId,
  isAdmin,
  onEdit,
  onRotate,
  onDelete,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  integrationId: string;
  isAdmin: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  /** Reopens the paste-ready peer block for a manual connector. */
  onPeerSetup: () => void;
}) {
  const manual = isManualConnector(connector);
  const agent = connectorAgentSummary(connector);

  return (
    <li className={cn("p-3", connector.status === "disabled" && "bg-muted/20")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ConnectorRowIdentity connector={connector} manual={manual} />
        {isAdmin && (
          <ConnectorRowActions
            connector={connector}
            manual={manual}
            onEdit={onEdit}
            onRotate={onRotate}
            onDelete={onDelete}
            onPeerSetup={onPeerSetup}
          />
        )}
      </div>

      <ConnectorRowFacts connector={connector} manual={manual} />

      {(agent || connector.notes) && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {agent}
          {agent && connector.notes ? " · " : ""}
          {connector.notes}
        </p>
      )}

      <ConnectorRowManagement
        connector={connector}
        integrationId={integrationId}
        isAdmin={isAdmin}
        manual={manual}
        onPeerSetup={onPeerSetup}
      />
    </li>
  );
}

function ConnectorRowIdentity({ connector, manual }: { connector: ConnectorDto; manual: boolean }) {
  const status = connectorStatusPresentation(connector);
  const kind = connectorKindPresentation(connectorKindOf(connector));
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="truncate font-medium">{connector.name}</p>
        <Badge variant="outline" className="font-normal" title={kind.detail}>
          {manual ? <Waypoints className="size-3" aria-hidden="true" /> : <PlugZap className="size-3" aria-hidden="true" />}
          {kind.label}
        </Badge>
        <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
          {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
          {status.label}
        </Badge>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{status.hint}</p>
    </div>
  );
}

function ConnectorRowActions({
  connector,
  manual,
  onEdit,
  onRotate,
  onDelete,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  manual: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onPeerSetup: () => void;
}) {
  return (
    <div className="flex shrink-0 gap-1">
      {manual && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Show the peer settings for ${connector.name}`}
          title="Peer settings for the far side"
          onClick={onPeerSetup}
        >
          <Waypoints />
        </Button>
      )}
      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${connector.name}`} onClick={onEdit}>
        <Pencil />
      </Button>
      {/* Manual peers hold no token, so there is nothing to rotate. */}
      {!manual && (
        <Button variant="ghost" size="icon-sm" aria-label={`Rotate install token for ${connector.name}`} onClick={onRotate}>
          <KeyRound />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        aria-label={`Delete ${connector.name}`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function ConnectorRowFacts({ connector, manual }: { connector: ConnectorDto; manual: boolean }) {
  const contactAt = connectorLastContactAt(connector);
  return (
    <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Connector ID</p>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.connectorId}</code>
          <CopyButton value={connector.connectorId} label={`Copy the connector ID for ${connector.name}`} />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">
          {manual ? "Tunnel address (assign on the far side)" : "Tunnel address"}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <code className="truncate font-mono text-xs">{connector.tunnelAddress}</code>
          <span
            className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground"
            title="PolySIEM allocates this address — operators never assign it"
          >
            <Waypoints className="size-3" aria-hidden="true" /> assigned automatically
          </span>
        </p>
      </div>
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{manual ? "Far-side public key" : "Latest handshake"}</p>
        {manual ? (
          <p className={cn("mt-0.5 truncate font-medium", !connector.publicKey && "text-warning")}>
            {connector.publicKey ? "Registered" : "Not pasted back yet"}
          </p>
        ) : (
          <p className="mt-0.5 truncate font-medium">
            {contactAt ? formatRelative(contactAt) : connectorContactFallback(connector)}
          </p>
        )}
      </div>
    </div>
  );
}

/** What sits at the bottom of a row: SSH management, or the manual-peer note. */
function ConnectorRowManagement({
  connector,
  integrationId,
  isAdmin,
  manual,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  integrationId: string;
  isAdmin: boolean;
  manual: boolean;
  onPeerSetup: () => void;
}) {
  const ssh = connectorSshPresentation(connector);
  if (manual) return <ManualConnectorSummary connector={connector} isAdmin={isAdmin} onPeerSetup={onPeerSetup} />;
  if (isAdmin) return <ConnectorSshPanel connector={connector} integrationId={integrationId} />;
  if (!ssh.endpoint) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
      <code className="font-mono">{ssh.username}@{ssh.endpoint}</code>
      <span>· {ssh.label.toLowerCase()}</span>
    </p>
  );
}

/**
 * What replaces the SSH panel for a hand-configured peer: there is nothing to
 * log into, so the row states the division of labour instead and points back at
 * the peer block.
 */
function ManualConnectorSummary({
  connector,
  isAdmin,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  isAdmin: boolean;
  onPeerSetup: () => void;
}) {
  const kind = connectorKindPresentation(connectorKindOf(connector));
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {connector.publicKey
          ? <>Configured by hand on {kind.farSide}. PolySIEM registers it as a tunnel peer and forwards traffic to it — it does not manage that machine, so anything past the tunnel is set up there.</>
          : <>PolySIEM is waiting for {kind.farSide}&apos;s public key. Until then it is not a tunnel peer and cannot carry a route.</>}
      </p>
      {isAdmin && (
        <Button type="button" variant="outline" size="sm" onClick={onPeerSetup}>
          <Waypoints /> {connector.publicKey ? "Peer settings" : "Finish setup"}
        </Button>
      )}
    </div>
  );
}

/**
 * SSH management for one connector — the second half of "PolySIEM manages both
 * ends". Collapsed by default: expanding is what triggers a live STATUS read,
 * and every read opens a real SSH session to the machine.
 */
function ConnectorSshPanel({ connector, integrationId }: { connector: ConnectorDto; integrationId: string }) {
  const [open, setOpen] = useState(false);
  const ssh = connectorSshPresentation(connector);
  const username = connectorSshUsername(connector);

  const statusQuery = useQuery({
    queryKey: connectorStatusQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorSshStatus>(connectorStatusUrl(connector.id)),
    // Never on a timer: every fetch is an SSH round trip to the connector.
    enabled: open && ssh.canManage,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium">SSH management</span>
          <Badge
            variant={ssh.tone === "success" ? "secondary" : "outline"}
            className={cn("font-normal", ssh.tone === "warning" && "text-warning")}
          >
            {ssh.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
            {ssh.label}
          </Badge>
          {ssh.endpoint && (
            <code className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
              {username}@{ssh.endpoint}
            </code>
          )}
          <ChevronDown
            className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 rounded-b-lg border border-t-0 p-3">
        <p className="text-xs text-muted-foreground">{ssh.detail}</p>

        <ConnectorSshEndpointForm connector={connector} integrationId={integrationId} />
        <p className="text-xs text-muted-foreground">
          Signs in as <code className="font-mono text-foreground">{username}</code> — the account the installer creates.
          Change it only for a host that must use a different service account. Leave the address blank to manage this
          connector by its poll alone.
        </p>

        <ConnectorSshHostKeySection connector={connector} integrationId={integrationId} />

        <ConnectorSshActions
          connector={connector}
          integrationId={integrationId}
          ssh={ssh}
          statusFetching={statusQuery.isFetching}
          onRefreshStatus={() => void statusQuery.refetch()}
        />

        {ssh.canManage && <ConnectorSshStatusPanel statusQuery={statusQuery} />}

        <ul className="grid gap-1.5 border-t pt-3">
          {CONNECTOR_SSH_TRUST_FACTS.map((fact) => (
            <li key={fact.title} className="flex items-start gap-1.5 text-xs">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>
                <span className="font-medium">{fact.title}.</span>{" "}
                <span className="text-muted-foreground">{fact.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <ConnectorSshKeyLine connector={connector} username={username} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Address, port, and service account PolySIEM signs in with. */
function ConnectorSshEndpointForm({ connector, integrationId }: { connector: ConnectorDto; integrationId: string }) {
  const queryClient = useQueryClient();
  const [host, setHost] = useState(connector.sshHost ?? "");
  const [port, setPort] = useState(String(connector.sshPort || CONNECTOR_SSH_DEFAULT_PORT));
  const [account, setAccount] = useState(connectorSshUsername(connector));

  const trimmedHost = host.trim();
  const trimmedAccount = account.trim();
  const portNumber = Number(port);
  const hostValid = trimmedHost.length === 0 || isValidSshHost(trimmedHost);
  const dirty =
    trimmedHost !== (connector.sshHost ?? "") ||
    portNumber !== (connector.sshPort || CONNECTOR_SSH_DEFAULT_PORT) ||
    trimmedAccount !== connectorSshUsername(connector);

  const endpointMutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_result, input) => {
      toast.success(input.sshHost ? `SSH address saved for ${connector.name}` : `SSH address cleared for ${connector.name}`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(integrationId) });
    },
    onError: (error: Error) => toast.error(`Could not save the SSH address: ${error.message}`),
  });

  const saveEndpoint = (event: FormEvent) => {
    event.preventDefault();
    if (!hostValid || !isValidSshPort(portNumber) || !isValidConnectorSshUsername(trimmedAccount)) {
      toast.error("Enter a reachable hostname or IP, a port from 1–65535, and a Linux service account name.");
      return;
    }
    endpointMutation.mutate({ sshHost: trimmedHost || null, sshPort: portNumber, sshUsername: trimmedAccount });
  };

  return (
    <form onSubmit={saveEndpoint} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor={`ssh-host-${connector.id}`} className="text-xs">Address PolySIEM connects to</Label>
        <Input
          id={`ssh-host-${connector.id}`}
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="10.0.3.12"
          autoComplete="off"
          spellCheck={false}
          className={cn("font-mono", !hostValid && "border-destructive")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`ssh-port-${connector.id}`} className="text-xs">Port</Label>
        <ConfigSelect
          id={`ssh-port-${connector.id}`}
          value={port}
          onChange={setPort}
          choices={CONNECTOR_SSH_PORT_CHOICES}
          customLabel="Custom port…"
          customAriaLabel={`Custom SSH port for ${connector.name}`}
          inputPlaceholder="22"
          inputMode="numeric"
          invalid={!isValidSshPort(portNumber)}
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={!dirty || endpointMutation.isPending}>
        {endpointMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        Save
      </Button>
      <div className="grid gap-1.5 sm:col-span-3 sm:max-w-xs">
        <Label htmlFor={`ssh-user-${connector.id}`} className="text-xs">Service account</Label>
        <ConfigSelect
          id={`ssh-user-${connector.id}`}
          value={account}
          onChange={setAccount}
          choices={CONNECTOR_SSH_USERNAME_CHOICES}
          customLabel="Custom account…"
          customAriaLabel={`Custom SSH service account for ${connector.name}`}
          inputPlaceholder={CONNECTOR_SSH_DEFAULT_USERNAME}
          invalid={!isValidConnectorSshUsername(trimmedAccount)}
        />
      </div>
    </form>
  );
}

/** The pinned host key, and the scan dialog that pins one. */
function ConnectorSshHostKeySection({ connector, integrationId }: { connector: ConnectorDto; integrationId: string }) {
  const [hostKeyOpen, setHostKeyOpen] = useState(false);
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-xs font-medium">Host key</p>
        {connector.sshHostKeyFingerprint ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.sshHostKeyFingerprint}</code>
            <CopyButton value={connector.sshHostKeyFingerprint} label={`Copy the host key fingerprint for ${connector.name}`} />
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not pinned yet. PolySIEM refuses to connect until you confirm the fingerprint.
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!connector.sshHost} onClick={() => setHostKeyOpen(true)}>
        <ScanLine /> {connector.sshHostKeyFingerprint ? "Re-scan" : "Scan and trust"}
      </Button>
      {hostKeyOpen && (
        <ConnectorHostKeyDialog
          connector={connector}
          integrationId={integrationId}
          onOpenChange={(next) => !next && setHostKeyOpen(false)}
        />
      )}
    </div>
  );
}

/** Push config / refresh status, and why they may be unavailable. */
function ConnectorSshActions({
  connector,
  integrationId,
  ssh,
  statusFetching,
  onRefreshStatus,
}: {
  connector: ConnectorDto;
  integrationId: string;
  ssh: ConnectorSshPresentation;
  statusFetching: boolean;
  onRefreshStatus: () => void;
}) {
  const queryClient = useQueryClient();
  const applyMutation = useMutation({
    mutationFn: () => apiFetch<ConnectorApplyResult>(connectorApplyUrl(connector.id), { method: "POST" }),
    onSuccess: (result) => {
      const routes = result?.routeCount;
      toast.success(
        typeof routes === "number"
          ? `Pushed ${routes} route${routes === 1 ? "" : "s"} to ${connector.name}`
          : `Config pushed to ${connector.name}`,
      );
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(integrationId) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onRefreshStatus();
    },
    onError: (error: Error) => toast.error(`Could not push the config: ${error.message}`),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={!ssh.canManage || applyMutation.isPending} onClick={() => applyMutation.mutate()}>
        {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
        Push config now
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!ssh.canManage || statusFetching} onClick={onRefreshStatus}>
        <RefreshCw className={cn(statusFetching && "animate-spin")} /> Refresh status
      </Button>
      {!ssh.canManage && (
        <span className="text-xs text-muted-foreground">
          {ssh.readiness === "untrusted" ? "Trust the host key to enable these." : "Add an address to enable these."}
        </span>
      )}
    </div>
  );
}

/** Live STATUS read from the agent, once the panel is open. */
function ConnectorSshStatusPanel({ statusQuery }: { statusQuery: UseQueryResult<ConnectorSshStatus> }) {
  const status = statusQuery.data;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {statusQuery.isLoading && <Skeleton className="h-16 w-full rounded" />}
      {statusQuery.isError && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Could not read status: {(statusQuery.error as Error).message}
        </p>
      )}
      {status && (
        <>
          <ConnectorSshStatusFacts status={status} />
          <p className="mt-2 truncate text-xs text-muted-foreground">{connectorStatusSummaryLine(status)}</p>
          {status.drift && (
            <Alert variant="destructive" className="mt-3">
              <TriangleAlert />
              <AlertTitle>Live rules drifted from what PolySIEM applied</AlertTitle>
              <AlertDescription>
                Something changed the connector&apos;s firewall outside PolySIEM. Push the config again to restore
                the intended ruleset.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
      {!status && !statusQuery.isLoading && !statusQuery.isError && (
        <p className="text-xs text-muted-foreground">Refresh to read live status from the agent.</p>
      )}
    </div>
  );
}

function ConnectorSshStatusFacts({ status }: { status: ConnectorSshStatus }) {
  const wg = connectorWgStatePresentation(status.wgState);
  const handshakeAt = connectorHandshakeAt(status);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SshFact label="Agent version" value={status.agentVersion ?? "Not reported"} />
      <SshFact label="WireGuard" value={wg.label} tone={wg.tone} hint={status.wgAddress ?? undefined} />
      <SshFact
        label="Latest handshake"
        value={handshakeAt ? formatRelative(handshakeAt) : "No handshake yet"}
        hint={countLabel(status.peers, "peer")}
      />
      <SshFact
        label="Applied revision"
        value={revisionLabel(status.appliedRevision)}
        hint={status.appliedHash ? shortHash(status.appliedHash) : undefined}
      />
    </div>
  );
}

function countLabel(count: number | null | undefined, noun: string): string | undefined {
  if (typeof count !== "number") return undefined;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function revisionLabel(revision: string | number | null | undefined): string {
  return revision === null || revision === undefined ? "None" : String(revision);
}

function forwardingLabel(ipForward: boolean | null | undefined): string | null {
  if (ipForward === null || ipForward === undefined) return null;
  return ipForward ? "forwarding on" : "forwarding off";
}

function connectorStatusSummaryLine(status: ConnectorSshStatus): string {
  return [
    status.hostname,
    status.kernel,
    countLabel(status.routeCount, "route"),
    forwardingLabel(status.ipForward),
  ].filter(Boolean).join(" · ");
}

/** PolySIEM's own key line for this connector, for a machine installed earlier. */
function ConnectorSshKeyLine({ connector, username }: { connector: ConnectorDto; username: string }) {
  const line = connector.sshAuthorizedKey ?? connector.sshPublicKey;
  if (!line) return null;
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">
        {connector.sshAuthorizedKey
          ? <>PolySIEM&apos;s <code className="font-mono">authorized_keys</code> line for this connector — the installer writes it for you; paste it into <code className="font-mono">~{username}/.ssh/authorized_keys</code> only if you are adding SSH to a machine installed before this.</>
          : <>PolySIEM&apos;s public key for this connector.</>}
      </p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[0.6875rem]">{line}</code>
        <CopyButton value={line} label={`Copy the SSH key line for ${connector.name}`} />
      </div>
    </div>
  );
}

function SshFact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-medium",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint && <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** The fingerprint the dialog offers to pin, given what has been chosen or is known. */
function preferredHostKey(connector: ConnectorDto, scan: ConnectorHostKeyScan | undefined, chosen: string): string {
  const keys = scan?.keys ?? [];
  return chosen ||
    connector.sshHostKeyFingerprint ||
    scan?.enrolledFingerprint ||
    (keys.length === 1 ? keys[0].fingerprint : "");
}

/**
 * Host-key trust for a connector, mirroring the edge server's enrollment UX:
 * scan what the host presents, compare a fingerprint out of band, pin one. The
 * service path then uses `StrictHostKeyChecking=yes` against that key only.
 */
function ConnectorHostKeyDialog({
  connector,
  integrationId,
  onOpenChange,
}: {
  connector: ConnectorDto;
  integrationId: string;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const scanQuery = useQuery({
    queryKey: connectorHostKeyQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorHostKeyScan>(connectorHostKeyUrl(connector.id)),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const selected = preferredHostKey(connector, scanQuery.data, selectedFingerprint);

  const enrollMutation = useMutation({
    mutationFn: (fingerprint: string) =>
      apiFetch<ConnectorHostKeyEnrollResult>(connectorHostKeyUrl(connector.id), {
        method: "POST",
        body: JSON.stringify({ fingerprint }),
      }),
    onSuccess: (result) => {
      toast.success(result?.detail || `${connector.name} host key pinned`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(integrationId) });
      void queryClient.invalidateQueries({ queryKey: connectorStatusQueryKey(connector.id) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not trust the host key: ${error.message}`),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trust {connector.name}&apos;s SSH host key</DialogTitle>
          <DialogDescription>
            Compare a fingerprint against the machine&apos;s console before pinning it. PolySIEM only ever connects to the
            key you pin here — a changed or impersonated host is refused, never silently accepted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <HostKeyScanResults scanQuery={scanQuery} selected={selected} onSelect={setSelectedFingerprint} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scanQuery.isFetching}
            onClick={() => void scanQuery.refetch()}
          >
            <RefreshCw className={cn(scanQuery.isFetching && "animate-spin")} /> Scan again
          </Button>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!selected || enrollMutation.isPending}
            onClick={() => selected && enrollMutation.mutate(selected)}
          >
            {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
            Trust this host key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HostKeyScanResults({
  scanQuery,
  selected,
  onSelect,
}: {
  scanQuery: UseQueryResult<ConnectorHostKeyScan>;
  selected: string;
  onSelect: (fingerprint: string) => void;
}) {
  const scan = scanQuery.data;
  const keys = scan?.keys ?? [];
  return (
    <>
      {scanQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {scanQuery.isError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not scan the connector</AlertTitle>
          <AlertDescription>{(scanQuery.error as Error).message}</AlertDescription>
        </Alert>
      )}
      {scan && (
        <>
          <p className="text-xs text-muted-foreground">
            Observed at <code className="font-mono">{scan.host}:{scan.port}</code>
          </p>
          {keys.length === 0 ? (
            <p className="text-sm text-warning">No host keys were returned.</p>
          ) : (
            keys.map((key) => (
              <HostKeyOption
                key={`${hostKeyAlgorithmLabel(key)}:${key.fingerprint}`}
                algorithm={hostKeyAlgorithmLabel(key)}
                fingerprint={key.fingerprint}
                active={selected === key.fingerprint}
                onSelect={() => onSelect(key.fingerprint)}
              />
            ))
          )}
          {scan.warning && <p className="text-xs text-muted-foreground">{scan.warning}</p>}
        </>
      )}
    </>
  );
}

function HostKeyOption({
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
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
        active && "border-primary bg-primary/5",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {active && <Check className="size-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted-foreground uppercase">{algorithm}</span>
        <code className="block break-all text-xs">{fingerprint}</code>
      </span>
    </button>
  );
}

function CreateConnectorDialog({
  server,
  open,
  onOpenChange,
  onCreated,
}: {
  server: EdgeNatServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateConnectorResult) => void;
}) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<ConnectorKind>("agent");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;
  const manual = kind !== "agent";
  const kindCopy = connectorKindPresentation(kind);

  const mutation = useMutation({
    // The integration is named twice on purpose: as the query parameter the list
    // endpoint already uses, and in the body, so either binding satisfies the API.
    mutationFn: () =>
      apiFetch<CreateConnectorResult>(connectorsListUrl(server.id), {
        method: "POST",
        body: JSON.stringify({
          integrationId: server.id,
          name: name.trim(),
          notes: notes.trim() || undefined,
          kind,
        }),
      }),
    onSuccess: (result) => {
      toast.success(
        isManualConnector(result.connector)
          ? `${result.connector.name} created. Paste its settings into ${kindCopy.farSide}.`
          : `${result.connector.name} created. Run the install command to bring it online.`,
      );
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onCreated(result);
    },
    onError: (error: Error) => toast.error(`Could not create the connector: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("Give the connector a short descriptive name.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setKind("agent");
          setName("");
          setNotes("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add connector</DialogTitle>
            <DialogDescription>
              Anything that dials out to {server.name} over WireGuard is a connector. Pick what is on the far side —
              PolySIEM allocates the tunnel address either way.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label id={`connector-kind-${server.id}`}>What is on the far side?</Label>
              <div role="radiogroup" aria-labelledby={`connector-kind-${server.id}`} className="grid gap-2">
                {CONNECTOR_KIND_CHOICES.map((choice) => (
                  <ConnectorKindOption
                    key={choice.value}
                    title={choice.title}
                    detail={choice.detail}
                    active={kind === choice.value}
                    onSelect={() => setKind(choice.value)}
                  />
                ))}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor={`connector-name-${server.id}`}>Connector name</Label>
              <Input
                id={`connector-name-${server.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={connectorNamePlaceholder(kind)}
                maxLength={64}
                autoFocus
                className={cn(nameError && "border-destructive")}
              />
              <p className={cn("text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
                {nameError
                  ? "Start with a letter or number; letters, numbers, spaces, dots, dashes and underscores only."
                  : "Use the name you will recognize later, e.g. the container, VM, or firewall name."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`connector-notes-${server.id}`}>
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id={`connector-notes-${server.id}`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Proxmox LXC on the lab VLAN; reaches 10.0.3.0/24"
                maxLength={1000}
                rows={3}
              />
            </div>
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
              {manual
                ? <>Nothing is installed and no token is issued. PolySIEM reserves an identity and a tunnel address, then shows the exact settings to enter on {kindCopy.farSide} — and waits for you to paste that side&apos;s public key back.</>
                : <>Nothing is installed yet. Creating the connector only reserves its identity and tunnel address — the machine enrolls itself when you run the install command.</>}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !nameValid}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {manual ? "Create and show peer settings" : "Create and show install command"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function connectorNamePlaceholder(kind: ConnectorKind): string {
  if (kind === "agent") return "EdgeNetworkVm";
  return kind === "opnsense" ? "Home OPNsense" : "Branch router";
}

function ConnectorKindOption({
  title,
  detail,
  active,
  onSelect,
}: {
  title: string;
  detail: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
        active && "border-primary bg-primary/5",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {active && <Check className="size-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

function EditConnectorDialog({
  server,
  connector,
  open,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connector.name);
  const [notes, setNotes] = useState(connector.notes ?? "");
  const [enabled, setEnabled] = useState(connector.status !== "disabled");
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success(`${name.trim()} updated. Apply changes to push it to the edge.`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not update the connector: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("Give the connector a short descriptive name.");
      return;
    }
    mutation.mutate({ name: name.trim(), notes: notes.trim() || null, disabled: !enabled });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Edit {connector.name}</DialogTitle>
            <DialogDescription>
              Rename the connector or record what it reaches. Its connector ID and tunnel address are fixed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-connector-name-${connector.id}`}>Connector name</Label>
              <Input
                id={`edit-connector-name-${connector.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                autoFocus
                className={cn(nameError && "border-destructive")}
              />
              {nameError && (
                <p className="text-xs text-destructive">
                  Start with a letter or number; letters, numbers, spaces, dots, dashes and underscores only.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-connector-notes-${connector.id}`}>
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id={`edit-connector-notes-${connector.id}`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor={`edit-connector-enabled-${connector.id}`}>Connector enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Disabling keeps the record but drops its tunnel peer from the edge on the next apply.
                </p>
              </div>
              <Switch
                id={`edit-connector-enabled-${connector.id}`}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="grid gap-1 rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="text-muted-foreground">
                Kind <span className="ml-1 font-medium text-foreground">{connectorKindLabel(connector)}</span>
                <span className="ml-1">· fixed once created</span>
              </p>
              <p className="text-muted-foreground">
                Connector ID <code className="ml-1 font-mono text-foreground">{connector.connectorId}</code>
              </p>
              <p className="text-muted-foreground">
                Tunnel address <code className="ml-1 font-mono text-foreground">{connector.tunnelAddress}</code>
                <span className="ml-1">· assigned automatically</span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !nameValid}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Save connector
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RotateTokenDialog({
  server,
  connector,
  onOpenChange,
  onRotated,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
  onRotated: (connector: ConnectorDto, reveal: ConnectorInstallReveal) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<ConnectorInstallReveal>(connectorRotateTokenUrl(connector.id), { method: "POST" }),
    onSuccess: (reveal) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onRotated(connector, reveal);
    },
    onError: (error: Error) => toast.error(`Could not rotate the token: ${error.message}`),
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Issue a new install token for {connector.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The token this connector is using stops working immediately, so it goes quiet until you re-run the install
            command on the machine. The new token is shown once, on the next screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Rotate token
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteConnectorDialog({
  server,
  connector,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const routeCount = server.rules.filter((rule) => rule.connectorId === connector.id).length;
  const mutation = useMutation({
    mutationFn: () => apiFetch(connectorUrl(connector.id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${connector.name} removed. Apply changes to drop it from the edge.`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not remove the connector: ${error.message}`),
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {connector.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {routeCount > 0
              ? `${routeCount} route${routeCount === 1 ? "" : "s"} published through this connector will be removed with it. `
              : ""}
            {isManualConnector(connector)
              ? "The far side keeps its WireGuard config until you remove it there, but the edge drops its tunnel peer after the next apply."
              : "The machine keeps running its agent until you uninstall it there, but the edge drops its tunnel peer after the next apply."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove connector
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
