"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Terminal, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { buildEdgeBootstrapCommand } from "@/lib/integrations/edge-nat/bootstrap";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import {
  buildConnectorPeerSnippet,
  connectorInstallCommandView,
  connectorInstallProgress,
  connectorKindOf,
  connectorPeerBlockFor,
  connectorPeerConfigQueryKey,
  connectorPeerConfigUrl,
  connectorPeerProgress,
  connectorTunnelAddressFor,
  connectorUrl,
  edgeInstallStep,
  edgeTunnelEndpoint,
  isWireguardPublicKey,
  resolveConnectorPeerBlock,
  CONNECTORS_QUERY_PREFIX,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallCommandView,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorLinkDto,
  type ConnectorPeerBlock,
  type ConnectorPeerConfigDto,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import {
  CommandBlock,
  ConnectorInstallCommands,
  ConnectorKindBadge,
  ConnectorStatusBadge,
  InstallEnd,
  InstallStep,
  MobileCopyRow,
  TunnelProvisionedNote,
  elide,
} from "./mobile-connector-atoms";
import { ConnectorLinkKeyRows } from "./mobile-connector-links";

/**
 * The one-time reveal plus the context the install sheet needs to track
 * progress. `ConnectorInstallReveal` carries the TLS variants, so the command
 * that actually works on a self-signed instance survives the trip from the
 * create/rotate response into this sheet.
 */
