"use client";

import { type FormEvent, type KeyboardEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, RefreshCw, TriangleAlert, Waypoints, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import {
  buildOpnsenseWireguardConfig,
  deriveWireguardView,
  edgeWireguardStatus,
  EDGE_NETWORKS_QUERY_KEY,
  isWireguardFormValid,
  looksLikeCidr,
  parseAllowedIps,
  seedWireguardForm,
  toWireguardConfigInput,
  WIREGUARD_QUERY_KEY,
  type EdgeNatServer,
  type EdgeWireguardResponse,
  type WireguardConfigInput,
  type WireguardFormState,
  type WireguardPeerConfigDto,
} from "@/components/network/edge-networks-types";

/**
 * Phone WireGuard tunnel block for an edge server: status, the copy-able edge
 * public key, and the OPNsense paste block. Editing happens in a bottom sheet.
 */
export function MobileWireguardBlock({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [configOpen, setConfigOpen] = useState(false);
  const wgQuery = useQuery({
    queryKey: [WIREGUARD_QUERY_KEY, server.id],
    queryFn: () => apiFetch<EdgeWireguardResponse>(`/api/network/edge-networks/servers/${server.id}/wireguard`),
    enabled: server.enabled,
  });
  const data = wgQuery.data;
  const status = edgeWireguardStatus(data?.settings ?? server.settings?.wireguard);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          <Waypoints className="size-3.5" /> WireGuard tunnel
        </span>
        <Badge variant={status.tone === "on" ? "secondary" : "outline"} className={cn("text-[10px] font-normal", status.tone === "pending" && "text-warning")}>
          {status.tone === "on" && <span className="size-1.5 rounded-full bg-success" />}
          {status.label}
        </Badge>
      </div>

      {wgQuery.isLoading && <Skeleton className="h-32 rounded-xl" />}
      {wgQuery.isError && (
        <p className="flex items-start gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Tunnel status unavailable: {(wgQuery.error as Error).message}
        </p>
      )}
      {data && <MobileWireguardBody data={data} server={server} isAdmin={isAdmin} onConfigure={() => setConfigOpen(true)} />}

      {isAdmin && data && configOpen && (
        <MobileWireguardSheet server={server} data={data} onOpenChange={setConfigOpen} />
      )}
    </div>
  );
}

function MobileWireguardBody({
  data,
  server,
  isAdmin,
  onConfigure,
}: {
  data: EdgeWireguardResponse;
  server: EdgeNatServer;
  isAdmin: boolean;
  onConfigure: () => void;
}) {
  const { settings, peerConfig } = data;
  const view = deriveWireguardView(data, server.settings?.wireguard);
  const handshake = view.handshakeAt ? formatRelative(view.handshakeAt) : settings.enabled ? "No handshake yet" : "Not enabled";

  return (
    <>
      {settings.lastApplyError && (
        <p className="flex items-start gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {settings.lastApplyError}
        </p>
      )}

      <MobileList>
        <MobileKeyRow label="Interface" mono>{settings.interfaceName}</MobileKeyRow>
        <MobileKeyRow label="Listen port" mono>{settings.listenPort}</MobileKeyRow>
        <MobileKeyRow label="Latest handshake">{handshake}</MobileKeyRow>
        <MobileKeyRow label="Home subnets">{view.subnetCount}</MobileKeyRow>
      </MobileList>

      <MobileCopyBlock label="Edge public key" value={view.edgePublicKey} emptyHint="Generate the edge key first" emphasized />
      <MobileOpnsenseBlock peerConfig={peerConfig} edgePublicKey={view.edgePublicKey} keepalive={view.keepalive} />

      {isAdmin && (
        <Button variant="outline" size="sm" className="w-full" onClick={onConfigure}>
          <KeyRound /> {settings.hasPrivateKey ? "Configure tunnel" : "Set up tunnel"}
        </Button>
      )}
      <p className="px-0.5 text-[11px] text-muted-foreground">
        The edge only listens; OPNsense initiates. Saving marks a pending change — use Apply to push it.
      </p>
    </>
  );
}

function MobileOpnsenseBlock({
  peerConfig,
  edgePublicKey,
  keepalive,
}: {
  peerConfig: WireguardPeerConfigDto;
  edgePublicKey: string | null;
  keepalive: number;
}) {
  const snippet = buildOpnsenseWireguardConfig({
    edgePublicKey,
    edgeEndpoint: peerConfig.edgeEndpoint,
    opnsenseAddress: peerConfig.recommendedOpnsenseAddress,
    allowedIps: peerConfig.allowedIps,
    keepalive,
  });
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="mb-2 font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Paste into OPNsense</p>
      <div className="flex flex-col gap-2">
        <MobileCopyRow label="Endpoint" value={peerConfig.edgeEndpoint} />
        <MobileCopyRow label="Allowed IPs" value={peerConfig.allowedIps.join(", ")} />
        <MobileCopyRow label="OPNsense address" value={peerConfig.recommendedOpnsenseAddress} />
        <MobileCopyRow label="Keepalive" value={String(keepalive)} />
      </div>
      <MobileCopyAll snippet={snippet} />
    </div>
  );
}

function MobileCopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-background px-2.5 py-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[10px] tracking-wide text-muted-foreground uppercase">{label}</p>
        <p className="truncate font-mono text-xs">{value}</p>
      </div>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  );
}

function MobileCopyBlock({
  label,
  value,
  emptyHint,
  emphasized = false,
}: {
  label: string;
  value: string | null;
  emptyHint?: string;
  emphasized?: boolean;
}) {
  const empty = !value;
  return (
    <div className={cn("rounded-xl border bg-card p-3", emphasized && "border-primary/40")}>
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{label}</p>
        {!empty && <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />}
      </div>
      <p className={cn("mt-1 break-all font-mono text-xs", empty && "text-muted-foreground italic")}>
        {value || emptyHint || "—"}
      </p>
    </div>
  );
}

