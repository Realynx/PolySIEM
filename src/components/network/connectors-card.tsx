"use client";

import { useState } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import {
  KeyRound,
  Link2,
  Pencil,
  PlugZap,
  Plus,
  Terminal,
  Trash2,
  TriangleAlert,
  Unlink,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConnectorInstallDialog } from "./connector-install-dialog";
import { ConnectorOtherEdges } from "./connector-link-list";
import { ConnectorSshPanel } from "./connector-ssh-panel";
import {
  CreateConnectorDialog,
  DeleteConnectorDialog,
  EditConnectorDialog,
  LinkConnectorToEdgeDialog,
  LinkEdgeToConnectorDialog,
  RotateTokenDialog,
  UnlinkConnectorDialog,
} from "./connector-dialogs";
import {
  connectorAgentSummary,
  connectorContactFallback,
  connectorInstallReveal,
  connectorKindOf,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorLinkFor,
  connectorPeerSettingsAction,
  connectorSshPresentation,
  connectorStatusPresentation,
  connectorTunnelAddressFor,
  connectorTunnelProvisioned,
  connectorsAllUrl,
  connectorsAvailableToLink,
  connectorsListUrl,
  connectorsQueryKey,
  isManualConnector,
  CONNECTOR_INDEPENDENCE_COPY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorLinkDto,
  type ConnectorPeerConfigDto,
  type ConnectorPeerHandoff,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
} from "./edge-networks-types";

