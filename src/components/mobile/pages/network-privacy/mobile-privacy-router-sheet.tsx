"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  formatPrivacyClientNetworks,
  parsePrivacyClientNetworks,
  privacyClientNetworksError,
  PRIVACY_QUIC_FIELD_HELP,
  PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE,
  PRIVACY_ROUTER_MANAGEMENT_NOTE,
  PRIVACY_ROUTER_ONE_ARMED_NOTE,
  PRIVACY_ROUTER_PROXY_PORT_NOTE,
  PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRouterUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyRouterDto,
} from "@/components/network/privacy-router-types";
import { MobilePrivacyClientNetworksField } from "./mobile-privacy-topology";

/**
 * The box-level settings that are neither rules nor exits, on a phone: where
 * PolySIEM reaches this router, the topology it serves, the proxy's ports and
 * the QUIC block.
 *
 * This sheet no longer creates routers — `mobile-privacy-add-sheet.tsx` does,
 * in four steps. Same fields, same endpoints and the same coercions as the
 * desktop settings dialog; only the container is a bottom sheet. The default
 * action is not here either: it is the last line of the firewall and is edited
 * at the foot of the Rules tab, where its meaning is obvious from position.
 */

interface PrivacyRouterFormState {
  name: string;
  host: string;
  port: string;
  username: string;
  lanCidr: string;
  lanInterface: string;
  wanInterface: string;
  /** Free text, one CIDR per line or comma separated. Parsed at submit. */
  clientNetworks: string;
  proxyHttpPort: string;
  proxyHttpsPort: string;
  blockQuic: boolean;
  enabled: boolean;
}

function seedPrivacyRouterForm(router: PrivacyRouterDto): PrivacyRouterFormState {
  return {
    name: router.name,
    host: router.ssh.host,
    port: String(router.ssh.port),
    username: router.ssh.username,
    lanCidr: router.lanCidr ?? "",
    lanInterface: router.lanInterface ?? "",
    wanInterface: router.wanInterface ?? "",
    clientNetworks: formatPrivacyClientNetworks(router.clientNetworks),
    proxyHttpPort: String(router.proxyHttpPort),
    proxyHttpsPort: String(router.proxyHttpsPort),
    blockQuic: router.blockQuic,
    enabled: router.enabled,
  };
}

/**
 * The three topology fields go out as null when blank rather than as `""` or a
 * guessed `eth0`: "not confirmed yet" is a state this router is allowed to be
 * in, and `apply` refuses while it is.
 *
 * The client list goes out EMPTY when blank for the same reason, and is never
 * quietly backfilled from `lanCidr` here — that would be the exact conflation
 * this field exists to end.
 */
function privacyRouterBodyFrom(form: PrivacyRouterFormState) {
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    host: form.host.trim(),
    port: Number(form.port) || 22,
    username: form.username.trim() || "polysiem-vpn",
    lanCidr: form.lanCidr.trim() || null,
    lanInterface: form.lanInterface.trim() || null,
    wanInterface: form.wanInterface.trim() || null,
    clientNetworks: parsePrivacyClientNetworks(form.clientNetworks).networks,
    proxyHttpPort: Number(form.proxyHttpPort) || 3128,
    proxyHttpsPort: Number(form.proxyHttpsPort) || 3129,
    blockQuic: form.blockQuic,
  };
}

