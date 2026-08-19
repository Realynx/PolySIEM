"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  CircleCheck,
  Clipboard,
  KeyRound,
  Loader2,
  LockKeyhole,
  Radio,
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
  connectorInstallProgress,
  connectorKindOf,
  connectorKindPresentation,
  connectorLastContactAt,
  connectorPeerConfigQueryKey,
  connectorPeerConfigUrl,
  connectorPeerProgress,
  connectorSshUsername,
  connectorStatusPresentation,
  connectorUrl,
  connectorsQueryKey,
  edgeInstallStep,
  isManualConnector,
  isWireguardPublicKey,
  resolveConnectorPeerBlock,
  CONNECTOR_SSH_TRUST_FACTS,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorInstallState,
  type ConnectorKind,
  type ConnectorPeerBlock,
  type ConnectorPeerConfigDto,
  type ConnectorPeerState,
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
  /** The connector as returned when the dialog was opened (never changes). */
  connector: ConnectorDto;
  /** Freshest row from the polling connectors list; drives the live status. */
  liveConnector?: ConnectorDto;
  /** The edge server this connector dials out to — supplies step ①'s state. */
  server: EdgeNatServer;
  /** e.g. "23.94.251.183:51820/udp" — where the connector must reach outbound. */
  edgeEndpointLabel: string;
  /** Opens the edge server's own SSH enrollment dialog, owned by the panel. */
  onSetupEdgeSsh?: () => void;
}

/**
 * Setup flow for one connector, branching on its kind.
 *
 * `agent` keeps the two-ended install exactly as it was: PolySIEM manages the
 * edge box AND the connector, so the dialog walks both machines.
 *
 * `opnsense` / `peer` have no agent, no token, and no SSH key — PolySIEM can
 * only hand over the values to type on the far side and take that side's public
 * key back. Both paths share the same header, status step, and footer so the
 * two feel like one flow with a different middle.
 */
export function ConnectorInstallDialog(props: ConnectorInstallDialogProps) {
  const current = props.liveConnector ?? props.connector;
  return isManualConnector(current) ? <ManualPeerDialog {...props} /> : <AgentInstallDialog {...props} />;
}

/**
 * The Cloudflare-style two-ended install for a PolySIEM agent connector.
 * Step ① reuses the edge integration's existing key and enrollment (and
 * collapses to a green, satisfied step when that end is already provisioned);
 * step ② is the connector one-liner.
 *
 * Mount with `key={reveal.installToken}` so a re-issued token resets the
 * baseline used to detect the re-enrollment.
 */
function AgentInstallDialog({
  open,
  onOpenChange,
  reveal,
  reason,
  connector,
  liveConnector,
  server,
  edgeEndpointLabel,
  onSetupEdgeSsh,
}: ConnectorInstallDialogProps) {
  const current = liveConnector ?? connector;
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
              ? `Two machines, two snippets: ${server.name} at the edge and this connector inside your network. PolySIEM ends up managing both, and the connector dials out so nothing at home needs a public IP or an inbound port.`
              : `Re-run the installer on the connector to move ${connector.name} onto this token. The previous token stops working immediately.`}
          </DialogDescription>
        </DialogHeader>

        {reveal && (
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
        )}

        <div className="space-y-5">
          <AgentEdgeStep server={server} onSetupEdgeSsh={onSetupEdgeSsh} />
          <AgentConnectorStep connector={current} reveal={reveal} edgeEndpointLabel={edgeEndpointLabel} />
          <AgentStatusStep connector={current} progress={progress} />
        </div>

        <TrustPanel />

        <IdentityFooter connector={connector} tunnelAddress={current.tunnelAddress} />

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
  return (
    <InstallStep number="2" title="On your connector" hint={connector.name}>
      <p className="text-sm text-muted-foreground">
        Open a root shell on the machine inside your network — any Linux host that can already reach the service
        you want to publish. It needs outbound access to <code className="font-mono text-xs">{edgeEndpointLabel}</code>,
        and nothing has to be opened inbound.
      </p>
      {reveal ? (
        <CommandBlock command={reveal.installCommand} caption="Run as root" copyLabel="Copy connector command" />
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
          Generates the connector&apos;s own WireGuard key on the machine and enrolls with the one-time token above.
        </li>
      </ul>
    </InstallStep>
  );
}

/** Step ③: the live check-in, polled by the connectors list behind the dialog. */
function AgentStatusStep({
  connector,
  progress,
}: {
  connector: ConnectorDto;
  progress: { state: ConnectorInstallState; label: string; detail: string };
}) {
  const connected = progress.state === "connected";
  const status = connectorStatusPresentation(connector);
  const contactAt = connectorLastContactAt(connector);
  const agentSummary = connectorAgentSummary(connector);
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
            <InstallFact label="Tunnel address" value={connector.tunnelAddress} mono />
            <InstallFact label="Latest contact" value={contactAt ? formatRelative(contactAt) : "just now"} />
            <InstallFact label="Reported agent" value={agentSummary ?? "Not reported"} />
          </div>
        )}
      </div>
      {connected ? (
        <p className="text-xs text-muted-foreground">
          Next: set this connector&apos;s SSH address under <span className="font-medium">SSH management</span> in
          the connectors list, so PolySIEM can push config the moment you change a route instead of waiting for the
          next poll.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Status refreshes every few seconds. You can close this dialog — the connector finishes enrolling on its
          own, and the list on the server card keeps updating.
        </p>
      )}
    </InstallStep>
  );
}