/**
 * The connectors LINKED to one edge server. Shared with the NAT-rule dialog and
 * the card's tab badge (same query key), so a single fetch backs all three.
 *
 * `?integrationId=` filters rather than scopes: a connector shows up here
 * because it serves this edge, not because it belongs to it.
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

/** Every connector on the instance — what the link pickers choose from. */
export function useAllConnectorsQuery(options?: { enabled?: boolean; refetchInterval?: number | false }) {
  return useQuery({
    queryKey: connectorsQueryKey(),
    queryFn: () => apiFetch<ConnectorDto[]>(connectorsAllUrl()),
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
  /** Set when creating the connector also stood this edge's tunnel up. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
  /** One edge box to scope a manual connector's peer settings to. */
  focusIntegrationId?: string | null;
}

/**
 * The peer settings for the edge a link just added, opened on the spot.
 *
 * `reason` is inert for a manual connector — no token, no install steps — so the
 * flow reads as "here is what to paste on the far side", not as an install.
 */
function peerSetupFromHandoff(handoff: ConnectorPeerHandoff): ConnectorSetupState {
  return {
    connector: handoff.connector,
    reason: "created",
    reveal: null,
    peerConfig: handoff.peerConfig,
    tunnelProvisioned: handoff.tunnelProvisioned,
    focusIntegrationId: handoff.integrationId,
  };
}

/** Which per-connector dialog this edge card currently has open. */
interface ConnectorCardDialogs {
  editing: ConnectorDto | null;
  rotating: ConnectorDto | null;
  deleting: ConnectorDto | null;
  linking: ConnectorDto | null;
  unlinking: { connector: ConnectorDto; link: ConnectorLinkDto } | null;
}

const NO_CONNECTOR_DIALOGS: ConnectorCardDialogs = {
  editing: null, rotating: null, deleting: null, linking: null, unlinking: null,
};

/**
 * The link picker is controlled when the panel drives it (the rule editor sends
 * an operator here), and self-contained otherwise, so the card's own button is
 * never wired to nothing.
 */
function useLinkDisclosure(
  open: boolean,
  onOpenChange: ((open: boolean) => void) | undefined,
): [boolean, (open: boolean) => void] {
  const [ownOpen, setOwnOpen] = useState(false);
  return onOpenChange ? [open, onOpenChange] : [ownOpen, setOwnOpen];
}

/**
 * Connectors tab on an Edge server card — the connectors THIS edge routes
 * through.
 *
 * A connector dials OUT to the edge over WireGuard, so no public IP or inbound
 * port is needed at home. It is a standalone thing: installed once, it can be
 * linked to several edge boxes, which is why this tab offers both "Link a
 * connector" (reuse one that already exists) and "Add connector" (install a new
 * one and link it here in the same step).
 */
export function ConnectorsCard({
  server,
  servers,
  isAdmin,
  onSetupEdgeSsh,
  linkOpen = false,
  onLinkOpenChange,
}: {
  server: EdgeNatServer;
  /** Every edge box, so a connector row can name the others it serves. */
  servers: EdgeNatServer[];
  isAdmin: boolean;
  /** Opens the edge server's own SSH enrollment dialog (owned by the panel). */
  onSetupEdgeSsh?: () => void;
  /** Controlled by the card so the rule editor can send an operator here. */
  linkOpen?: boolean;
  onLinkOpenChange?: (open: boolean) => void;
}) {
  const [createOpen, setCreateOpen] = useState(false);
  const [setup, setSetup] = useState<ConnectorSetupState | null>(null);
  const [dialogs, setDialogs] = useState<ConnectorCardDialogs>(NO_CONNECTOR_DIALOGS);
  const [linkDialogOpen, setLinkDialogOpen] = useLinkDisclosure(linkOpen, onLinkOpenChange);
  const close = () => setDialogs(NO_CONNECTOR_DIALOGS);

  const connectorsQuery = useConnectorsQuery(server.id, {
    enabled: server.enabled,
    // While an agent is installing, watch it flip to "connected". A manual peer
    // has no agent to check in, so nothing would ever change on a timer.
    refetchInterval: setup && !isManualConnector(setup.connector) ? 5_000 : false,
  });
  const connectors = connectorsQuery.data ?? [];
  // Only fetched for the "Link a connector" picker, which is admin-only.
  const allConnectors = useAllConnectorsQuery({ enabled: isAdmin && server.enabled }).data ?? [];
  const linkable = connectorsAvailableToLink(allConnectors, server.id);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          A connector <span className="font-medium text-foreground">dials out</span> from inside your network and holds
          the tunnel open. Routes set to <span className="font-medium text-foreground">Via connector</span> hand the last
          hop to it, so the target only has to be reachable from the connector — not from the edge.{" "}
          <span className="font-medium text-foreground">{CONNECTOR_INDEPENDENCE_COPY}</span>
        </p>
        {isAdmin && (connectors.length > 0 || connectorsQuery.isError) && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setLinkDialogOpen(true)} disabled={linkable.length === 0}>
              <Link2 /> Link a connector
            </Button>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
              <Plus /> Add connector
            </Button>
          </div>
        )}
      </div>

      <ConnectorsListBody
        query={connectorsQuery}
        connectors={connectors}
        server={server}
        servers={servers}
        isAdmin={isAdmin}
        linkableCount={linkable.length}
        onAdd={() => setCreateOpen(true)}
        onLinkExisting={() => setLinkDialogOpen(true)}
        onEdit={(connector) => setDialogs({ ...NO_CONNECTOR_DIALOGS, editing: connector })}
        onRotate={(connector) => setDialogs({ ...NO_CONNECTOR_DIALOGS, rotating: connector })}
        onDelete={(connector) => setDialogs({ ...NO_CONNECTOR_DIALOGS, deleting: connector })}
        onUnlink={(connector, link) => setDialogs({ ...NO_CONNECTOR_DIALOGS, unlinking: { connector, link } })}
        // Scoped to THIS edge: the row is about this edge box, so its block is.
        onPeerSetup={(connector) => setSetup({
          connector,
          reason: "created",
          reveal: null,
          focusIntegrationId: server.id,
        })}
      />

      {isAdmin && (
        <>
          <CreateConnectorDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            servers={servers}
            defaultIntegrationId={server.id}
            onCreated={(result) => {
              setCreateOpen(false);
              setSetup({
                connector: result.connector,
                reason: "created",
                reveal: connectorInstallReveal(result),
                peerConfig: result.peerConfig ?? null,
                tunnelProvisioned: connectorTunnelProvisioned(result),
              });
            }}
          />
          <LinkConnectorToEdgeDialog
            server={server}
            servers={servers}
            connectors={linkable}
            open={linkDialogOpen}
            onOpenChange={setLinkDialogOpen}
            onPeerSettings={(handoff) => setSetup(peerSetupFromHandoff(handoff))}
          />
          <ConnectorCardDialogSet dialogs={dialogs} servers={servers} onClose={close} onSetup={setSetup} />
        </>
      )}

      {setup && (
        <ConnectorInstallDialog
          key={setup.reveal?.installToken ?? `${setup.connector.id}:${setup.focusIntegrationId ?? "all"}`}
          open
          onOpenChange={(open) => !open && setSetup(null)}
          reveal={setup.reveal}
          peerConfig={setup.peerConfig}
          reason={setup.reason}
          tunnelProvisioned={setup.tunnelProvisioned}
          connector={setup.connector}
          liveConnector={connectors.find((entry) => entry.id === setup.connector.id)}
          servers={servers}
          contextServer={server}
          focusIntegrationId={setup.focusIntegrationId}
          onSetupEdgeSsh={onSetupEdgeSsh}
          onLinkEdge={() => setDialogs({ ...NO_CONNECTOR_DIALOGS, linking: setup.connector })}
        />
      )}
    </div>
  );
}

