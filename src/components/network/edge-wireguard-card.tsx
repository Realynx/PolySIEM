"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  PlugZap,
  Radio,
  RefreshCw,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
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
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ConfigSelect } from "./config-select";
import {
  deriveWireguardView,
  edgeWireguardStatus,
  EDGE_NETWORKS_QUERY_KEY,
  isWireguardFormValid,
  looksLikeCidr,
  seedWireguardForm,
  toWireguardConfigInput,
  WIREGUARD_ADDRESS_CHOICES,
  WIREGUARD_INTERFACE_CHOICES,
  WIREGUARD_KEEPALIVE_CHOICES,
  WIREGUARD_LISTEN_PORT_CHOICES,
  WIREGUARD_QUERY_KEY,
  type EdgeNatServer,
  type EdgeWireguardResponse,
  type WireguardConfigInput,
  type WireguardFormState,
  type WireguardPeerConfigDto,
  type WireguardPeerDto,
  type WireguardTunnelDto,
} from "./edge-networks-types";

/**
 * The edge's own half of the tunnel, shared by the Tunnel tab and by the tab
 * trigger's On / Off / Incomplete badge — one fetch backs both.
 */
export function useEdgeWireguardQuery(server: EdgeNatServer) {
  return useQuery({
    queryKey: [WIREGUARD_QUERY_KEY, server.id],
    queryFn: () => apiFetch<EdgeWireguardResponse>(`/api/network/edge-networks/servers/${server.id}/wireguard`),
    enabled: server.enabled,
  });
}

/** The tunnel's headline state, from the query when it has landed, else cached settings. */
export function edgeWireguardTabStatus(server: EdgeNatServer, data?: EdgeWireguardResponse) {
  return edgeWireguardStatus(data?.settings ?? server.settings?.wireguard);
}

/**
 * WireGuard tunnel tab for an Edge server card. The edge is the tunnel
 * LISTENER; every peer dials in to it.
 *
 * Peers are NOT edited here any more — an OPNsense box or any other WireGuard
 * endpoint is added as a connector, which is where its paste-ready block lives.
 * This card owns the edge's own half of the tunnel: interface, port, address,
 * and its keypair. A legacy hand-entered peer is shown read-only.
 */
export function EdgeWireguardCard({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [configOpen, setConfigOpen] = useState(false);
  const wgQuery = useEdgeWireguardQuery(server);
  const data = wgQuery.data;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          The edge box only <span className="font-medium text-foreground">listens</span>. Every peer — a PolySIEM
          connector, an OPNsense box, any other WireGuard endpoint — dials in from its side and holds the tunnel open
          with keepalive, so nothing at home needs a public IP or an inbound port.
        </p>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)} disabled={wgQuery.isLoading}>
            <KeyRound /> {data?.settings.hasPrivateKey ? "Configure tunnel" : "Set up tunnel"}
          </Button>
        )}
      </div>

      {wgQuery.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
      {wgQuery.isError && (
        <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Tunnel status is unavailable: {(wgQuery.error as Error).message}
        </p>
      )}
      {data && <WireguardBody data={data} fallbackWg={server.settings?.wireguard} isAdmin={isAdmin} />}

      {isAdmin && data && (
        <WireguardConfigDialog server={server} data={data} open={configOpen} onOpenChange={setConfigOpen} />
      )}
    </div>
  );
}