export interface InstallReveal extends ConnectorInstallReveal {
  connector: ConnectorDto;
  reason: ConnectorInstallReason;
  /** `lastSeenAt` when the sheet opened, so a rotate only claims success on a re-check-in. */
  baselineLastSeenAt: string | null;
  /**
   * The edge whose setup step is worth showing. One install serves every linked
   * edge, so this is context, not ownership — null when the connector is not
   * linked to any edge yet.
   */
  server: EdgeNatServer | null;
  /** Set when creating/linking also brought that edge's WireGuard tunnel up. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
}

/**
 * Manual-kind setup for ONE edge: no token, no command — the peer block and a
 * key to paste back. The block is per-link because the tunnel address is: the
 * far side holds a different address on each edge it peers with.
 */
export interface ManualSetup {
  connector: ConnectorDto;
  server: EdgeNatServer;
  /** The link that carries this edge's tunnel address; null until it is linked. */
  link: ConnectorLinkDto | null;
  /** The paste-ready peer config the create response carried, when it had one. */
  apiPeerConfig?: ConnectorPeerConfigDto | null;
  /** Set when linking this connector also brought that edge's tunnel up. */
  tunnelProvisioned?: ConnectorTunnelProvisionedDto | null;
}

/** The edge's existing bootstrap one-liner; empty when no key has been generated. */
function edgeBootstrapCommand(publicKey: string | null): string {
  if (!publicKey) return "";
  try {
    return buildEdgeBootstrapCommand(publicKey);
  } catch {
    return "";
  }
}

/** Step ① — what the edge server still needs, or proof that it is already set up. */
function EdgeInstallEnd({ server }: { server: EdgeNatServer }) {
  const step = edgeInstallStep(server);
  const command = edgeBootstrapCommand(step.publicKey);
  return (
    <InstallEnd
      index="1"
      heading="On your edge server"
      title={step.title}
      detail={step.detail}
      satisfied={step.satisfied}
    >
      {step.satisfied && step.hostKeyFingerprint && (
        <p className="truncate font-mono text-[11px] text-muted-foreground">
          Pinned host key {elide(step.hostKeyFingerprint, "unknown")}
        </p>
      )}
      {!step.satisfied && <EdgeBootstrapHint command={command} />}
    </InstallEnd>
  );
}

function EdgeBootstrapHint({ command }: { command: string }) {
  if (!command) {
    return (
      <p className="text-[11px] text-warning">
        The edge setup command is unavailable — recreate the Edge NAT integration before continuing.
      </p>
    );
  }
  return (
    <>
      <CommandBlock label="Run as your edge admin" command={command} />
      <p className="text-[11px] text-muted-foreground">
        Then finish the guided setup — scan the host key and install the restricted service — from the edge server
        card.
      </p>
    </>
  );
}

/** Step ② — the one-time install command and what it does on the machine. */
function ConnectorInstallEnd({
  name,
  serverName,
  view,
  connected,
}: {
  name: string;
  serverName: string;
  view: ConnectorInstallCommandView | null;
  connected: boolean;
}) {
  return (
    <InstallEnd
      index="2"
      heading="On your connector"
      title={connected ? `${name} is installed` : "Run this on the internal machine"}
      detail={
        connected
          ? `It dialed out to ${serverName} and the tunnel is up.`
          : "Open a root shell on the machine that can reach the services you want to publish, then paste this."
      }
      satisfied={connected}
    >
      <ConnectorInstallCommands view={view} />
      <ol className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-xs">
        <InstallStep index={1}>
          It installs WireGuard tools, the connector agent, and a PolySIEM-managed SSH key restricted to running that
          agent — never a shell.
        </InstallStep>
        <InstallStep index={2}>
          The agent generates its own WireGuard key locally and enrolls. The private half never leaves the machine.
        </InstallStep>
        <InstallStep index={3}>This screen updates by itself once the connector checks in.</InstallStep>
      </ol>
    </InstallEnd>
  );
}

/**
 * The centerpiece: the two-ended installer. PolySIEM manages BOTH sides, so the
 * sheet is split into "① On your edge server" (its existing restricted key —
 * rendered as a satisfied step once that end is enrolled) and "② On your
 * connector" (the one-time install command). The token inside `installCommand`
 * is minted once and is never retrievable again, so the warning is loud and the
 * list polls behind the sheet until the connector checks in.
 */
export function ConnectorInstallSheet({
  reveal,
  edges,
  live,
  onOpenChange,
}: {
  reveal: InstallReveal;
  edges: readonly EdgeNatServer[];
  live: ConnectorDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const connector = live ?? reveal.connector;
  const server = reveal.server;
  const progress = connectorInstallProgress({
    connector,
    reason: reveal.reason,
    baselineLastSeenAt: reveal.baselineLastSeenAt,
  });
  const connected = progress.state === "connected";
  // Which one-liner actually works against THIS instance. On a default install
  // PolySIEM serves a self-signed certificate, so the plain curl fails.
  const view = connectorInstallCommandView(reveal);

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Install ${reveal.connector.name}`}
      description="PolySIEM manages both ends: the edge server and this connector."
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          The connector command carries a one-time install token and is shown only once. Copy it now — if you lose it,
          rotate the token for a new command.
        </p>

        {server && <EdgeInstallEnd server={server} />}
        <TunnelProvisionedNote tunnel={reveal.tunnelProvisioned} />
        <ConnectorInstallEnd
          name={reveal.connector.name}
          serverName={server?.name ?? "the edge"}
          view={view}
          connected={connected}
        />

        <MobileCopyRow label="Connector ID" value={reveal.connector.connectorId} />

        <MobileList>
          <MobileKeyRow label="Status">
            <Badge variant={connected ? "secondary" : "outline"} className="text-[10px] font-normal">
              {connected && <span className="size-1.5 rounded-full bg-success" />}
              {progress.label}
            </Badge>
          </MobileKeyRow>
          <ConnectorLinkKeyRows connector={connector} edges={edges} />
          {server && (
            <MobileKeyRow label="Dials out to" mono>
              {edgeTunnelEndpoint(server).label}
            </MobileKeyRow>
          )}
        </MobileList>

        <p
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            connected ? "border-success/30 bg-success/5 text-success" : "border-info/30 bg-info/5 text-info",
          )}
        >
          {progress.detail}
          {!connected && " The machine needs outbound UDP access to the edge WireGuard port."}
        </p>
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Once it is up, set its SSH host in the connector details so PolySIEM can push changes immediately as well as
          through the poll. You only install it once — link it to another edge box and it serves that one too.
        </p>

        <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          {connected ? "Done" : "Close — I copied the command"}
        </Button>
      </div>
    </BottomSheet>
  );
}

/** The paste-ready values for the far side, each on its own tap-to-copy row. */
function PeerConfigRows({ block, opnsense }: { block: ConnectorPeerBlock; opnsense: boolean }) {
  return (
    <div className="flex flex-col gap-2">
      <MobileCopyRow label={opnsense ? "Endpoint (edge)" : "Edge endpoint"} value={block.edgeEndpoint} />
      <MobileCopyRow label="Edge public key" value={block.edgePublicKey ?? "Generate the edge key first"} />
      <MobileCopyRow
        label={opnsense ? "Allowed IPs (on the edge peer)" : "AllowedIPs for the edge peer"}
        value={block.allowedIps.join(", ") || "Set the edge tunnel address first"}
      />
      <MobileCopyRow
        label={opnsense ? "Tunnel address for OPNsense" : "Tunnel address for this peer"}
        value={block.tunnelAddressCidr}
      />
      <MobileCopyRow label="Persistent keepalive" value={String(block.persistentKeepalive)} />
    </div>
  );
}

/** The three steps to run on the far side, phrased for OPNsense or a plain peer. */
function PeerInstructions({ opnsense, keepalive }: { opnsense: boolean; keepalive: number }) {
  if (opnsense) {
    return (
      <ol className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-xs">
        <InstallStep index={1}>
          In OPNsense open VPN → WireGuard → Instances, add a local instance and set its address to the tunnel address
          above. Let OPNsense generate its own keypair.
        </InstallStep>
        <InstallStep index={2}>
          Add a peer for this edge: the edge public key, the endpoint above, those Allowed IPs, and keepalive{" "}
          {keepalive}.
        </InstallStep>
        <InstallStep index={3}>
          Enable the instance, then copy OPNsense&apos;s own public key back into the field below.
        </InstallStep>
      </ol>
    );
  }
  return (
    <ol className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-xs">
      <InstallStep index={1}>
        On the far side create a WireGuard interface with the tunnel address above. It generates and keeps its own
        private key.
      </InstallStep>
      <InstallStep index={2}>
        Add this edge as its peer: the edge public key, the endpoint above, those AllowedIPs, and keepalive{" "}
        {keepalive}.
      </InstallStep>
      <InstallStep index={3}>Bring it up, then paste its public key back into the field below.</InstallStep>
    </ol>
  );
}

/** Takes the far side's PUBLIC key back — the only key material that ever travels. */
function PeerKeyForm({ connector, opnsense }: { connector: ConnectorDto; opnsense: boolean }) {
  const queryClient = useQueryClient();
  const [publicKey, setPublicKey] = useState(connector.publicKey ?? "");
  const keyValid = isWireguardPublicKey(publicKey);

  const mutation = useMutation({
    mutationFn: (value: string) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), {
        method: "PATCH",
        body: JSON.stringify({ publicKey: value }),
      }),
    onSuccess: () => {
      // One key identifies this peer on every edge it is linked to, so each of
      // those edges needs an apply to register it.
      toast.success("Peer key saved. Apply each linked edge to register it.");
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(`Could not save the peer key: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!keyValid) {
      toast.error("Paste the far side's 44-character public key (it ends in =).");
      return;
    }
    mutation.mutate(publicKey.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="m-cx-peer-key">{opnsense ? "OPNsense public key" : "Far-side public key"}</Label>
        <Input
          id="m-cx-peer-key"
          value={publicKey}
          onChange={(event) => setPublicKey(event.target.value)}
          placeholder="paste 44-char key ending in ="
          className={cn("font-mono text-xs", publicKey && !keyValid && "border-destructive")}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">
          Only the public half — never paste a private key into PolySIEM.
        </p>
      </div>
      <Button type="submit" className="w-full" disabled={mutation.isPending || !keyValid}>
        {mutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        {connector.publicKey ? "Update peer key" : "Save peer key"}
      </Button>
    </form>
  );
}

/**
 * Manual-kind setup — the sheet that replaced the old "manual OPNsense peer"
 * box. There is no install command and no token here by design: PolySIEM only
 * registers this far end as a WireGuard peer. It hands over the paste-ready
 * block (edge endpoint, edge public key, the far side's AllowedIPs, the tunnel
 * address PolySIEM allocated for it, and the keepalive) and takes the far
 * side's public key back.
 */
export function ConnectorPeerSetupSheet({
  setup,
  live,
  onOpenChange,
}: {
  setup: ManualSetup;
  live: ConnectorDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const connector = live ?? setup.connector;
  const server = setup.server;
  const kind = connectorKindOf(connector);
  const opnsense = kind === "opnsense";
  const progress = connectorPeerProgress(connector);
  // The address belongs to the LINK, so it is re-read from the live connector:
  // this same far end holds a different address on every other edge it serves.
  const tunnelAddress = connectorTunnelAddressFor(connector, server.id) ?? setup.link?.tunnelAddress ?? "";

  // The API may serve a ready-made block per connector; when that endpoint is
  // absent or fails, the shared resolver derives the same values from the edge
  // server this sheet was opened from, so the flow is never blocked.
  const peerConfigQuery = useQuery({
    queryKey: connectorPeerConfigQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorPeerConfigDto>(connectorPeerConfigUrl(connector.id)),
    enabled: server.enabled,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 30_000,
  });
  // The shared resolver answers "what does the far side need on THIS edge",
  // reading the address from that edge's link; the explicit fallback covers a
  // link created a moment ago and not yet in the cached connector.
  const peerConfig = peerConfigQuery.data ?? setup.apiPeerConfig ?? null;
  const block =
    connectorPeerBlockFor({ server, connector, peerConfig }) ??
    resolveConnectorPeerBlock({ server, connector: { tunnelAddress }, peerConfig });
  const snippet = buildConnectorPeerSnippet(block, { kind, name: connector.name });

  const copyAll = async () => {
    try {
      await copyText(snippet);
      toast.success("Peer config copied");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Set up ${connector.name} on ${server.name}`}
      description={
        opnsense
          ? "Paste these into OPNsense, then bring its public key back here."
          : "Paste these into the far side, then bring its public key back here."
      }
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          The far side initiates the tunnel; the edge only listens on its WireGuard port. PolySIEM issues no install
          token and no SSH key for this kind — it just registers the peer.
        </p>

        <TunnelProvisionedNote tunnel={setup.tunnelProvisioned} />

        {peerConfigQuery.isLoading && <Skeleton className="h-16 rounded-xl" />}
        {!tunnelAddress && (
          <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            This connector is not linked to {server.name} yet, so it holds no address on that edge. Link it first — the
            address is allocated by the link.
          </p>
        )}
        {/* Amber means something is wrong, so it waits for the fetched block:
            a tunnel PolySIEM provisioned a moment ago already has a key, and
            the cached edge simply has not caught up yet. */}
        {!block.edgePublicKey && !peerConfigQuery.isLoading && (
          <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            The edge has no WireGuard key yet. Generate it in the tunnel settings above before configuring this peer.
          </p>
        )}

        <PeerConfigRows block={block} opnsense={opnsense} />

        <Button type="button" variant="outline" className="w-full" onClick={copyAll}>
          <Terminal /> Copy the full peer config
        </Button>

        <PeerInstructions opnsense={opnsense} keepalive={block.persistentKeepalive} />

        <PeerKeyForm connector={connector} opnsense={opnsense} />

        <MobileList>
          <MobileKeyRow label="Kind">
            <ConnectorKindBadge kind={kind} />
          </MobileKeyRow>
          <MobileKeyRow label="Status">
            <ConnectorStatusBadge connector={connector} />
          </MobileKeyRow>
          <MobileKeyRow label="Connector ID" mono>
            {connector.connectorId}
          </MobileKeyRow>
          <MobileKeyRow label={`Address on ${server.name}`} mono>
            {tunnelAddress || "Not linked"}
          </MobileKeyRow>
        </MobileList>

        <p
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            progress.state === "configured"
              ? "border-success/30 bg-success/5 text-success"
              : "border-info/30 bg-info/5 text-info",
          )}
        >
          {progress.detail}
        </p>
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Routes published through this peer stop at its tunnel address on this edge — the far side forwards them
          onward to the service itself. Linking the same far end to another edge gives it a second address there, on
          the same WireGuard interface.
        </p>

        <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </BottomSheet>
  );
}
