"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleCheck,
  Clipboard,
  KeyRound,
  Link2,
  Loader2,
  LockKeyhole,
  Radio,
  Server,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { buildEdgeBootstrapCommand } from "@/lib/integrations/edge-nat/bootstrap";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
import { CopyButton } from "@/components/ssh/copy-button";
import { CommandBlock, ConnectorInstallCommands } from "./connector-install-commands";
import { ConnectorTunnelProvisionedNote } from "./connector-tunnel-notes";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import {
  buildConnectorPeerSnippet,
  connectorAgentSummary,
  connectorInstallCommandView,
  connectorInstallProgress,
  connectorInterfaceName,
  connectorKindOf,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorLinkEdgeName,
  connectorLinks,
  connectorPeerBlockFor,
  connectorPeerConfigQueryKey,
  connectorPeerConfigUrl,
  connectorPeerProgress,
  connectorSshUsername,
  connectorStatusPresentation,
  connectorTunnelAddressFor,
  connectorUrl,
  edgeInstallStep,
  edgeServerForLink,
  edgeTunnelEndpoint,
  isManualConnector,
  isWireguardPublicKey,
  CONNECTOR_INDEPENDENCE_COPY,
  CONNECTOR_SSH_TRUST_FACTS,
  CONNECTORS_QUERY_PREFIX,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorInstallState,
  type ConnectorKind,
  type ConnectorPeerConfigDto,
  type ConnectorPeerState,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "./edge-networks-types";

export interface ConnectorInstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * The one-time token + ready-to-paste command. Null for a MANUAL connector:
   * those never receive a token, so the dialog must not imply one exists.
   */
  reveal: ConnectorInstallReveal | null;
  /** Paste-ready far-side block from the API; derived locally when absent. */
  peerConfig?: ConnectorPeerConfigDto | null;
  /** Why the dialog is open: a brand-new connector, or a re-issued token. */
  reason: ConnectorInstallReason;
  /**
   * Set when creating or linking this connector also stood the edge's WireGuard
   * tunnel up. Optional: an API that does not report it renders nothing extra.
   */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
  /** The connector as returned when the dialog was opened (never changes). */
  connector: ConnectorDto;
  /** Freshest row from the polling connectors list; drives the live status. */
  liveConnector?: ConnectorDto;
  /** Every edge box, so each link resolves to the server it points at. */
  servers: EdgeNatServer[];
  /**
   * The edge box whose card opened this, when one did. It drives step ① and the
   * outbound endpoint to check. Absent on the page-level Connectors tab, where
   * the connector is not being set up "for" any particular edge.
   */
  contextServer?: EdgeNatServer | null;
  /** Opens the edge server's own SSH enrollment dialog, owned by the panel. */
  onSetupEdgeSsh?: () => void;
  /** Opens the "link this connector to an edge box" picker. */
  onLinkEdge?: () => void;
}

/**
 * Setup flow for one connector, branching on its kind.
 *
 * `agent` keeps the two-ended install: PolySIEM manages the edge box AND the
 * connector, so the dialog walks both machines. One install serves every edge
 * box the connector is linked to — the machine is never set up twice.
 *
 * `opnsense` / `peer` have no agent, no token, and no SSH key — PolySIEM can
 * only hand over the values to type on the far side (one address per linked
 * edge) and take that side's public key back.
 */
export function ConnectorInstallDialog(props: ConnectorInstallDialogProps) {
  const current = props.liveConnector ?? props.connector;
  return isManualConnector(current) ? <ManualPeerDialog {...props} /> : <AgentInstallDialog {...props} />;
}

/** The edge boxes a connector serves, resolved to the servers we have loaded. */
function useLinkedServers(connector: ConnectorDto, servers: EdgeNatServer[]): EdgeNatServer[] {
  return useMemo(
    () => connectorLinks(connector)
      .map((link) => edgeServerForLink(servers, link))
      .filter((server): server is EdgeNatServer => server !== null),
    [connector, servers],
  );
}