/** Edit / rotate / delete / link / unlink, all admin-only, one at a time. */
function ConnectorCardDialogSet({
  dialogs,
  servers,
  onClose,
  onSetup,
}: {
  dialogs: ConnectorCardDialogs;
  servers: EdgeNatServer[];
  onClose: () => void;
  onSetup: (setup: ConnectorSetupState) => void;
}) {
  return (
    <>
      {dialogs.editing && (
        <EditConnectorDialog
          key={dialogs.editing.id}
          connector={dialogs.editing}
          servers={servers}
          open
          onOpenChange={(open) => !open && onClose()}
        />
      )}
      {dialogs.rotating && (
        <RotateTokenDialog
          key={dialogs.rotating.id}
          connector={dialogs.rotating}
          onOpenChange={(open) => !open && onClose()}
          onRotated={(connector, reveal) => {
            onClose();
            onSetup({ connector, reason: "rotated", reveal });
          }}
        />
      )}
      {dialogs.deleting && (
        <DeleteConnectorDialog
          key={dialogs.deleting.id}
          connector={dialogs.deleting}
          servers={servers}
          onOpenChange={(open) => !open && onClose()}
        />
      )}
      {dialogs.linking && (
        <LinkEdgeToConnectorDialog
          key={dialogs.linking.id}
          connector={dialogs.linking}
          servers={servers}
          open
          onOpenChange={(open) => !open && onClose()}
          // Ends on the NEW edge's peer block, not on this card's edge.
          onPeerSettings={(handoff) => {
            onClose();
            onSetup(peerSetupFromHandoff(handoff));
          }}
        />
      )}
      {dialogs.unlinking && (
        <UnlinkConnectorDialog
          key={dialogs.unlinking.link.id}
          connector={dialogs.unlinking.connector}
          link={dialogs.unlinking.link}
          edgeName={servers.find((entry) => entry.id === dialogs.unlinking?.link.integrationId)?.name ?? "this edge box"}
          onOpenChange={(open) => !open && onClose()}
        />
      )}
    </>
  );
}

interface ConnectorRowCallbacks {
  onEdit: (connector: ConnectorDto) => void;
  onRotate: (connector: ConnectorDto) => void;
  onDelete: (connector: ConnectorDto) => void;
  onUnlink: (connector: ConnectorDto, link: ConnectorLinkDto) => void;
  onPeerSetup: (connector: ConnectorDto) => void;
}