/**
 * Setup for a hand-configured peer (OPNsense or any other WireGuard endpoint).
 *
 * There is nothing to install and nothing to authenticate: PolySIEM allocates a
 * tunnel address, shows the exact values for the far side, and waits for that
 * side's PUBLIC key. No token, no SSH key, no pushed ruleset — and the private
 * key is generated over there and never travels.
 */
function ManualPeerDialog({
  open,
  onOpenChange,
  peerConfig,
  connector,
  liveConnector,
  server,
}: ConnectorInstallDialogProps) {
  const current = liveConnector ?? connector;
  const kind = connectorKindPresentation(connectorKindOf(current));
  const opnsense = kind.kind === "opnsense";

  // Only asked for when the create response did not already carry the block;
  // a missing endpoint is fine, the block is then derived from the edge server.
  const peerConfigQuery = useQuery({
    queryKey: connectorPeerConfigQueryKey(current.id),
    queryFn: () => apiFetch<ConnectorPeerConfigDto>(connectorPeerConfigUrl(current.id)),
    enabled: open && !peerConfig,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const block = resolveConnectorPeerBlock({
    server,
    connector: current,
    peerConfig: peerConfig ?? peerConfigQuery.data ?? null,
  });

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
            PolySIEM has reserved this connector&apos;s identity and tunnel address. Enter the values below on{" "}
            {kind.farSide}, then paste its public key back here. Nothing is installed and no token exists — this kind of
            connector is a plain WireGuard peer.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <Radio />
          <AlertTitle>{opnsense ? "OPNsense dials in; the edge only listens" : "The far side dials in; the edge only listens"}</AlertTitle>
          <AlertDescription>
            {server.name} never initiates the tunnel and never needs to reach {kind.farSide}. That side connects outbound
            to <code className="font-mono">{block.edgeEndpoint}</code> and holds the tunnel open with keepalive, so a
            dynamic or CGNAT address at that end is fine.
          </AlertDescription>
        </Alert>

        {!block.edgePublicKey && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>The edge has no tunnel key yet</AlertTitle>
            <AlertDescription>
              Open <span className="font-medium">Tunnel → Set up tunnel</span> on {server.name} and generate
              its keypair. The far side cannot trust a peer whose public key does not exist yet.
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-5">
          <ManualPeerValuesStep block={block} connector={current} kindValue={kind.kind} opnsense={opnsense} />
          <ManualPeerKeyStep connector={current} server={server} opnsense={opnsense} />
          <ManualPeerApplyStep connector={current} farSide={kind.farSide} opnsense={opnsense} />
        </div>

        <ManualPeerScopePanel farSide={kind.farSide} />

        <IdentityFooter connector={connector} tunnelAddress={current.tunnelAddress} />

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

/** Step ①: every value the far side needs, individually and as one snippet. */
function ManualPeerValuesStep({
  block,
  connector,
  kindValue,
  opnsense,
}: {
  block: ConnectorPeerBlock;
  connector: ConnectorDto;
  kindValue: ConnectorKind;
  opnsense: boolean;
}) {
  const snippet = buildConnectorPeerSnippet(block, { kind: kindValue, name: connector.name });
  return (
    <InstallStep number="1" title={opnsense ? "Enter these in OPNsense" : "Enter these on the far side"} hint={connector.name}>
      <p className="text-sm text-muted-foreground">
        {opnsense
          ? "VPN → WireGuard → Instances: add a local instance with the tunnel address below and let OPNsense generate its keypair. Then under Peers, add the edge with its public key, endpoint, allowed IPs, and keepalive."
          : "Create a WireGuard interface with the tunnel address below, let that device generate its own keypair, and add the edge as its peer using these values."}
      </p>
      <div className="grid gap-2 rounded-lg border bg-primary/[0.03] p-3">
        <PeerField
          label="Tunnel address to assign there"
          value={block.tunnelAddressCidr}
          hint="Allocated by PolySIEM — do not pick your own"
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
    </InstallStep>
  );
}

/** Step ②: taking the far side's PUBLIC key back. Never a private one. */
function ManualPeerKeyStep({
  connector,
  server,
  opnsense,
}: {
  connector: ConnectorDto;
  server: EdgeNatServer;
  opnsense: boolean;
}) {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState("");
  const keyValid = isWireguardPublicKey(publicKey);
  const keyError = publicKey.trim().length > 0 && !keyValid;
  const registered = Boolean(connector.publicKey);

  const keyMutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success(`${connector.name} registered. Apply changes on ${server.name} to add it as a peer.`);
      setPublicKey("");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
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
          : `Copy the PUBLIC key ${opnsense ? "OPNsense" : "that device"} generated. PolySIEM never asks for a private key — that half stays on the far side.`}
      </p>
      {connector.publicKey && (
        <PeerField label="Registered public key" value={connector.publicKey} hint="Currently trusted by the edge" />
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
  farSide,
  opnsense,
}: {
  connector: ConnectorDto;
  farSide: string;
  opnsense: boolean;
}) {
  const progress = connectorPeerProgress(connector);
  const status = connectorStatusPresentation(connector);
  const configured = progress.state === "configured";
  return (
    <InstallStep number="3" title="Apply on the edge">
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
        Publishing a port through this connector? The edge forwards it to{" "}
        <code className="font-mono">{connector.tunnelAddress}</code> over the tunnel and stops there — PolySIEM
        cannot program {farSide}, so add the matching{" "}
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
          <span>Registers this peer on the edge, allocates its tunnel address, and forwards the routes you publish to it.</span>
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

/** Connector ID + allocated tunnel address, shared by both flows. */
function IdentityFooter({ connector, tunnelAddress }: { connector: ConnectorDto; tunnelAddress: string }) {
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
        <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">Tunnel address</p>
        <p className="flex flex-wrap items-baseline gap-1.5">
          <code className="font-mono text-xs">{tunnelAddress}</code>
          <span className="inline-flex items-center gap-1 text-[0.6875rem] text-muted-foreground">
            <Waypoints className="size-3" aria-hidden="true" /> assigned automatically
          </span>
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

/** The copy-paste centerpiece: prominent, monospace, one obvious copy action. */
function CommandBlock({ command, caption, copyLabel }: { command: string; caption: string; copyLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await copyText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <div className="overflow-hidden rounded-lg border border-primary/30 bg-muted">
      <div className="flex items-center justify-between gap-2 border-b border-primary/20 bg-primary/[0.06] px-3 py-1.5">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <Terminal className="size-3.5 text-primary" aria-hidden="true" /> {caption}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-7" onClick={copy} aria-label={copyLabel}>
          {copied ? <Check className="text-success" /> : <Clipboard />}
          {copied ? "Copied" : "Copy command"}
        </Button>
      </div>
      <pre className="max-h-40 overflow-auto p-3 text-xs leading-relaxed">
        <code className="break-all whitespace-pre-wrap">{command}</code>
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