/**
 * The Cloudflare-style two-ended install for a PolySIEM agent connector.
 *
 * Mount with `key={reveal.installToken}` so a re-issued token resets the
 * baseline used to detect the re-enrollment.
 */
function AgentInstallDialog({
  open,
  onOpenChange,
  reveal,
  reason,
  tunnelProvisioned,
  connector,
  liveConnector,
  servers,
  contextServer,
  onSetupEdgeSsh,
  onLinkEdge,
}: ConnectorInstallDialogProps) {
  const current = liveConnector ?? connector;
  const linkedServers = useLinkedServers(current, servers);
  const primary = contextServer ?? linkedServers[0] ?? null;
  // Captured once per mount: after a rotate the connector is usually already
  // "connected" on its old token, so success needs a fresh check-in.
  const [baselineLastSeenAt] = useState<string | null>(connector.lastSeenAt);
  const [celebrated, setCelebrated] = useState(false);
  const progress = connectorInstallProgress({ connector: liveConnector, reason, baselineLastSeenAt });
  const connected = progress.state === "connected";
  const created = reason === "created";

  useEffect(() => {
    if (!open || !connected || celebrated) return;
    setCelebrated(true);
    toast.success(reason === "created" ? `${connector.name} is connected` : `${connector.name} re-enrolled with the new token`);
  }, [open, connected, celebrated, reason, connector.name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {created ? "Install connector" : "New install token"}
            <span className="text-muted-foreground">—</span>
            {connector.name}
          </DialogTitle>
          <DialogDescription>
            {created
              ? `Install it once on a machine inside your network. ${CONNECTOR_INDEPENDENCE_COPY} It dials out, so nothing at home needs a public IP or an inbound port.`
              : `Re-run the installer on the connector to move ${connector.name} onto this token. The previous token stops working immediately.`}
          </DialogDescription>
        </DialogHeader>

        {reveal && <TokenOnceNotice />}
        <ConnectorTunnelProvisionedNote tunnel={tunnelProvisioned} />

        <div className="space-y-5">
          {primary
            ? <AgentEdgeStep server={primary} onSetupEdgeSsh={contextServer ? onSetupEdgeSsh : undefined} />
            : <AgentNoEdgeStep onLinkEdge={onLinkEdge} />}
          <AgentConnectorStep connector={current} reveal={reveal} edgeEndpointLabel={outboundLabel(primary)} />
          <AgentStatusStep connector={current} progress={progress} primary={primary} />
        </div>

        <ConnectorEdgeScope connector={current} servers={servers} onLinkEdge={onLinkEdge} />

        <TrustPanel />

        <IdentityFooter connector={current} servers={servers} />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant={connected ? "default" : "outline"}>
              {connected ? <Check /> : null}
              {connected ? "Done" : "Close"}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Where the connector has to be able to reach outbound, if we know an edge. */
function outboundLabel(server: EdgeNatServer | null): string {
  return server ? edgeTunnelEndpoint(server).label : "your edge box on its WireGuard UDP port";
}

function TokenOnceNotice() {
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/5 p-3">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium">This token is shown only once</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          PolySIEM keeps only a hash of it. Copy the command now — if it is lost, issue a new one with
          <span className="font-medium text-foreground"> Rotate token</span> rather than trying to recover this one.
        </p>
      </div>
    </div>
  );
}

/**
 * Step ①: the edge end. Already provisioned edges collapse to a satisfied,
 * green step; everything else reuses the edge integration's own restricted key
 * and setup command rather than minting anything new here.
 */
function AgentEdgeStep({ server, onSetupEdgeSsh }: { server: EdgeNatServer; onSetupEdgeSsh?: () => void }) {
  const edge = edgeInstallStep(server);
  const edgeCommand = useMemo(() => {
    if (!edge.publicKey) return null;
    try {
      return buildEdgeBootstrapCommand(edge.publicKey);
    } catch {
      return null;
    }
  }, [edge.publicKey]);

  return (
    <InstallStep number="1" title="On your edge server" satisfied={edge.satisfied} hint={server.name}>
      {edge.satisfied ? (
        <div className="rounded-lg border border-success/40 bg-success/5 p-3">
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <ShieldCheck className="size-4 shrink-0" aria-hidden="true" />
            {edge.title}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{edge.detail}</p>
          {edge.hostKeyFingerprint && (
            <p className="mt-2 truncate text-xs text-muted-foreground">
              Pinned host key <code className="font-mono text-foreground">{edge.hostKeyFingerprint}</code>
            </p>
          )}
          {onSetupEdgeSsh && (
            <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onSetupEdgeSsh}>
              <LockKeyhole /> Review SSH trust
            </Button>
          )}
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{edge.detail}</p>
          {edgeCommand ? (
            <>
              <CommandBlock
                command={edgeCommand}
                caption="Run as your existing edge administrator"
                copyLabel="Copy edge command"
              />
              <p className="text-xs text-muted-foreground">
                This authorizes one temporary setup connection. PolySIEM then installs the restricted{" "}
                <code className="font-mono">polysiem-edge</code> service, pins the host key, and removes that
                temporary access for you.
              </p>
            </>
          ) : (
            <p className="flex items-start gap-1.5 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              This edge server has no generated key yet. Open <span className="font-medium">Set up SSH</span> on the
              server card to issue one.
            </p>
          )}
          {onSetupEdgeSsh && (
            <Button type="button" variant="outline" size="sm" onClick={onSetupEdgeSsh}>
              <LockKeyhole /> Set up SSH on the edge
            </Button>
          )}
        </>
      )}
    </InstallStep>
  );
}

/** Step ① when the connector serves no edge box yet: give it one to dial. */
function AgentNoEdgeStep({ onLinkEdge }: { onLinkEdge?: () => void }) {
  return (
    <InstallStep number="1" title="Give it an edge box to dial">
      <p className="text-sm text-muted-foreground">
        This connector is not linked to an edge box yet, so it has nowhere to dial and no tunnel address. Link it to
        one — you can add more later, and each one allocates its own address on the same interface.
      </p>
      {onLinkEdge && (
        <Button type="button" variant="outline" size="sm" onClick={onLinkEdge}>
          <Link2 /> Link to an edge box
        </Button>
      )}
    </InstallStep>
  );
}

/** Step ②: the one-liner that enrolls the machine inside the network. */
function AgentConnectorStep({
  connector,
  reveal,
  edgeEndpointLabel,
}: {
  connector: ConnectorDto;
  reveal: ConnectorInstallReveal | null;
  edgeEndpointLabel: string;
}) {
  const sshUsername = connectorSshUsername(connector);
  // Null only when there is genuinely no command to show — never an empty block.
  const commands = connectorInstallCommandView(reveal);
  return (
    <InstallStep number="2" title="On your connector" hint={connector.name}>
      <p className="text-sm text-muted-foreground">
        Open a root shell on the machine inside your network — any Linux host that can already reach the service
        you want to publish. It needs outbound access to <code className="font-mono text-xs">{edgeEndpointLabel}</code>,
        and nothing has to be opened inbound.
      </p>
      {commands ? (
        <ConnectorInstallCommands view={commands} />
      ) : (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          No install command is available in this session. Use <span className="font-medium">Rotate token</span> on
          the connector row to issue a fresh one-time token and command.
        </p>
      )}
      <ul className="grid gap-1.5 text-xs text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
          Installs <code className="font-mono">wireguard-tools</code> and the PolySIEM connector agent, then starts
          a service that keeps the tunnel up across reboots.
        </li>
        <li className="flex items-start gap-1.5">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
          Creates the <code className="font-mono">{sshUsername}</code> account and installs PolySIEM&apos;s key for
          it, so this end can be managed exactly like the edge.
        </li>
        <li className="flex items-start gap-1.5">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
          Generates one WireGuard key on the machine and brings up{" "}
          <code className="font-mono">{connectorInterfaceName(connector)}</code> — a single interface that carries one
          peer per edge box you link, so you never run this command twice.
        </li>
      </ul>
    </InstallStep>
  );
}

/** Step ③: the live check-in, polled by the connectors list behind the dialog. */
function AgentStatusStep({
  connector,
  progress,
  primary,
}: {
  connector: ConnectorDto;
  progress: { state: ConnectorInstallState; label: string; detail: string };
  primary: EdgeNatServer | null;
}) {
  const connected = progress.state === "connected";
  const status = connectorStatusPresentation(connector);
  const contactAt = connectorLastContactAt(connector);
  const agentSummary = connectorAgentSummary(connector);
  const address = primary ? connectorTunnelAddressFor(connector, primary.id) : null;
  return (
    <InstallStep number="3" title="Watch it come online">
      <div
        className={cn(
          "rounded-lg border p-3 transition-colors",
          connected && "border-success/40 bg-success/5",
          progress.state === "stale" && "border-warning/40 bg-warning/5",
          progress.state === "disabled" && "border-dashed",
        )}
        aria-live="polite"
      >
        <div className="flex items-start gap-2.5">
          <StatusGlyph state={progress.state} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-medium", connected && "text-success")}>{progress.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{progress.detail}</p>
          </div>
          <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
            {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
            {status.label}
          </Badge>
        </div>

        {connected && (
          <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-3">
            <InstallFact
              label={primary ? `Address on ${primary.name}` : "Tunnel address"}
              value={address ?? "Not linked yet"}
              mono
            />
            <InstallFact label="Latest contact" value={contactAt ? formatRelative(contactAt) : "just now"} />
            <InstallFact label="Reported agent" value={agentSummary ?? "Not reported"} />
          </div>
        )}
      </div>
      {connected ? (
        <p className="text-xs text-muted-foreground">
          Next: set this connector&apos;s SSH address under <span className="font-medium">SSH management</span>, so
          PolySIEM can push config the moment you change a route instead of waiting for the next poll. One push covers
          every edge box it serves.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Status refreshes every few seconds. You can close this dialog — the connector finishes enrolling on its
          own, and the list keeps updating.
        </p>
      )}
    </InstallStep>
  );
}

/** Which edge boxes this one install already covers. */
function ConnectorEdgeScope({
  connector,
  servers,
  onLinkEdge,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  onLinkEdge?: () => void;
}) {
  const links = connectorLinks(connector);
  if (links.length === 0) return null;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium">
          <Server className="size-4 text-primary" aria-hidden="true" /> Edge boxes this one install serves
        </p>
        {onLinkEdge && servers.length > links.length && (
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onLinkEdge}>
            <Link2 /> Link another
          </Button>
        )}
      </div>
      <ul className="mt-2 grid gap-1.5">
        {links.map((link) => (
          <li key={link.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
            <span className="font-medium">{connectorLinkEdgeName(link, servers)}</span>
            <code className="font-mono text-muted-foreground">{link.tunnelAddress}</code>
            <span className="text-muted-foreground">· allocated from that edge&apos;s subnet</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Setup for a hand-configured peer (OPNsense or any other WireGuard endpoint).
 *
 * There is nothing to install and nothing to authenticate: PolySIEM allocates a
 * tunnel address on EACH linked edge box, shows the exact values for the far
 * side, and waits for that side's PUBLIC key. No token, no SSH key, no pushed
 * ruleset — and the private key is generated over there and never travels.
 */
function ManualPeerDialog({
  open,
  onOpenChange,
  peerConfig,
  tunnelProvisioned,
  connector,
  liveConnector,
  servers,
  contextServer,
  onLinkEdge,
}: ConnectorInstallDialogProps) {
  const current = liveConnector ?? connector;
  const kind = connectorKindPresentation(connectorKindOf(current));
  const opnsense = kind.kind === "opnsense";
  const linkedServers = useLinkedServers(current, servers);
  const primary = contextServer ?? linkedServers[0] ?? null;

  // Only asked for when the create response did not already carry the block and
  // there is exactly one edge to describe; with several, each block is derived
  // from the edge it belongs to.
  const peerConfigQuery = useQuery({
    queryKey: connectorPeerConfigQueryKey(current.id),
    queryFn: () => apiFetch<ConnectorPeerConfigDto>(connectorPeerConfigUrl(current.id)),
    enabled: open && !peerConfig && linkedServers.length === 1,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const suppliedPeerConfig = peerConfig ?? peerConfigQuery.data ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {opnsense ? "Set up the OPNsense side" : "Set up the peer"}
            <span className="text-muted-foreground">—</span>
            {current.name}
          </DialogTitle>
          <DialogDescription>
            PolySIEM has reserved this connector&apos;s identity and a tunnel address on every edge box it serves.
            Enter the values below on {kind.farSide}, then paste its public key back here. Nothing is installed and no
            token exists — this kind of connector is a plain WireGuard peer.
          </DialogDescription>
        </DialogHeader>

        <ConnectorTunnelProvisionedNote tunnel={tunnelProvisioned} />

        <ManualPeerDialHint server={primary} farSide={kind.farSide} opnsense={opnsense} />

        <div className="space-y-5">
          <ManualPeerValuesStep
            connector={current}
            servers={linkedServers}
            primary={primary}
            peerConfig={suppliedPeerConfig}
            kindValue={kind.kind}
            opnsense={opnsense}
            onLinkEdge={onLinkEdge}
          />
          <ManualPeerKeyStep connector={current} opnsense={opnsense} />
          <ManualPeerApplyStep connector={current} servers={servers} farSide={kind.farSide} opnsense={opnsense} />
        </div>

        <ManualPeerScopePanel farSide={kind.farSide} />

        <IdentityFooter connector={current} servers={servers} />

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant={current.publicKey ? "default" : "outline"}>
              {current.publicKey ? <Check /> : null}
              {current.publicKey ? "Done" : "Close"}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "The far side dials in" — plus the edge key warning when there is no key. */
function ManualPeerDialHint({
  server,
  farSide,
  opnsense,
}: {
  server: EdgeNatServer | null;
  farSide: string;
  opnsense: boolean;
}) {
  const edgeKeyMissing = Boolean(server) && !server?.settings?.wireguard?.publicKey;
  return (
    <>
      <Alert>
        <Radio />
        <AlertTitle>{opnsense ? "OPNsense dials in; the edge only listens" : "The far side dials in; the edge only listens"}</AlertTitle>
        <AlertDescription>
          An edge box never initiates the tunnel and never needs to reach {farSide}. That side connects outbound to each
          edge it should serve and holds the tunnel open with keepalive, so a dynamic or CGNAT address at that end is
          fine.
        </AlertDescription>
      </Alert>
      {edgeKeyMissing && server && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{server.name} has no tunnel key yet</AlertTitle>
          <AlertDescription>
            Open <span className="font-medium">Tunnel → Set up tunnel</span> on {server.name} and generate its keypair.
            The far side cannot trust a peer whose public key does not exist yet.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

/** Step ①: one paste-ready block per edge box this peer serves. */
function ManualPeerValuesStep({
  connector,
  servers,
  primary,
  peerConfig,
  kindValue,
  opnsense,
  onLinkEdge,
}: {
  connector: ConnectorDto;
  /** Only the edges this connector is actually linked to. */
  servers: EdgeNatServer[];
  primary: EdgeNatServer | null;
  peerConfig: ConnectorPeerConfigDto | null;
  kindValue: ConnectorKind;
  opnsense: boolean;
  onLinkEdge?: () => void;
}) {
  const title = opnsense ? "Enter these in OPNsense" : "Enter these on the far side";
  if (servers.length === 0) {
    return (
      <InstallStep number="1" title={title} hint={connector.name}>
        <Alert>
          <Link2 />
          <AlertTitle>No edge box to peer with yet</AlertTitle>
          <AlertDescription>
            A tunnel address is allocated per edge box, so there is nothing to paste until this connector is linked to
            one.
          </AlertDescription>
        </Alert>
        {onLinkEdge && (
          <Button type="button" variant="outline" size="sm" onClick={onLinkEdge}>
            <Link2 /> Link to an edge box
          </Button>
        )}
      </InstallStep>
    );
  }
  return (
    <InstallStep number="1" title={title} hint={connector.name}>
      <p className="text-sm text-muted-foreground">
        {opnsense
          ? "VPN → WireGuard → Instances: add a local instance and let OPNsense generate its keypair. Give that one instance the tunnel address for every edge box below, and add each edge under Peers with its own public key, endpoint, allowed IPs, and keepalive."
          : "Create ONE WireGuard interface, let that device generate its own keypair, then give it the tunnel address for every edge box below and add each edge as a peer."}
        {servers.length > 1 && " The same keypair is used for all of them — that is what lets one peer serve several edge boxes."}
      </p>
      {servers.map((server) => (
        <ManualPeerEdgeBlock
          key={server.id}
          server={server}
          connector={connector}
          // The create response describes the edge it was created against.
          peerConfig={primary && server.id === primary.id ? peerConfig : null}
          kindValue={kindValue}
          opnsense={opnsense}
          labelled={servers.length > 1}
        />
      ))}
    </InstallStep>
  );
}

/** The values for ONE edge box: its endpoint, key, and this peer's address there. */
function ManualPeerEdgeBlock({
  server,
  connector,
  peerConfig,
  kindValue,
  opnsense,
  labelled,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  peerConfig: ConnectorPeerConfigDto | null;
  kindValue: ConnectorKind;
  opnsense: boolean;
  /** Names the edge above the block, which only helps when there are several. */
  labelled: boolean;
}) {
  const block = connectorPeerBlockFor({ server, connector, peerConfig });
  if (!block) return null;
  const snippet = buildConnectorPeerSnippet(block, { kind: kindValue, name: `${connector.name} → ${server.name}` });
  return (
    <div className="grid gap-2 rounded-lg border bg-primary/[0.03] p-3">
      {labelled && (
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Server className="size-3.5 text-primary" aria-hidden="true" /> {server.name}
        </p>
      )}
      <PeerField
        label="Tunnel address to assign there"
        value={block.tunnelAddressCidr}
        hint="Allocated by PolySIEM for this edge box — do not pick your own"
        emphasized
      />
      <div className="grid gap-2 sm:grid-cols-2">
        <PeerField label="Edge endpoint" value={block.edgeEndpoint} />
        <PeerField label="Edge public key" value={block.edgePublicKey} emptyHint="Generate the edge key first" />
        <PeerField label={opnsense ? "Allowed IPs (on the peer)" : "AllowedIPs"} value={block.allowedIps.join(", ")} />
        <PeerField label="Persistent keepalive" value={String(block.persistentKeepalive)} />
      </div>
      <SnippetBlock snippet={snippet} />
    </div>
  );
}

/** Step ②: taking the far side's PUBLIC key back. Never a private one. */
function ManualPeerKeyStep({ connector, opnsense }: { connector: ConnectorDto; opnsense: boolean }) {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState("");
  const keyValid = isWireguardPublicKey(publicKey);
  const keyError = publicKey.trim().length > 0 && !keyValid;
  const registered = Boolean(connector.publicKey);

  const keyMutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success(`${connector.name} registered. Apply changes on each linked edge box to add it as a peer.`);
      setPublicKey("");
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
      void queryClient.invalidateQueries({ queryKey: connectorPeerConfigQueryKey(connector.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not save the public key: ${error.message}`),
  });

  return (
    <InstallStep number="2" title="Paste its public key back here" satisfied={registered}>
      <p className="text-sm text-muted-foreground">
        {registered
          ? "PolySIEM already holds a public key for this peer. Paste a new one only if you regenerated the keypair on that side."
          : `Copy the PUBLIC key ${opnsense ? "OPNsense" : "that device"} generated. PolySIEM never asks for a private key — that half stays on the far side.`}{" "}
        One key identifies this connector on every edge box it serves.
      </p>
      {connector.publicKey && (
        <PeerField label="Registered public key" value={connector.publicKey} hint="Currently trusted by every linked edge" />
      )}
      <div className="grid gap-1.5">
        <Label htmlFor={`peer-key-${connector.id}`}>
          {registered ? "Replace the public key" : `${opnsense ? "OPNsense" : "Far side"} public key`}
        </Label>
        <div className="flex flex-wrap items-start gap-2">
          <Input
            id={`peer-key-${connector.id}`}
            value={publicKey}
            onChange={(event) => setPublicKey(event.target.value)}
            placeholder="paste the 44-character key ending in ="
            className={cn("min-w-0 flex-1 font-mono text-xs", keyError && "border-destructive")}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            disabled={!keyValid || keyMutation.isPending}
            onClick={() => keyMutation.mutate({ publicKey: publicKey.trim() })}
          >
            {keyMutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Save public key
          </Button>
        </div>
        {keyError && <p className="text-xs text-destructive">Expected a 44-character base64 key ending in &quot;=&quot;.</p>}
      </div>
    </InstallStep>
  );
}

/** Step ③: where the peer stands, and where PolySIEM's reach stops. */
function ManualPeerApplyStep({
  connector,
  servers,
  farSide,
  opnsense,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  farSide: string;
  opnsense: boolean;
}) {
  const progress = connectorPeerProgress(connector);
  const status = connectorStatusPresentation(connector);
  const configured = progress.state === "configured";
  const links = connectorLinks(connector);
  return (
    <InstallStep number="3" title="Apply on each edge box">
      <div
        className={cn(
          "rounded-lg border p-3 transition-colors",
          configured && "border-success/40 bg-success/5",
          progress.state === "disabled" && "border-dashed",
        )}
        aria-live="polite"
      >
        <div className="flex items-start gap-2.5">
          <PeerGlyph state={progress.state} />
          <div className="min-w-0 flex-1">
            <p className={cn("text-sm font-medium", configured && "text-success")}>{progress.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{progress.detail}</p>
          </div>
          <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
            {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
            {status.label}
          </Badge>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Publishing a port through this connector? Each edge forwards it to the address this peer holds on{" "}
        <span className="font-medium">that</span> edge
        {links.length > 0 && (
          <> — {links.map((link) => `${connectorLinkEdgeName(link, servers)} → ${link.tunnelAddress}`).join(", ")}</>
        )}{" "}
        — and stops there. PolySIEM cannot program {farSide}, so add the matching{" "}
        {opnsense ? "port forward in OPNsense" : "forwarding rule on that device"} yourself.
      </p>
    </InstallStep>
  );
}

/** The division of labour for a hand-configured peer, stated once. */
function ManualPeerScopePanel({ farSide }: { farSide: string }) {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <ShieldCheck className="size-4 text-success" aria-hidden="true" /> What PolySIEM does and does not do here
      </p>
      <ul className="mt-2 grid gap-1.5 text-xs">
        <li className="flex items-start gap-1.5">
          <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
          <span>Registers this peer on every edge box you link it to, allocates its tunnel address on each, and forwards the routes you publish to it.</span>
        </li>
        <li className="flex items-start gap-1.5">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span>
            Installs nothing on {farSide}: no agent, no install token, no SSH key. It never holds a credential
            for that machine and never sees its private key.
          </span>
        </li>
      </ul>
    </div>
  );
}

/** Connector ID, its single interface, and its address on each edge box. */
function IdentityFooter({ connector, servers }: { connector: ConnectorDto; servers: EdgeNatServer[] }) {
  const links = connectorLinks(connector);
  return (
    <div className="grid gap-2 rounded-lg border bg-muted/20 p-3 sm:grid-cols-2">
      <div>
        <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Connector ID</p>
        <div className="flex items-center gap-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.connectorId}</code>
          <CopyButton value={connector.connectorId} label="Copy connector ID" />
        </div>
      </div>
      <div>
        <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
          Tunnel {links.length === 1 ? "address" : "addresses"}
        </p>
        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">Allocated when you link it to an edge box</p>
        ) : (
          links.map((link) => (
            <p key={link.id} className="flex flex-wrap items-baseline gap-1.5">
              <code className="font-mono text-xs">{link.tunnelAddress}</code>
              <span className="text-[0.6875rem] text-muted-foreground">on {connectorLinkEdgeName(link, servers)}</span>
            </p>
          ))
        )}
        <p className="mt-0.5 inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
          <Waypoints className="size-3" aria-hidden="true" /> assigned automatically on{" "}
          <code className="font-mono">{connectorInterfaceName(connector)}</code>
        </p>
      </div>
    </div>
  );
}

/** The trust story, stated plainly and once. */
function TrustPanel() {
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium">
        <KeyRound className="size-4 text-primary" aria-hidden="true" /> What these keys can do
      </p>
      <ul className="mt-2 grid gap-2">
        {CONNECTOR_SSH_TRUST_FACTS.map((fact) => (
          <li key={fact.title} className="flex items-start gap-2">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
            <p className="text-xs">
              <span className="font-medium">{fact.title}.</span>{" "}
              <span className="text-muted-foreground">{fact.detail}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function StatusGlyph({ state }: { state: ConnectorInstallState }) {
  if (state === "connected") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
  if (state === "stale") return <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />;
  if (state === "disabled") return <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />;
}

function PeerGlyph({ state }: { state: ConnectorPeerState }) {
  if (state === "configured") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
  if (state === "disabled") return <Radio className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Waypoints className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
}

/** One copyable value from the peer block. Never anything secret. */
function PeerField({
  label,
  value,
  hint,
  emptyHint,
  emphasized = false,
}: {
  label: string;
  value: string | null;
  hint?: string;
  emptyHint?: string;
  emphasized?: boolean;
}) {
  const empty = !value;
  return (
    <div className={cn("rounded-lg border bg-background p-2", emphasized && "border-primary/30")}>
      <p className="px-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("min-w-0 flex-1 truncate px-1 py-0.5 font-mono text-xs", empty && "text-muted-foreground italic")}>
          {value || emptyHint || "—"}
        </p>
        {!empty && <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />}
      </div>
      {hint && <p className="px-1 text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Copy-all block for the whole far-side config. */
function SnippetBlock({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border bg-muted">
      <div className="flex items-center justify-between gap-2 border-b bg-primary/[0.06] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Terminal className="size-3.5 text-primary" aria-hidden="true" /> Whole peer config
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={copy} aria-label="Copy the peer config">
          {copied ? <Check className="text-success" /> : <Clipboard />}
          {copied ? "Copied" : "Copy all"}
        </Button>
      </div>
      <pre className="max-h-56 overflow-auto p-3 text-xs leading-relaxed">
        <code className="break-all whitespace-pre-wrap">{snippet}</code>
      </pre>
    </div>
  );
}

function InstallStep({
  number,
  title,
  hint,
  satisfied = false,
  children,
}: {
  number: string;
  title: string;
  hint?: string;
  /** Renders the marker as a green check instead of the step number. */
  satisfied?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 sm:grid-cols-[2rem_1fr]">
      <div
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-xs font-medium",
          satisfied ? "bg-success/15 text-success ring-1 ring-success/30" : "bg-primary text-primary-foreground",
        )}
        aria-hidden="true"
      >
        {satisfied ? <Check className="size-4" /> : number}
      </div>
      <div className="min-w-0 space-y-3">
        <h3 className="flex flex-wrap items-baseline gap-2 font-medium">
          <span className="sr-only">{`Step ${number}: `}</span>
          {title}
          {hint && <span className="truncate text-xs font-normal text-muted-foreground">{hint}</span>}
        </h3>
        {children}
      </div>
    </section>
  );
}

function InstallFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}
