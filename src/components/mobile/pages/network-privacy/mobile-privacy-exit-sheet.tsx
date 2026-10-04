"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  vpnExitFormError,
  vpnExitKeyFromName,
  vpnExitKeyHelp,
  VPN_EXIT_ADVANCED_LABEL,
  VPN_EXIT_DISABLED_NOTE,
  VPN_EXIT_KEY_LABEL,
  VPN_EXIT_KEY_MAX_LENGTH,
  VPN_EXIT_MTU_NOTE,
  VPN_EXIT_NO_KEY_NOTE,
  VPN_EXIT_PRIVATE_KEY_NOTE,
} from "@/components/network/privacy-router-presentation";
import {
  vpnExitsUrl,
  vpnExitUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDto,
  type VpnExitInputBody,
  type PrivacyRouterDto,
} from "@/components/network/privacy-router-types";

/**
 * Add or edit one WireGuard exit, in a bottom sheet, against the same endpoints
 * the desktop dialog posts to.
 *
 * The private key is write-only in both directions: no response carries it, so
 * the field is never seeded, and leaving it blank on an edit keeps the stored
 * one rather than clearing it.
 *
 * The sheet asks for a NAME, not a "Key" beside it. Two adjacent fields called
 * key — one of them secret material — is a hazard rather than a labelling
 * problem, so PolySIEM derives the slug from the name and leaves it editable
 * under Advanced, at the far end of the form, as the "interface suffix" it is.
 * `keyTouched` records that the operator took it over, so a later edit to the
 * name does not silently rename the tunnel's interface under them.
 */

interface VpnExitFormState {
  key: string;
  keyTouched: boolean;
  name: string;
  addressCidr: string;
  endpoint: string;
  peerPublicKey: string;
  privateKey: string;
  keepalive: string;
  mtu: string;
  enabled: boolean;
}

function seedVpnExitForm(exit: VpnExitDto | null): VpnExitFormState {
  if (!exit) {
    return {
      key: "",
      keyTouched: false,
      name: "",
      addressCidr: "",
      endpoint: "",
      peerPublicKey: "",
      privateKey: "",
      keepalive: "25",
      mtu: "1420",
      enabled: true,
    };
  }
  return {
    key: exit.key,
    keyTouched: true,
    name: exit.name,
    addressCidr: exit.addressCidr,
    endpoint: exit.endpoint,
    peerPublicKey: exit.peerPublicKey,
    // Never seeded: the private key is write-only and no response carries it.
    privateKey: "",
    keepalive: String(exit.keepalive),
    mtu: String(exit.mtu),
    enabled: exit.enabled,
  };
}

function vpnExitBodyFrom(form: VpnExitFormState): VpnExitInputBody {
  const privateKey = form.privateKey.trim();
  return {
    key: form.key.trim().toLowerCase(),
    name: form.name.trim(),
    addressCidr: form.addressCidr.trim(),
    endpoint: form.endpoint.trim(),
    peerPublicKey: form.peerPublicKey.trim(),
    ...(privateKey ? { privateKey } : {}),
    keepalive: Number(form.keepalive) || 0,
    mtu: Number(form.mtu) || 1420,
    enabled: form.enabled,
  };
}

