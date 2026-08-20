"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cable, Link2, Loader2, Route, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  connectorKindLabel,
  connectorRouteWarning,
  connectorTunnelAddressFor,
  connectorsAvailableToLink,
  edgeTunnelSetupNotice,
  isConnectorSelectableFor,
  natRuleRouting,
  natRuleTargetCopy,
  ruleRouteMode,
  EDGE_NETWORKS_QUERY_KEY,
  ROUTE_MODE_CHOICES,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
  type EdgeRouteMode,
  type NatProtocol,
  type NatRuleInput,
} from "@/components/network/edge-networks-types";
import { isValidNetworkPort } from "@/components/network/edge-network-utils";
import { useAllConnectorsQuery, useLinkConnectorMutation } from "./mobile-connector-links";
import { useConnectorsQuery } from "./mobile-connectors";
import { MobileOptionCard } from "./mobile-form-controls";

/**
 * Edit state for one NAT rule. Seeded and validated by the pure helpers below
 * so the sheet itself only wires state to fields — the same shape the tunnel
 * form uses (`seedWireguardForm`). If the desktop layer ever exports a shared
 * seed for this form, drop these two helpers and import that instead.
 */
interface NatRuleFormState {
  name: string;
  protocol: NatProtocol;
  publicPort: string;
  targetAddress: string;
  targetPort: string;
  sourceCidr: string;
  enabled: boolean;
  mode: EdgeRouteMode;
  connectorId: string;
}

function seedNatRuleForm(rule: EdgeNatRule | null): NatRuleFormState {
  if (!rule) {
    return {
      name: "",
      protocol: "tcp",
      publicPort: "",
      targetAddress: "",
      targetPort: "",
      sourceCidr: "",
      enabled: true,
      mode: "direct",
      connectorId: "",
    };
  }
  return {
    name: rule.name,
    protocol: rule.protocol,
    publicPort: String(rule.publicPort),
    targetAddress: rule.targetAddress,
    targetPort: String(rule.targetPort),
    sourceCidr: rule.sourceCidr ?? "",
    enabled: rule.enabled,
    mode: ruleRouteMode(rule),
    connectorId: rule.connectorId ?? "",
  };
}

/** The one message to toast when the form cannot be submitted, or null. */
function natRuleFormError(form: NatRuleFormState): string | null {
  const portsValid = isValidNetworkPort(Number(form.publicPort)) && isValidNetworkPort(Number(form.targetPort));
  if (!form.name.trim() || !form.targetAddress.trim() || !portsValid) {
    return "Enter a name, private target, and valid ports from 1–65535.";
  }
  if (form.mode === "connector" && !form.connectorId) {
    return "Pick the connector that reaches this target.";
  }
  return null;
}

function natRuleInputFrom(form: NatRuleFormState): NatRuleInput {
  return {
    name: form.name.trim(),
    protocol: form.protocol,
    publicPort: Number(form.publicPort),
    targetAddress: form.targetAddress.trim(),
    targetPort: Number(form.targetPort),
    sourceCidr: form.sourceCidr.trim() || undefined,
    enabled: form.enabled,
    ...natRuleRouting(form.mode, form.connectorId || null),
  };
}