function MobileCopyAll({ snippet }: { snippet: string }) {
  const copyAll = async () => {
    try {
      await copyText(snippet);
      toast.success("Config copied");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <Button type="button" variant="outline" size="sm" className="mt-2 w-full" onClick={copyAll}>
      <RefreshCw /> Copy full OPNsense config
    </Button>
  );
}

function MobileWireguardSheet({
  server,
  data,
  onOpenChange,
}: {
  server: EdgeNatServer;
  data: EdgeWireguardResponse;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const { settings } = data;
  const initial = useMemo(() => seedWireguardForm(settings), [settings]);
  const [form, setForm] = useState(initial);
  const update = (patch: Partial<WireguardFormState>) => setForm((current) => ({ ...current, ...patch }));
  const formValid = isWireguardFormValid(form);

  const mutation = useMutation({
    mutationFn: (input: WireguardConfigInput) =>
      apiFetch<EdgeWireguardResponse>(`/api/network/edge-networks/servers/${server.id}/wireguard`, {
        method: "PUT",
        body: JSON.stringify(input),
      }),
    onSuccess: (result, variables) => {
      toast.success(variables.regenerateKey ? "Edge key generated. Apply to push it." : "Tunnel saved. Apply to push it.");
      queryClient.setQueryData([WIREGUARD_QUERY_KEY, server.id], result);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      if (!variables.regenerateKey) onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not save the tunnel: ${error.message}`),
  });

  const save = (regenerateKey: boolean) => {
    if (!formValid) {
      toast.error("Add the OPNsense public key and a home subnet, plus a valid address and port.");
      return;
    }
    mutation.mutate(toWireguardConfigInput(form, settings, regenerateKey));
  };
  const submit = (event: FormEvent) => { event.preventDefault(); save(false); };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`WireGuard tunnel — ${server.name}`}
      description="The edge listens; OPNsense initiates. Paste OPNsense's key and home subnets, then generate the edge key."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-wg-enabled">Tunnel enabled</Label>
            <p className="text-xs text-muted-foreground">Routes NAT targets over this interface.</p>
          </div>
          <Switch id="m-wg-enabled" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </div>

        <div className="grid grid-cols-[1fr_0.8fr] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="m-wg-if">Interface</Label>
            <Input id="m-wg-if" value={form.interfaceName} onChange={(e) => update({ interfaceName: e.target.value })} placeholder="wg0" className="font-mono" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-wg-port">Listen port</Label>
            <Input id="m-wg-port" inputMode="numeric" value={form.listenPort} onChange={(e) => update({ listenPort: e.target.value })} placeholder="51820" className="font-mono" />
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="m-wg-addr">Edge tunnel address</Label>
          <Input
            id="m-wg-addr"
            value={form.address}
            onChange={(e) => update({ address: e.target.value })}
            placeholder="10.9.9.1/24"
            className={cn("font-mono", form.address && !looksLikeCidr(form.address) && "border-destructive")}
          />
        </div>

        <MobilePeerFields form={form} update={update} />

        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          Leave the edge peer&apos;s endpoint blank — OPNsense dials in and keeps the tunnel open with keepalive.
        </p>

        {(settings.publicKey ?? data.peerConfig.edgePublicKey) && (
          <MobileCopyBlock label="Edge public key (paste into OPNsense)" value={settings.publicKey ?? data.peerConfig.edgePublicKey} emphasized />
        )}

        {settings.hasPrivateKey && (
          <Button type="button" variant="outline" className="w-full" disabled={mutation.isPending || !formValid} onClick={() => save(true)}>
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Generate new key
          </Button>
        )}
        <Button type="submit" className="w-full" disabled={mutation.isPending || !formValid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
          {settings.hasPrivateKey ? "Save tunnel" : "Save & generate key"}
        </Button>
      </form>
    </BottomSheet>
  );
}

function MobilePeerFields({
  form,
  update,
}: {
  form: WireguardFormState;
  update: (patch: Partial<WireguardFormState>) => void;
}) {
  const [draft, setDraft] = useState("");
  const commitDraft = (raw: string) => {
    const parsed = parseAllowedIps(raw);
    if (parsed.length === 0) return;
    const merged = [...form.allowedIps];
    for (const entry of parsed) if (!merged.includes(entry)) merged.push(entry);
    update({ allowedIps: merged });
    setDraft("");
  };
  const onDraftKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitDraft(draft);
    }
  };
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-wg-peer">OPNsense public key</Label>
        <Input
          id="m-wg-peer"
          value={form.peerPublicKey}
          onChange={(e) => update({ peerPublicKey: e.target.value })}
          placeholder="paste 44-char key ending in ="
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="m-wg-allowed">Home subnets (AllowedIPs)</Label>
        {form.allowedIps.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.allowedIps.map((value) => (
              <Badge key={value} variant={looksLikeCidr(value) ? "secondary" : "destructive"} className="gap-1 font-mono font-normal">
                {value}
                <button type="button" onClick={() => update({ allowedIps: form.allowedIps.filter((entry) => entry !== value) })} aria-label={`Remove ${value}`}>
                  <X className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        <Input
          id="m-wg-allowed"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onDraftKey}
          onBlur={() => commitDraft(draft)}
          placeholder="10.0.0.0/24, 10.0.3.20/32"
          className="font-mono text-xs"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="m-wg-keep">Persistent keepalive</Label>
        <Input id="m-wg-keep" inputMode="numeric" value={form.keepalive} onChange={(e) => update({ keepalive: e.target.value })} placeholder="25" className="w-28 font-mono" />
      </div>
    </>
  );
}