/** Every value on this form comes off the provider's config file, verbatim. */
function VpnExitTunnelFields({
  form,
  update,
}: {
  form: VpnExitFormState;
  update: (patch: Partial<VpnExitFormState>) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-exit-address">Interface address</Label>
        <Input
          id="m-privacy-exit-address"
          value={form.addressCidr}
          onChange={(event) => update({ addressCidr: event.target.value })}
          placeholder="10.2.0.2/32"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-exit-endpoint">Endpoint</Label>
        <Input
          id="m-privacy-exit-endpoint"
          value={form.endpoint}
          onChange={(event) => update({ endpoint: event.target.value })}
          placeholder="nl-1.example.net:51820"
          autoCapitalize="none"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-exit-peer">Peer public key</Label>
        <Input
          id="m-privacy-exit-peer"
          value={form.peerPublicKey}
          onChange={(event) => update({ peerPublicKey: event.target.value })}
          placeholder="44-character base64 key"
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          className="font-mono"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-exit-keepalive">Keepalive (s)</Label>
          <Input
            id="m-privacy-exit-keepalive"
            inputMode="numeric"
            value={form.keepalive}
            onChange={(event) => update({ keepalive: event.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-exit-mtu">MTU</Label>
          <Input
            id="m-privacy-exit-mtu"
            inputMode="numeric"
            value={form.mtu}
            onChange={(event) => update({ mtu: event.target.value })}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs leading-snug text-muted-foreground">{VPN_EXIT_MTU_NOTE}</p>
    </>
  );
}

function VpnExitPrivateKeyField({
  exit,
  value,
  onChange,
}: {
  exit: VpnExitDto | null;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="m-privacy-exit-private">
        Private key{" "}
        {exit && <span className="font-normal text-muted-foreground">(blank keeps the stored one)</span>}
      </Label>
      <Input
        id="m-privacy-exit-private"
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="44-character base64 key"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
      />
      <p className="text-xs leading-snug text-muted-foreground">
        {VPN_EXIT_PRIVATE_KEY_NOTE}
        {exit?.hasPrivateKey === false && VPN_EXIT_NO_KEY_NOTE}
      </p>
    </div>
  );
}

export function MobilePrivacyExitSheet({
  router,
  exits,
  exit,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  /** The router's existing exits, so a derived suffix cannot collide with one. */
  exits: readonly VpnExitDto[];
  /** Null adds an exit; a value edits that one. */
  exit: VpnExitDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VpnExitFormState>(() => seedVpnExitForm(exit));
  const update = (patch: Partial<VpnExitFormState>) => setForm((current) => ({ ...current, ...patch }));
  const takenKeys = useMemo(
    () => exits.filter((one) => one.id !== exit?.id).map((one) => one.key),
    [exits, exit],
  );
  /** Typing a name re-derives the suffix, unless the operator has taken it over. */
  const updateName = (name: string) =>
    setForm((current) => ({
      ...current,
      name,
      ...(current.keyTouched ? {} : { key: vpnExitKeyFromName(name, takenKeys) }),
    }));

  const mutation = useMutation({
    mutationFn: (body: VpnExitInputBody) =>
      apiFetch(exit ? vpnExitUrl(router.id, exit.id) : vpnExitsUrl(router.id), {
        method: exit ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success(`${exit ? "Updated" : "Added"} the exit. Apply the configuration to bring it up.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the exit: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = vpnExitFormError(form, exit === null);
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(vpnExitBodyFrom(form));
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${exit ? "Edit" : "Add"} exit`}
      description={`One WireGuard tunnel on ${router.name}. Every value comes from the provider's config file.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-exit-name">Name</Label>
          <Input
            id="m-privacy-exit-name"
            value={form.name}
            onChange={(event) => updateName(event.target.value)}
            placeholder="Netherlands 1"
            maxLength={64}
          />
          <p className="text-xs leading-snug text-muted-foreground">{vpnExitKeyHelp(form.key)}</p>
        </div>

        <VpnExitTunnelFields form={form} update={update} />
        <VpnExitPrivateKeyField exit={exit} value={form.privateKey} onChange={(privateKey) => update({ privateKey })} />

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div className="min-w-0">
            <Label htmlFor="m-privacy-exit-enabled">Exit enabled</Label>
            <p className="text-xs text-muted-foreground">{VPN_EXIT_DISABLED_NOTE}</p>
          </div>
          <Switch id="m-privacy-exit-enabled" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </div>

        <MobileVpnExitAdvanced
          value={form.key}
          onChange={(key) => update({ key: key.toLowerCase(), keyTouched: true })}
        />

        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {exit ? "Save exit" : "Add exit"}
        </Button>
      </form>
    </BottomSheet>
  );
}

/**
 * The derived interface suffix, editable but out of the way.
 *
 * Collapsed, last on the sheet, and as far from the private-key field as the
 * layout allows — the point of moving it was that two adjacent fields called
 * "key" invited one to be filled with the other.
 */
function MobileVpnExitAdvanced({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-h-12 w-full items-center justify-between px-3 py-2.5 text-left">
          <span className="text-[13px] font-medium">{VPN_EXIT_ADVANCED_LABEL}</span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <span className="font-mono">{value || "—"}</span>
            <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1.5 border-t px-3 py-3">
          <Label htmlFor="m-privacy-exit-key">{VPN_EXIT_KEY_LABEL}</Label>
          <Input
            id="m-privacy-exit-key"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="nl1"
            maxLength={VPN_EXIT_KEY_MAX_LENGTH}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs leading-snug text-muted-foreground">{vpnExitKeyHelp(value)}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
