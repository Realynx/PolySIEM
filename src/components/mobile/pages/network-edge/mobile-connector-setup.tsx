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
  connectorInstallProgress,
  connectorKindOf,
  connectorPeerConfigQueryKey,
  connectorPeerConfigUrl,
  connectorPeerProgress,
  connectorUrl,
  connectorsQueryKey,
  edgeInstallStep,
  edgeTunnelEndpoint,
  isWireguardPublicKey,
  resolveConnectorPeerBlock,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type ConnectorPeerBlock,
  type ConnectorPeerConfigDto,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import {
  CommandBlock,
  ConnectorCopyRow,
  ConnectorKindBadge,
  ConnectorStatusBadge,
  InstallEnd,
  InstallStep,
  elide,
} from "./mobile-connector-atoms";

/** The one-time reveal plus the context the install sheet needs to track progress. */
export interface InstallReveal extends ConnectorInstallReveal {
  connector: ConnectorDto;
  reason: ConnectorInstallReason;
  /** `lastSeenAt` when the sheet opened, so a rotate only claims success on a re-check-in. */
  baselineLastSeenAt: string | null;
}

/** Manual-kind setup: no token, no command — the peer block and a key to paste back. */
export interface ManualSetup {
  connector: ConnectorDto;
  /** The paste-ready peer config the create response carried, when it had one. */
  apiPeerConfig?: ConnectorPeerConfigDto | null;
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
  command,
  connected,
}: {
  name: string;
  serverName: string;
  command: string;
  connected: boolean;
}) {
  const copyCommand = async () => {
    try {
      await copyText(command);
      toast.success("Install command copied");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
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
      <CommandBlock label="Run as root on the connector" command={command} highlight />
      <Button type="button" className="w-full" onClick={copyCommand}>
        <Terminal /> Copy install command
      </Button>
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
  server,
  reveal,
  live,
  onOpenChange,
}: {
  server: EdgeNatServer;
  reveal: InstallReveal;
  live: ConnectorDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const connector = live ?? reveal.connector;
  const progress = connectorInstallProgress({
    connector,
    reason: reveal.reason,
    baselineLastSeenAt: reveal.baselineLastSeenAt,
  });
  const connected = progress.state === "connected";
  const tunnel = edgeTunnelEndpoint(server);

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

        <EdgeInstallEnd server={server} />
        <ConnectorInstallEnd
          name={reveal.connector.name}
          serverName={server.name}
          command={reveal.installCommand}
          connected={connected}
        />

        <ConnectorCopyRow label="Connector ID" value={reveal.connector.connectorId} />

        <MobileList>
          <MobileKeyRow label="Status">
            <Badge variant={connected ? "secondary" : "outline"} className="text-[10px] font-normal">
              {connected && <span className="size-1.5 rounded-full bg-success" />}
              {progress.label}
            </Badge>
          </MobileKeyRow>
          <MobileKeyRow label="Tunnel address" mono>
            {connector.tunnelAddress}
          </MobileKeyRow>
          <MobileKeyRow label="Dials out to" mono>
            {tunnel.label}
          </MobileKeyRow>
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
          through the poll.
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
      <ConnectorCopyRow label={opnsense ? "Endpoint (edge)" : "Edge endpoint"} value={block.edgeEndpoint} />
      <ConnectorCopyRow label="Edge public key" value={block.edgePublicKey ?? "Generate the edge key first"} />
      <ConnectorCopyRow
        label={opnsense ? "Allowed IPs (on the edge peer)" : "AllowedIPs for the edge peer"}
        value={block.allowedIps.join(", ") || "Set the edge tunnel address first"}
      />
      <ConnectorCopyRow
        label={opnsense ? "Tunnel address for OPNsense" : "Tunnel address for this peer"}
        value={block.tunnelAddressCidr}
      />
      <ConnectorCopyRow label="Persistent keepalive" value={String(block.persistentKeepalive)} />
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
function PeerKeyForm({
  server,
  connector,
  opnsense,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  opnsense: boolean;
}) {
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
      toast.success("Peer key saved. Apply the edge to register it.");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
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
  server,
  setup,
  live,
  onOpenChange,
}: {
  server: EdgeNatServer;
  setup: ManualSetup;
  live: ConnectorDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const connector = live ?? setup.connector;
  const kind = connectorKindOf(connector);
  const opnsense = kind === "opnsense";
  const progress = connectorPeerProgress(connector);

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
  const block = resolveConnectorPeerBlock({
    server,
    connector,
    peerConfig: peerConfigQuery.data ?? setup.apiPeerConfig ?? null,
  });
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
      title={`Set up ${connector.name}`}
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

        {peerConfigQuery.isLoading && <Skeleton className="h-16 rounded-xl" />}
        {!block.edgePublicKey && (
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

        <PeerKeyForm server={server} connector={connector} opnsense={opnsense} />

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
          Routes published through this peer stop at its tunnel address — the far side forwards them onward to the
          service itself.
        </p>

        <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          Done
        </Button>
      </div>
    </BottomSheet>
  );
}
