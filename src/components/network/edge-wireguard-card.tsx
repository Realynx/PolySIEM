"use client";

import { FormEvent, KeyboardEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Check,
  KeyRound,
  Loader2,
  Radio,
  RefreshCw,
  TriangleAlert,
  Waypoints,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  buildOpnsenseWireguardConfig,
  deriveWireguardView,
  edgeWireguardStatus,
  EDGE_NETWORKS_QUERY_KEY,
  isWireguardFormValid,
  isWireguardPublicKey,
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
  type WireguardTunnelDto,
} from "./edge-networks-types";

/**
 * WireGuard tunnel sub-panel for an Edge server card. The edge is the tunnel
 * LISTENER; the home OPNsense box initiates. Centerpiece: a copy-ready block of
 * everything the user pastes into OPNsense's WireGuard peer for the edge.
 */
export function EdgeWireguardCard({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [configOpen, setConfigOpen] = useState(false);
  const wgQuery = useQuery({
    queryKey: [WIREGUARD_QUERY_KEY, server.id],
    queryFn: () => apiFetch<EdgeWireguardResponse>(`/api/network/edge-networks/servers/${server.id}/wireguard`),
    enabled: server.enabled,
  });
  const data = wgQuery.data;
  const fallbackWg = server.settings?.wireguard;
  const status = edgeWireguardStatus(data?.settings ?? fallbackWg);

  return (
    <section className="overflow-hidden rounded-lg border" aria-labelledby={`wg-${server.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Waypoints className="size-4 text-primary" aria-hidden="true" />
          <h4 id={`wg-${server.id}`} className="text-sm font-semibold">WireGuard tunnel</h4>
          <Badge variant={status.tone === "on" ? "secondary" : "outline"} className={cn("font-normal", status.tone === "pending" && "text-warning")}>
            {status.tone === "on" && <span className="size-1.5 rounded-full bg-success" />}
            {status.label}
          </Badge>
        </div>
        {isAdmin && (
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)} disabled={wgQuery.isLoading}>
            <KeyRound /> {data?.settings.hasPrivateKey ? "Configure tunnel" : "Set up tunnel"}
          </Button>
        )}
      </div>

      <div className="space-y-3 p-3">
        <p className="text-xs text-muted-foreground">
          The edge box only <span className="font-medium text-foreground">listens</span>. Your home OPNsense box
          initiates the tunnel outbound (PersistentKeepalive), so inbound game traffic reaches the LAN even without a
          public IP at home.
        </p>

        {wgQuery.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
        {wgQuery.isError && (
          <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Tunnel status is unavailable: {(wgQuery.error as Error).message}
          </p>
        )}
        {data && <WireguardBody data={data} fallbackWg={fallbackWg} isAdmin={isAdmin} />}
      </div>

      {isAdmin && data && (
        <WireguardConfigDialog server={server} data={data} open={configOpen} onOpenChange={setConfigOpen} />
      )}
    </section>
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
        <WgFact label="Latest handshake" value={handshake} />
        <WgFact label="Home subnets" value={view.subnetCount > 0 ? String(view.subnetCount) : "None"} />
      </div>

      <WireguardPasteBlock edgePublicKey={view.edgePublicKey} peerConfig={peerConfig} keepalive={view.keepalive} />

      {isAdmin && !settings.hasPrivateKey && (
        <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          No edge key yet. Open <span className="font-medium">Set up tunnel</span> to paste your OPNsense public key and
          generate the edge keypair — the edge private key never leaves the server.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Saving records the tunnel as a pending change; use the card&apos;s <span className="font-medium">Apply</span>{" "}
        button to push it to the host.
      </p>
    </>
  );
}

/** Centerpiece: everything to paste into OPNsense's WireGuard peer for the edge. */
function WireguardPasteBlock({
  edgePublicKey,
  peerConfig,
  keepalive,
}: {
  edgePublicKey: string | null;
  peerConfig: WireguardPeerConfigDto;
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
    <div className="space-y-2.5 rounded-lg border bg-primary/[0.03] p-3">
      <div className="flex items-center gap-2">
        <ArrowDownToLine className="size-4 text-primary" aria-hidden="true" />
        <p className="text-sm font-medium">Paste into OPNsense</p>
      </div>
      <CopyField label="Edge public key" value={edgePublicKey} emptyHint="Generate the edge key to reveal it" mono emphasized />
      <div className="grid gap-2 sm:grid-cols-2">
        <CopyField label="Edge endpoint" value={peerConfig.edgeEndpoint} mono />
        <CopyField label="Allowed IPs (on OPNsense)" value={peerConfig.allowedIps.join(", ")} mono />
        <CopyField label="OPNsense tunnel address" value={peerConfig.recommendedOpnsenseAddress} mono />
        <CopyField label="Persistent keepalive" value={String(keepalive)} mono />
      </div>
      <CopyAllSnippet snippet={snippet} />
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

function CopyAllSnippet({ snippet }: { snippet: string }) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    try {
      await copyText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <div className="relative rounded-lg bg-muted p-3 pr-12">
      <pre className="max-h-48 overflow-auto text-xs leading-relaxed"><code>{snippet}</code></pre>
      <Button type="button" variant="ghost" size="sm" className="absolute right-1.5 top-1.5" onClick={copyAll}>
        {copied ? <Check className="text-primary" /> : <RefreshCw />}
        {copied ? "Copied" : "Copy all"}
      </Button>
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
      toast.error("Add the OPNsense public key and at least one home subnet, plus a valid address and port.");
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
              The edge listens; OPNsense initiates. Paste OPNsense&apos;s public key and your home subnets, then generate
              the edge key to paste back into OPNsense.
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

            <div className="grid gap-3 sm:grid-cols-[1fr_0.8fr]">
              <div className="grid gap-1.5">
                <Label htmlFor="wg-interface">Interface</Label>
                <Input id="wg-interface" value={form.interfaceName} onChange={(e) => update({ interfaceName: e.target.value })} placeholder="wg0" className="font-mono" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wg-port">Listen port</Label>
                <Input id="wg-port" inputMode="numeric" value={form.listenPort} onChange={(e) => update({ listenPort: e.target.value })} placeholder="51820" className="font-mono" />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="wg-address">Edge tunnel address</Label>
              <Input
                id="wg-address"
                value={form.address}
                onChange={(e) => update({ address: e.target.value })}
                placeholder="10.9.9.1/24"
                className={cn("font-mono", form.address && !looksLikeCidr(form.address) && "border-destructive")}
              />
              <p className="text-xs text-muted-foreground">OPNsense uses the next address (e.g. 10.9.9.2/24).</p>
            </div>

            <WireguardPeerFields form={form} update={update} />

            <Alert>
              <Radio />
              <AlertTitle>OPNsense is the initiator</AlertTitle>
              <AlertDescription>
                Leave the edge peer&apos;s endpoint blank — OPNsense dials in from its dynamic address and keeps the tunnel
                open with keepalive. The edge only listens on the port above.
              </AlertDescription>
            </Alert>

            {edgePublicKey && <CopyField label="Edge public key (paste into OPNsense)" value={edgePublicKey} mono emphasized />}
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

/** The "Home OPNsense peer" fieldset: peer public key, subnets, keepalive. */
function WireguardPeerFields({
  form,
  update,
}: {
  form: WireguardFormState;
  update: (patch: Partial<WireguardFormState>) => void;
}) {
  const peerKeyValid = isWireguardPublicKey(form.peerPublicKey);
  const peerKeyError = form.peerPublicKey.length > 0 && !peerKeyValid;
  return (
    <div className="rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Radio className="size-3.5 text-primary" /> Home OPNsense peer</p>
      <div className="mt-3 grid gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="wg-peer-key">OPNsense public key</Label>
          <Input
            id="wg-peer-key"
            value={form.peerPublicKey}
            onChange={(e) => update({ peerPublicKey: e.target.value })}
            placeholder="paste the 44-character key ending in ="
            className={cn("font-mono text-xs", peerKeyError && "border-destructive")}
            autoComplete="off"
            spellCheck={false}
          />
          {peerKeyError && <p className="text-xs text-destructive">Expected a 44-character base64 key ending in &quot;=&quot;.</p>}
        </div>
        <AllowedIpsField values={form.allowedIps} onChange={(allowedIps) => update({ allowedIps })} />
        <div className="grid gap-1.5">
          <Label htmlFor="wg-keepalive">Persistent keepalive (seconds)</Label>
          <Input id="wg-keepalive" inputMode="numeric" value={form.keepalive} onChange={(e) => update({ keepalive: e.target.value })} placeholder="25" className="w-28 font-mono" />
        </div>
      </div>
    </div>
  );
}

/** Chip editor for home subnets / AllowedIPs. Accepts comma/space/enter to add. */
function AllowedIpsField({ values, onChange }: { values: string[]; onChange: (next: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const commit = (raw: string) => {
    const parsed = parseAllowedIps(raw);
    if (parsed.length === 0) return;
    const merged = [...values];
    for (const entry of parsed) if (!merged.includes(entry)) merged.push(entry);
    onChange(merged);
    setDraft("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commit(draft);
    } else if (event.key === "Backspace" && draft === "" && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="wg-allowed">Home subnets (AllowedIPs)</Label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((value) => (
            <Badge key={value} variant={looksLikeCidr(value) ? "secondary" : "destructive"} className="gap-1 font-mono font-normal">
              {value}
              <button type="button" onClick={() => onChange(values.filter((entry) => entry !== value))} aria-label={`Remove ${value}`} className="rounded-full hover:text-foreground">
                <X className="size-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id="wg-allowed"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => commit(draft)}
        placeholder="10.0.0.0/24, 10.0.3.20/32"
        className="font-mono text-xs"
        autoComplete="off"
        spellCheck={false}
      />
      <p className={cn("text-xs", values.length > 0 ? "text-muted-foreground" : "text-warning")}>
        {values.length > 0
          ? "The edge routes these subnets into the tunnel toward the home LAN."
          : "Add at least one home subnet that contains your DNAT targets."}
      </p>
    </div>
  );
}
