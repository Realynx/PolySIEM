"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
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
import { Switch } from "@/components/ui/switch";
import { PrivacyClientNetworksField } from "./privacy-router-confirm-topology";
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
} from "./privacy-router-presentation";
import {
  privacyRouterUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type PrivacyRouterDto,
} from "./privacy-router-types";

/**
 * The box-level settings that are neither rules nor exits: where PolySIEM
 * reaches this router, the topology it serves, the proxy's ports and the QUIC
 * block.
 *
 * This dialog no longer creates routers. Adding one is a four-step flow
 * (`privacy-router-add-dialog.tsx`) that asks for three things and detects the
 * rest, because a creation form holding eleven fields is unanswerable by
 * somebody who has not yet been told what a privacy router IS. What is left
 * here is what an operator comes back to CHANGE — and nothing was dropped on
 * the way: the proxy ports and the QUIC switch moved here from the add form
 * carrying the same explanations they always had.
 *
 * The DEFAULT ACTION is deliberately not here either. It is the last line of
 * the firewall, so it is edited at the foot of the Rules tab, where its meaning
 * is obvious from its position.
 *
 * Plain `useState` form objects of strings, coerced at submit. `react-hook-form`
 * is used in exactly one unrelated file in this repo and is not introduced here.
 */

interface PrivacyRouterForm {
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

function routerToForm(router: PrivacyRouterDto): PrivacyRouterForm {
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
 * The PATCH body. The three topology fields go out as null when they are blank
 * rather than as `""` or a guessed `eth0`: "not confirmed yet" is a state this
 * router is allowed to be in, and `apply` refuses while it is.
 *
 * The client list goes out EMPTY when it is blank, for the same reason and with
 * the same consequence — never silently backfilled from `lanCidr` here. Clearing
 * this field is a deliberate act, and the apply is where it is refused, with a
 * message that explains why empty is not "everyone".
 */
function toUpdateBody(form: PrivacyRouterForm) {
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

export function PrivacyRouterDialog({
  router,
  open,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => routerToForm(router), [router]);
  const [form, setForm] = useState<PrivacyRouterForm>(initial);
  const mutation = useMutation({
    mutationFn: (body: ReturnType<typeof toUpdateBody>) => apiFetch<PrivacyRouterDto>(
      privacyRouterUrl(router.id),
      { method: "PATCH", body: JSON.stringify(body) },
    ),
    onSuccess: () => {
      toast.success("Router settings saved. Apply the configuration to push them.");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the router: ${error.message}`),
  });

  const update = (patch: Partial<PrivacyRouterForm>) => setForm({ ...form, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim() || !form.host.trim()) {
      toast.error("A router needs a name and an SSH address.");
      return;
    }
    // A BLANK client list is allowed to be saved — clearing it is a deliberate
    // act and the apply is where it is refused, with the explanation. What is
    // never saved is a list that did not parse, because silently dropping the
    // token that failed would leave a router serving fewer networks than the
    // operator just read back off the screen.
    if (parsePrivacyClientNetworks(form.clientNetworks).invalid.length > 0) {
      toast.error(privacyClientNetworksError(form.clientNetworks) ?? "Check the client networks.");
      return;
    }
    mutation.mutate(toUpdateBody(form));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Router settings</DialogTitle>
            <DialogDescription>
              A Linux box on the LAN that PolySIEM manages over SSH and OPNsense routes to as a gateway.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-router-name">Name</Label>
              <Input id="privacy-router-name" value={form.name} onChange={(event) => update({ name: event.target.value })} placeholder="Lab privacy router" maxLength={64} />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_0.4fr]">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-host">SSH address</Label>
                <Input id="privacy-router-host" value={form.host} onChange={(event) => update({ host: event.target.value })} placeholder="10.0.3.70" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-port">Port</Label>
                <Input id="privacy-router-port" inputMode="numeric" value={form.port} onChange={(event) => update({ port: event.target.value })} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{PRIVACY_ROUTER_ENDPOINT_CHANGE_NOTE}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-lan">Router&apos;s own network</Label>
                <Input id="privacy-router-lan" value={form.lanCidr} onChange={(event) => update({ lanCidr: event.target.value })} placeholder="10.0.3.0/24" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-username">Service account</Label>
                <Input id="privacy-router-username" value={form.username} onChange={(event) => update({ username: event.target.value })} />
              </div>
            </div>

            <PrivacyClientNetworksField
              value={form.clientNetworks}
              lanCidr={form.lanCidr || null}
              onChange={(clientNetworks) => update({ clientNetworks })}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-lanif">LAN interface</Label>
                <Input id="privacy-router-lanif" value={form.lanInterface} onChange={(event) => update({ lanInterface: event.target.value })} placeholder="eth0" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-wanif">WAN interface</Label>
                <Input id="privacy-router-wanif" value={form.wanInterface} onChange={(event) => update({ wanInterface: event.target.value })} placeholder="eth0" />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{PRIVACY_ROUTER_ONE_ARMED_NOTE}</p>
            <p className="-mt-2 text-xs text-muted-foreground">{PRIVACY_ROUTER_TOPOLOGY_UNCONFIRMED_NOTE}</p>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-http">Proxy HTTP port</Label>
                <Input id="privacy-router-http" inputMode="numeric" value={form.proxyHttpPort} onChange={(event) => update({ proxyHttpPort: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-router-https">Proxy HTTPS port</Label>
                <Input id="privacy-router-https" inputMode="numeric" value={form.proxyHttpsPort} onChange={(event) => update({ proxyHttpsPort: event.target.value })} />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{PRIVACY_ROUTER_PROXY_PORT_NOTE}</p>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="privacy-router-quic">Block QUIC (UDP/443)</Label>
                <p className="text-xs text-muted-foreground">{PRIVACY_QUIC_FIELD_HELP}</p>
              </div>
              <Switch id="privacy-router-quic" checked={form.blockQuic} onCheckedChange={(blockQuic) => update({ blockQuic })} />
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="min-w-0">
                <Label htmlFor="privacy-router-enabled">PolySIEM manages this router</Label>
                <p className="text-xs text-muted-foreground">{PRIVACY_ROUTER_MANAGEMENT_NOTE}</p>
              </div>
              <Switch id="privacy-router-enabled" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}Save settings
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