/** Loading, error, empty, and populated states of the connectors list. */
function ConnectorsListBody({
  query,
  connectors,
  server,
  servers,
  isAdmin,
  linkableCount,
  onAdd,
  onLinkExisting,
  ...callbacks
}: ConnectorRowCallbacks & {
  query: UseQueryResult<ConnectorDto[]>;
  connectors: ConnectorDto[];
  server: EdgeNatServer;
  servers: EdgeNatServer[];
  isAdmin: boolean;
  linkableCount: number;
  onAdd: () => void;
  onLinkExisting: () => void;
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
        <ConnectorsEmptyState
          isAdmin={isAdmin}
          linkableCount={linkableCount}
          onAdd={onAdd}
          onLinkExisting={onLinkExisting}
        />
      )}

      {connectors.length > 0 && (
        <>
          <ul className="divide-y overflow-hidden rounded-lg border">
            {connectors.map((connector) => (
              <ConnectorRow
                key={connector.id}
                connector={connector}
                server={server}
                servers={servers}
                isAdmin={isAdmin}
                {...callbacks}
              />
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Tunnel addresses are allocated by PolySIEM, one per edge box a connector serves — you never assign one.
            Linking, unlinking, disabling, or removing a connector takes effect on the edge after{" "}
            <span className="font-medium">Apply</span>.
          </p>
        </>
      )}
    </>
  );
}

function ConnectorsEmptyState({
  isAdmin,
  linkableCount,
  onAdd,
  onLinkExisting,
}: {
  isAdmin: boolean;
  linkableCount: number;
  onAdd: () => void;
  onLinkExisting: () => void;
}) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PlugZap className="size-5" aria-hidden="true" />
      </div>
      <p className="mt-3 font-medium">This edge box has no connectors</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
        A connector dials out from inside your network, so nothing needs a public IP or an inbound port — like a
        Cloudflare tunnel connector.{" "}
        {linkableCount > 0
          ? "You already have one installed elsewhere: link it here instead of installing another. One connector can serve every edge box you run."
          : "Install PolySIEM's agent on a machine that can already reach the service you want to publish, or add your OPNsense box (or any other WireGuard endpoint) and configure that side by hand."}
      </p>
      {isAdmin && (
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {linkableCount > 0 && (
            <Button variant="default" size="sm" onClick={onLinkExisting}>
              <Link2 /> Link a connector
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onAdd}>
            <Plus /> Add connector
          </Button>
        </div>
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  server,
  servers,
  isAdmin,
  onEdit,
  onRotate,
  onDelete,
  onUnlink,
  onPeerSetup,
}: ConnectorRowCallbacks & {
  connector: ConnectorDto;
  server: EdgeNatServer;
  servers: EdgeNatServer[];
  isAdmin: boolean;
}) {
  const manual = isManualConnector(connector);
  const agent = connectorAgentSummary(connector);
  const link = connectorLinkFor(connector, server.id);

  return (
    <li className={cn("p-3", connector.status === "disabled" && "bg-muted/20")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <ConnectorRowIdentity connector={connector} manual={manual} />
        {isAdmin && (
          <ConnectorRowActions
            connector={connector}
            manual={manual}
            canUnlink={link !== null}
            edgeName={server.name}
            onEdit={() => onEdit(connector)}
            onRotate={() => onRotate(connector)}
            onDelete={() => onDelete(connector)}
            onUnlink={() => link && onUnlink(connector, link)}
            onPeerSetup={() => onPeerSetup(connector)}
          />
        )}
      </div>

      <ConnectorRowFacts connector={connector} server={server} manual={manual} />
      <ConnectorOtherEdges connector={connector} servers={servers} integrationId={server.id} />

      {(agent || connector.notes) && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {agent}
          {agent && connector.notes ? " · " : ""}
          {connector.notes}
        </p>
      )}

      <ConnectorRowManagement
        connector={connector}
        edgeName={server.name}
        isAdmin={isAdmin}
        manual={manual}
        onPeerSetup={() => onPeerSetup(connector)}
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
  canUnlink,
  edgeName,
  onEdit,
  onRotate,
  onDelete,
  onUnlink,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  manual: boolean;
  canUnlink: boolean;
  edgeName: string;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onUnlink: () => void;
  onPeerSetup: () => void;
}) {
  // Named per edge: with two edge boxes, "peer settings" alone cannot say which.
  const peerAction = connectorPeerSettingsAction({ connectorName: connector.name, edgeName });
  return (
    <div className="flex shrink-0 gap-1">
      {manual && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={peerAction.ariaLabel}
          title={peerAction.title}
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
      {canUnlink && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Unlink ${connector.name} from ${edgeName}`}
          title={`Stop ${edgeName} routing through ${connector.name} — the connector stays installed`}
          onClick={onUnlink}
        >
          <Unlink />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-destructive hover:text-destructive"
        aria-label={`Delete ${connector.name}`}
        title={`Remove ${connector.name} from every edge box`}
        onClick={onDelete}
      >
        <Trash2 />
      </Button>
    </div>
  );
}

function ConnectorRowFacts({
  connector,
  server,
  manual,
}: {
  connector: ConnectorDto;
  server: EdgeNatServer;
  manual: boolean;
}) {
  const contactAt = connectorLastContactAt(connector);
  const address = connectorTunnelAddressFor(connector, server.id);
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
          Tunnel address on {server.name}
          {manual ? " (assign on the far side)" : ""}
        </p>
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5">
          <code className={cn("truncate font-mono text-xs", !address && "text-warning")}>
            {address ?? "Not linked"}
          </code>
          {address && (
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground"
              title="PolySIEM allocates this address from this edge's subnet — operators never assign one"
            >
              <Waypoints className="size-3" aria-hidden="true" /> assigned automatically
            </span>
          )}
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
  edgeName,
  isAdmin,
  manual,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  /** The edge this row is on — the edge whose peer settings the button opens. */
  edgeName: string;
  isAdmin: boolean;
  manual: boolean;
  onPeerSetup: () => void;
}) {
  const ssh = connectorSshPresentation(connector);
  if (manual) {
    return (
      <ManualConnectorSummary connector={connector} edgeName={edgeName} isAdmin={isAdmin} onPeerSetup={onPeerSetup} />
    );
  }
  if (isAdmin) return <ConnectorSshPanel connector={connector} />;
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
  edgeName,
  isAdmin,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  edgeName: string;
  isAdmin: boolean;
  onPeerSetup: () => void;
}) {
  const kind = connectorKindPresentation(connectorKindOf(connector));
  const peerAction = connectorPeerSettingsAction({ connectorName: connector.name, edgeName });
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
      <p className="min-w-0 flex-1 text-xs text-muted-foreground">
        {connector.publicKey
          ? <>Configured by hand on {kind.farSide}. PolySIEM registers it as a tunnel peer and forwards traffic to it — it does not manage that machine, so anything past the tunnel is set up there.</>
          : <>PolySIEM is waiting for {kind.farSide}&apos;s public key. Until then it is not a tunnel peer and cannot carry a route.</>}
      </p>
      {isAdmin && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label={connector.publicKey ? peerAction.ariaLabel : undefined}
          title={peerAction.title}
          onClick={onPeerSetup}
        >
          <Waypoints /> {connector.publicKey ? `Peer settings for ${edgeName}` : "Finish setup"}
        </Button>
      )}
    </div>
  );
}