/** Direct or via-connector — the choice that changes what "target" means. */
function NatRuleRouteModePicker({
  mode,
  onChange,
  connectorsAvailable,
  connectorsLoading,
}: {
  mode: EdgeRouteMode;
  onChange: (mode: EdgeRouteMode) => void;
  connectorsAvailable: boolean;
  connectorsLoading: boolean;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>How traffic reaches the target</Label>
      <div className="grid gap-2">
        {ROUTE_MODE_CHOICES.map((choice) => (
          <MobileOptionCard
            key={choice.value}
            icon={choice.value === "connector" ? <Cable className="size-4" /> : <Route className="size-4" />}
            title={choice.title}
            detail={choice.detail}
            selected={mode === choice.value}
            onSelect={() => onChange(choice.value)}
            disabled={choice.value === "connector" && !connectorsAvailable}
            disabledHint={
              connectorsLoading
                ? "Loading connectors…"
                : "Link a connector to this edge first — an existing one will do; a connector can serve several edges."
            }
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Which connector carries the route, plus the manual-peer warning: PolySIEM
 * cannot program a hand-configured far end, so the operator has to.
 */
function NatRuleConnectorField({
  server,
  connectors,
  connectorId,
  onChange,
  publicPort,
}: {
  server: EdgeNatServer;
  connectors: readonly ConnectorDto[];
  connectorId: string;
  onChange: (id: string) => void;
  publicPort: string;
}) {
  const selected = connectors.find((connector) => connector.id === connectorId) ?? null;
  // Non-null only for manual kinds: PolySIEM cannot program the far side there.
  const warning = selected ? connectorRouteWarning(selected, { publicPort: publicPort || null }) : null;
  const address = selected ? connectorTunnelAddressFor(selected, server.id) : null;
  return (
    <div className="grid gap-1.5">
      <Label>Connector</Label>
      <Select value={connectorId} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Choose a connector" />
        </SelectTrigger>
        <SelectContent>
          {connectors.map((connector) => (
            <SelectItem key={connector.id} value={connector.id}>
              {connector.name} · {connectorKindLabel(connector)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Only connectors linked to {server.name} are listed. The edge hands the port to
        {address ? ` ${address}, this connector's address on this edge.` : " the connector's address on this edge."}{" "}
        The port is preserved across the tunnel.
      </p>
      {warning && (
        <div className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">
            <span className="block font-medium">{warning.title}</span>
            <span className="mt-0.5 block leading-snug">{warning.detail}</span>
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * Nothing is linked to this edge yet, so the rule cannot be routed over a
 * connector. Rather than dead-ending, link one right here — a connector already
 * installed for another edge serves this one the moment it is linked. Kept
 * inline instead of a sub-sheet: a second bottom sheet over this form would
 * fight it for the scroll lock.
 */
function NatRuleLinkConnectorField({ server }: { server: EdgeNatServer }) {
  const [choice, setChoice] = useState("");
  const allConnectors = useAllConnectorsQuery();
  const linkable = connectorsAvailableToLink(allConnectors.data ?? [], server.id);
  const mutation = useLinkConnectorMutation(() => setChoice(""));
  // Linking is also what brings this edge's tunnel up, when it has none yet.
  const tunnelPending = edgeTunnelSetupNotice(server);

  if (allConnectors.isLoading) return null;
  return (
    <div className="grid gap-1.5 rounded-xl border border-info/30 bg-info/5 p-3">
      <Label>No connector is linked to {server.name}</Label>
      {linkable.length === 0 ? (
        <p className="text-xs text-info">
          Add a connector from the Connectors section of Edge networks, then come back — a connector is installed once
          and can serve any edge box you link it to.
        </p>
      ) : (
        <>
          <p className="text-xs text-info">
            One of your existing connectors can serve this edge too. Link it and it appears in the picker.
          </p>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a connector to link" />
            </SelectTrigger>
            <SelectContent>
              {linkable.map((connector) => (
                <SelectItem key={connector.id} value={connector.id}>
                  {connector.name} · {connectorKindLabel(connector)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!choice || mutation.isPending}
            onClick={() => mutation.mutate({ connectorId: choice, integrationId: server.id })}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Link2 />} Link to this edge
          </Button>
          {tunnelPending && <p className="text-[11px] leading-snug text-info/80">{tunnelPending}</p>}
        </>
      )}
    </div>
  );
}

/** Listener (protocol + edge port) and target (address + port), with per-mode copy. */
function NatRuleEndpointFields({
  form,
  update,
}: {
  form: NatRuleFormState;
  update: (patch: Partial<NatRuleFormState>) => void;
}) {
  const targetCopy = natRuleTargetCopy(form.mode);
  return (
    <>
      <div className="grid grid-cols-[0.7fr_1fr] gap-3">
        <div className="grid gap-1.5">
          <Label>Protocol</Label>
          <Select value={form.protocol} onValueChange={(value) => update({ protocol: value as NatProtocol })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-public">Edge port</Label>
          <Input
            id="m-nat-public"
            inputMode="numeric"
            value={form.publicPort}
            onChange={(event) => update({ publicPort: event.target.value })}
            placeholder="443"
          />
        </div>
      </div>
      <div className="grid grid-cols-[1fr_0.55fr] gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-target">{targetCopy.label}</Label>
          <Input
            id="m-nat-target"
            value={form.targetAddress}
            onChange={(event) => update({ targetAddress: event.target.value })}
            placeholder={targetCopy.placeholder}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-target-port">Port</Label>
          <Input
            id="m-nat-target-port"
            inputMode="numeric"
            value={form.targetPort}
            onChange={(event) => update({ targetPort: event.target.value })}
            placeholder="32400"
          />
        </div>
      </div>
      {targetCopy.help && <p className="-mt-2 text-xs text-muted-foreground">{targetCopy.help}</p>}
    </>
  );
}

/** Source CIDR, with the standing warning that blank means the whole internet. */
function NatRuleSourceField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="m-nat-cidr">
        Allowed source CIDR <span className="font-normal text-muted-foreground">(recommended)</span>
      </Label>
      <Input
        id="m-nat-cidr"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="203.0.113.0/24"
      />
      <p className={cn("text-xs", value ? "text-muted-foreground" : "text-warning")}>
        {value ? "Only this source range can enter the rule." : "Blank allows traffic from any internet address."}
      </p>
    </div>
  );
}

/** Add/edit NAT rule form in a bottom sheet, posting to the same endpoints as desktop. */
export function MobileNatRuleSheet({
  server,
  rule,
  onOpenChange,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NatRuleFormState>(() => seedNatRuleForm(rule));
  const update = (patch: Partial<NatRuleFormState>) => setForm((current) => ({ ...current, ...patch }));

  const connectorsQuery = useConnectorsQuery(server.id, { enabled: server.enabled });
  // The shared predicate is kind- AND link-aware: an agent connector proves
  // itself by enrolling and a manual peer by having its key registered, and
  // either way it must hold a live link to THIS edge to carry its traffic.
  const usable = (connectorsQuery.data ?? []).filter((connector) => isConnectorSelectableFor(connector, server.id));

  const mutation = useMutation({
    mutationFn: (input: NatRuleInput) =>
      apiFetch(
        rule
          ? `/api/network/edge-networks/servers/${server.id}/rules/${rule.id}`
          : `/api/network/edge-networks/servers/${server.id}/rules`,
        { method: rule ? "PATCH" : "POST", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      toast.success(`${rule ? "Updated" : "Added"} NAT rule. Apply changes when ready.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = natRuleFormError(form);
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(natRuleInputFrom(form));
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${rule ? "Edit" : "Add"} NAT rule`}
      description={`Publish one listener on ${server.name}, straight from the edge or over a connector.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-name">Rule name</Label>
          <Input
            id="m-nat-name"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Plex HTTPS"
          />
        </div>

        <NatRuleRouteModePicker
          mode={form.mode}
          onChange={(mode) => update({ mode })}
          connectorsAvailable={usable.length > 0}
          connectorsLoading={connectorsQuery.isLoading}
        />

        {form.mode === "connector" && usable.length > 0 && (
          <NatRuleConnectorField
            server={server}
            connectors={usable}
            connectorId={form.connectorId}
            onChange={(connectorId) => update({ connectorId })}
            publicPort={form.publicPort}
          />
        )}
        {usable.length === 0 && !connectorsQuery.isLoading && <NatRuleLinkConnectorField server={server} />}

        <NatRuleEndpointFields form={form} update={update} />
        <NatRuleSourceField value={form.sourceCidr} onChange={(sourceCidr) => update({ sourceCidr })} />

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-nat-enabled">Rule enabled</Label>
            <p className="text-xs text-muted-foreground">Disabled rules remain saved but are not installed.</p>
          </div>
          <Switch
            id="m-nat-enabled"
            checked={form.enabled}
            onCheckedChange={(enabled) => update({ enabled })}
          />
        </div>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </form>
    </BottomSheet>
  );
}