function PrivacyRouterReachFields({
  form,
  update,
}: {
  form: PrivacyRouterFormState;
  update: (patch: Partial<PrivacyRouterFormState>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-[1fr_0.4fr] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-host">SSH address</Label>
          <Input
            id="m-privacy-router-host"
            value={form.host}
            onChange={(event) => update({ host: event.target.value })}
            placeholder="10.0.3.70"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-port">Port</Label>
          <Input
            id="m-privacy-router-port"
            inputMode="numeric"
            value={form.port}
            onChange={(event) => update({ port: event.target.value })}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE}</p>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-router-lan">Router&apos;s own network</Label>
        <Input
          id="m-privacy-router-lan"
          value={form.lanCidr}
          onChange={(event) => update({ lanCidr: event.target.value })}
          placeholder="10.0.3.0/24"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <MobilePrivacyClientNetworksField
        value={form.clientNetworks}
        lanCidr={form.lanCidr || null}
        onChange={(clientNetworks) => update({ clientNetworks })}
      />
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-router-username">Service account</Label>
        <Input
          id="m-privacy-router-username"
          value={form.username}
          onChange={(event) => update({ username: event.target.value })}
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-lanif">LAN interface</Label>
          <Input
            id="m-privacy-router-lanif"
            value={form.lanInterface}
            onChange={(event) => update({ lanInterface: event.target.value })}
            placeholder="eth0"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-wanif">WAN interface</Label>
          <Input
            id="m-privacy-router-wanif"
            value={form.wanInterface}
            onChange={(event) => update({ wanInterface: event.target.value })}
            placeholder="eth0"
            autoCapitalize="none"
            spellCheck={false}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_ONE_ARMED_NOTE}</p>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE}</p>
    </>
  );
}

function PrivacyRouterProxyFields({
  form,
  update,
}: {
  form: PrivacyRouterFormState;
  update: (patch: Partial<PrivacyRouterFormState>) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-http">Proxy HTTP port</Label>
          <Input
            id="m-privacy-router-http"
            inputMode="numeric"
            value={form.proxyHttpPort}
            onChange={(event) => update({ proxyHttpPort: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-https">Proxy HTTPS port</Label>
          <Input
            id="m-privacy-router-https"
            inputMode="numeric"
            value={form.proxyHttpsPort}
            onChange={(event) => update({ proxyHttpsPort: event.target.value })}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_PROXY_PORT_NOTE}</p>
      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div className="min-w-0">
          <Label htmlFor="m-privacy-router-quic">Block QUIC (UDP/443)</Label>
          <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_QUIC_FIELD_HELP}</p>
        </div>
        <Switch
          id="m-privacy-router-quic"
          checked={form.blockQuic}
          onCheckedChange={(blockQuic) => update({ blockQuic })}
        />
      </div>
    </>
  );
}

export function MobilePrivacyRouterSheet({
  router,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PrivacyRouterFormState>(() => seedPrivacyRouterForm(router));
  const update = (patch: Partial<PrivacyRouterFormState>) => setForm((current) => ({ ...current, ...patch }));

  const mutation = useMutation({
    mutationFn: (body: ReturnType<typeof privacyRouterBodyFrom>) =>
      apiFetch<PrivacyRouterDto>(privacyRouterUrl(router.id), {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Router settings saved. Apply the configuration to push them.");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the router: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.host.trim()) {
      toast.error("A router needs a name and an SSH address.");
      return;
    }
    // Blank saves fine — the apply is where an empty list is refused. A list
    // that did not PARSE never saves, because dropping the bad token silently
    // would narrow the router's scope without saying so.
    if (parsePrivacyClientNetworks(form.clientNetworks).invalid.length > 0) {
      toast.error(privacyClientNetworksError(form.clientNetworks) ?? "Check the client networks.");
      return;
    }
    mutation.mutate(privacyRouterBodyFrom(form));
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title="Router settings"
      description="A Linux box on the LAN that PolySIEM manages over SSH and OPNsense routes to as a gateway."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-router-name">Name</Label>
          <Input
            id="m-privacy-router-name"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Lab privacy router"
            maxLength={64}
          />
        </div>

        <PrivacyRouterReachFields form={form} update={update} />
        <PrivacyRouterProxyFields form={form} update={update} />

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div className="min-w-0">
            <Label htmlFor="m-privacy-router-enabled">PolySIEM manages this router</Label>
            <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_ROUTER_MANAGEMENT_NOTE}</p>
          </div>
          <Switch
            id="m-privacy-router-enabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>

        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
      </form>
    </BottomSheet>
  );
}