function WireguardBody({
  data,
  fallbackWg,
  isAdmin,
}: {
  data: EdgeWireguardResponse;
  fallbackWg: WireguardTunnelDto | undefined;
  isAdmin: boolean;
}) {
  const { settings, peerConfig } = data;
  const view = deriveWireguardView(data, fallbackWg);
  const handshake = view.handshakeAt ? formatRelative(view.handshakeAt) : settings.enabled ? "No handshake yet" : "Not enabled";

  return (
    <>
      {settings.lastApplyError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Last tunnel apply failed</AlertTitle>
          <AlertDescription>{settings.lastApplyError}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <WgFact label="Interface" value={settings.interfaceName} mono />
        <WgFact label="Listen port" value={String(settings.listenPort)} mono />
        <WgFact label="Tunnel subnet" value={settings.address} mono />
        <WgFact label="Latest handshake" value={handshake} />
      </div>

      <EdgeTunnelIdentity edgePublicKey={view.edgePublicKey} peerConfig={peerConfig} keepalive={view.keepalive} />

      {settings.peer && <LegacyPeerNotice peer={settings.peer} />}

      {isAdmin && !settings.hasPrivateKey && (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          No edge key yet. Open <span className="font-medium">Set up tunnel</span> to generate the edge keypair — the
          private half never leaves the server, and peers need the public half below.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Saving records the tunnel as a pending change; use the card&apos;s <span className="font-medium">Apply</span>{" "}
        button to push it to the host.
      </p>
    </>
  );
}

/**
 * The edge's own half of the tunnel — the values every peer needs, whatever kind
 * it is. The per-peer block (with that peer's allocated address) lives on the
 * connector, because that is where a peer is added now.
 */
function EdgeTunnelIdentity({
  edgePublicKey,
  peerConfig,
  keepalive,
}: {
  edgePublicKey: string | null;
  peerConfig: WireguardPeerConfigDto;
  keepalive: number;
}) {
  return (
    <div className="space-y-2.5 rounded-lg border bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2">
        <Waypoints className="size-4 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">What peers dial</p>
      </div>
      <CopyField label="Edge public key" value={edgePublicKey} emptyHint="Generate the edge key to reveal it" mono emphasized />
      <div className="grid gap-2 sm:grid-cols-3">
        <CopyField label="Edge endpoint" value={peerConfig.edgeEndpoint} mono />
        <CopyField label="Allowed IPs (on the peer)" value={peerConfig.allowedIps.join(", ")} mono />
        <CopyField label="Persistent keepalive" value={String(keepalive)} mono />
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <PlugZap className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
        Adding an OPNsense box or another WireGuard endpoint? Add it in the{" "}
        <span className="font-medium text-foreground">Connectors</span> tab and pick its kind — PolySIEM allocates its
        tunnel address and hands you a paste-ready block for that side.
      </p>
    </div>
  );
}

/**
 * A peer typed into this card before connector kinds existed. Read-only on
 * purpose: it still works, but the way to manage a peer now is to add it as a
 * connector, so nothing here invites another hand-entered one.
 */
function LegacyPeerNotice({ peer }: { peer: WireguardPeerDto }) {
  return (
    <div className="rounded-lg border border-dashed p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Radio className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm font-medium">Manually entered peer</p>
        <Badge variant="outline" className="font-normal">Now managed as a connector</Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        This peer was added before OPNsense became a connector kind. It keeps working exactly as it does today, and the
        edge still routes its subnets. To change it — or to add another one — add a connector and choose{" "}
        <span className="font-medium text-foreground">OPNsense</span> or{" "}
        <span className="font-medium text-foreground">Other WireGuard peer</span>.
      </p>
      <div className="mt-2.5 grid gap-2 sm:grid-cols-3">
        <CopyField label="Peer public key" value={peer.publicKey} mono />
        <CopyField label="Allowed IPs" value={peer.allowedIps.join(", ")} mono />
        <CopyField label="Keepalive" value={String(peer.persistentKeepalive)} mono />
      </div>
    </div>
  );
}

function WgFact({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate font-medium", mono && "font-mono text-xs")}>{value}</p>
    </div>
  );
}

/** Labeled read-only value with an inline copy button. */
function CopyField({
  label,
  value,
  emptyHint,
  mono = false,
  emphasized = false,
}: {
  label: string;
  value: string | null;
  emptyHint?: string;
  mono?: boolean;
  emphasized?: boolean;
}) {
  const empty = !value;
  return (
    <div className={cn("rounded-lg border bg-background p-2", emphasized && "border-primary/30")}>
      <p className="px-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <div className="flex items-center gap-1">
        <p className={cn("min-w-0 flex-1 truncate px-1 py-0.5", mono && "font-mono text-xs", empty && "text-muted-foreground italic")}>
          {value || emptyHint || "—"}
        </p>
        {!empty && <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />}
      </div>
    </div>
  );
}

function WireguardConfigDialog({
  server,
  data,
  open,
  onOpenChange,
}: {
  server: EdgeNatServer;
  data: EdgeWireguardResponse;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { settings } = data;
  const initial = useMemo(() => seedWireguardForm(settings), [settings]);
  const [form, setForm] = useState(initial);
  const [formKey, setFormKey] = useState(0);
  const update = (patch: Partial<WireguardFormState>) => setForm((current) => ({ ...current, ...patch }));
  const formValid = isWireguardFormValid(form);
  const edgePublicKey = settings.publicKey ?? data.peerConfig.edgePublicKey;

  const mutation = useMutation({
    mutationFn: (input: WireguardConfigInput) =>
      apiFetch<EdgeWireguardResponse>(`/api/network/edge-networks/servers/${server.id}/wireguard`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (result, variables) => {
      toast.success(variables.regenerateKey ? "Edge key generated. Apply changes to push it." : "WireGuard tunnel saved. Apply changes to push it.");
      queryClient.setQueryData([WIREGUARD_QUERY_KEY, server.id], result);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      if (!variables.regenerateKey) onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not save the tunnel: ${error.message}`),
  });

  const save = (regenerateKey: boolean) => {
    if (!formValid) {
      toast.error("Enter a valid tunnel address, listen port, and keepalive.");
      return;
    }
    mutation.mutate(toWireguardConfigInput(form, settings, regenerateKey));
  };
  const submit = (event: FormEvent) => { event.preventDefault(); save(false); };
  const reopen = (next: boolean) => { if (next) { setForm(initial); setFormKey((k) => k + 1); } onOpenChange(next); };

  return (
    <Dialog open={open} onOpenChange={reopen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents" key={formKey}>
          <DialogHeader>
            <DialogTitle>WireGuard tunnel — {server.name}</DialogTitle>
            <DialogDescription>
              The edge&apos;s own half of the tunnel: which interface it brings up, which UDP port it listens on, and the
              subnet peers are addressed from. Peers themselves are added as connectors.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-1">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="wg-enabled">Tunnel enabled</Label>
                <p className="text-xs text-muted-foreground">When enabled, the edge routes NAT targets over this interface.</p>
              </div>
              <Switch id="wg-enabled" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wg-interface">Interface</Label>
                <ConfigSelect
                  id="wg-interface"
                  value={form.interfaceName}
                  onChange={(interfaceName) => update({ interfaceName })}
                  choices={WIREGUARD_INTERFACE_CHOICES}
                  customLabel="Custom interface…"
                  customAriaLabel="Custom WireGuard interface name"
                  inputPlaceholder="wg0"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wg-port">Listen port</Label>
                <ConfigSelect
                  id="wg-port"
                  value={form.listenPort}
                  onChange={(listenPort) => update({ listenPort })}
                  choices={WIREGUARD_LISTEN_PORT_CHOICES}
                  customLabel="Custom port…"
                  customAriaLabel="Custom WireGuard listen port"
                  inputPlaceholder="51820"
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wg-address">Edge tunnel address</Label>
                <ConfigSelect
                  id="wg-address"
                  value={form.address}
                  onChange={(address) => update({ address })}
                  choices={WIREGUARD_ADDRESS_CHOICES}
                  customLabel="Custom subnet…"
                  customAriaLabel="Custom edge tunnel address"
                  inputPlaceholder="10.9.9.1/24"
                  invalid={Boolean(form.address) && !looksLikeCidr(form.address)}
                />
                <p className="text-xs text-muted-foreground">
                  Peers get addresses from this subnet automatically (10.9.9.2, .3, …) — you never assign one.
                </p>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wg-keepalive">Persistent keepalive</Label>
                <ConfigSelect
                  id="wg-keepalive"
                  value={form.keepalive}
                  onChange={(keepalive) => update({ keepalive })}
                  choices={WIREGUARD_KEEPALIVE_CHOICES}
                  customLabel="Custom interval…"
                  customAriaLabel="Custom keepalive in seconds"
                  inputPlaceholder="25"
                  inputMode="numeric"
                  // Only the legacy manual peer stores a keepalive. Connector peers
                  // are derived with 25s, so with no legacy peer this would edit
                  // nothing — better inert and explained than silently discarded.
                  disabled={!settings.peer}
                />
                <p className="text-xs text-muted-foreground">
                  {settings.peer
                    ? "How often the manually entered peer re-announces itself so the edge keeps its mapping open."
                    : "Connectors dial in every 25 seconds; PolySIEM sets that for them. This applies to a manually entered peer only."}
                </p>
              </div>
            </div>

            <Alert>
              <Radio />
              <AlertTitle>The far side always initiates</AlertTitle>
              <AlertDescription>
                The edge only listens on the port above. Connectors, OPNsense boxes, and any other peer dial in from
                their dynamic address and hold the tunnel open with keepalive — no inbound port at home.
              </AlertDescription>
            </Alert>

            {edgePublicKey && <CopyField label="Edge public key (peers trust this)" value={edgePublicKey} mono emphasized />}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <div>
              {settings.hasPrivateKey && (
                <Button type="button" variant="outline" disabled={mutation.isPending || !formValid} onClick={() => save(true)}>
                  {mutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Generate new key
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
              <Button type="submit" disabled={mutation.isPending || !formValid}>
                {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
                {settings.hasPrivateKey ? "Save tunnel" : "Save & generate key"}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
