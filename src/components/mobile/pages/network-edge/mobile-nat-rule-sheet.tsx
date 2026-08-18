"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cable, Loader2, Route } from "lucide-react";
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
  isConnectorSelectable,
  natRuleRouting,
  natRuleTargetCopy,
  ruleRouteMode,
  ROUTE_MODE_CHOICES,
  type EdgeNatRule,
  type EdgeNatServer,
  type EdgeRouteMode,
  type NatProtocol,
  type NatRuleInput,
} from "@/components/network/edge-networks-types";
import { isValidNetworkPort } from "@/components/network/edge-network-utils";
import { useConnectorsQuery } from "./mobile-connectors";

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
  const [name, setName] = useState(rule?.name ?? "");
  const [protocol, setProtocol] = useState<NatProtocol>(rule?.protocol ?? "tcp");
  const [publicPort, setPublicPort] = useState(rule ? String(rule.publicPort) : "");
  const [targetAddress, setTargetAddress] = useState(rule?.targetAddress ?? "");
  const [targetPort, setTargetPort] = useState(rule ? String(rule.targetPort) : "");
  const [sourceCidr, setSourceCidr] = useState(rule?.sourceCidr ?? "");
  const [enabled, setEnabled] = useState(rule?.enabled ?? true);
  const [mode, setMode] = useState<EdgeRouteMode>(rule ? ruleRouteMode(rule) : "direct");
  const [connectorId, setConnectorId] = useState(rule?.connectorId ?? "");

  const connectorsQuery = useConnectorsQuery(server.id, { enabled: server.enabled });
  const usable = (connectorsQuery.data ?? []).filter(isConnectorSelectable);
  const viaConnector = mode === "connector";
  const targetCopy = natRuleTargetCopy(mode);

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
      void queryClient.invalidateQueries({ queryKey: ["edge-networks"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const publicPortNum = Number(publicPort);
    const targetPortNum = Number(targetPort);
    if (!name.trim() || !targetAddress.trim() || !isValidNetworkPort(publicPortNum) || !isValidNetworkPort(targetPortNum)) {
      toast.error("Enter a name, private target, and valid ports from 1–65535.");
      return;
    }
    if (viaConnector && !connectorId) {
      toast.error("Pick the connector that reaches this target.");
      return;
    }
    mutation.mutate({
      name: name.trim(),
      protocol,
      publicPort: publicPortNum,
      targetAddress: targetAddress.trim(),
      targetPort: targetPortNum,
      sourceCidr: sourceCidr.trim() || undefined,
      enabled,
      ...natRuleRouting(mode, connectorId || null),
    });
  };

  const sheet = () => (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${rule ? "Edit" : "Add"} NAT rule`}
      description={`Publish one listener on ${server.name}, straight from the edge or over a connector.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-name">Rule name</Label>
          <Input id="m-nat-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Plex HTTPS" />
        </div>

        <div className="grid gap-1.5">
          <Label>How traffic reaches the target</Label>
          <div className="grid gap-2">
            {ROUTE_MODE_CHOICES.map((choice) => (
              <RouteModeOption
                key={choice.value}
                icon={choice.value === "connector" ? <Cable className="size-4" /> : <Route className="size-4" />}
                title={choice.title}
                detail={choice.detail}
                selected={mode === choice.value}
                onSelect={() => setMode(choice.value)}
                disabled={choice.value === "connector" && usable.length === 0}
                disabledHint={
                  connectorsQuery.isLoading
                    ? "Loading connectors…"
                    : "Install and enroll a connector on this server first."
                }
              />
            ))}
          </div>
        </div>

        {viaConnector && (
          <div className="grid gap-1.5">
            <Label>Connector</Label>
            <Select value={connectorId} onValueChange={setConnectorId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a connector" />
              </SelectTrigger>
              <SelectContent>
                {usable.map((connector) => (
                  <SelectItem key={connector.id} value={connector.id}>
                    {connector.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Only enrolled connectors can carry a route. The edge port is preserved across the tunnel.
            </p>
          </div>
        )}

        <div className="grid grid-cols-[0.7fr_1fr] gap-3">
          <div className="grid gap-1.5">
            <Label>Protocol</Label>
            <Select value={protocol} onValueChange={(value) => setProtocol(value as NatProtocol)}>
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
              value={publicPort}
              onChange={(event) => setPublicPort(event.target.value)}
              placeholder="443"
            />
          </div>
        </div>
        <div className="grid grid-cols-[1fr_0.55fr] gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="m-nat-target">{targetCopy.label}</Label>
            <Input
              id="m-nat-target"
              value={targetAddress}
              onChange={(event) => setTargetAddress(event.target.value)}
              placeholder={targetCopy.placeholder}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="m-nat-target-port">Port</Label>
            <Input
              id="m-nat-target-port"
              inputMode="numeric"
              value={targetPort}
              onChange={(event) => setTargetPort(event.target.value)}
              placeholder="32400"
            />
          </div>
        </div>
        {targetCopy.help && <p className="-mt-2 text-xs text-muted-foreground">{targetCopy.help}</p>}
        <div className="grid gap-1.5">
          <Label htmlFor="m-nat-cidr">
            Allowed source CIDR <span className="font-normal text-muted-foreground">(recommended)</span>
          </Label>
          <Input
            id="m-nat-cidr"
            value={sourceCidr}
            onChange={(event) => setSourceCidr(event.target.value)}
            placeholder="203.0.113.0/24"
          />
          <p className={cn("text-xs", sourceCidr ? "text-muted-foreground" : "text-warning")}>
            {sourceCidr ? "Only this source range can enter the rule." : "Blank allows traffic from any internet address."}
          </p>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div>
            <Label htmlFor="m-nat-enabled">Rule enabled</Label>
            <p className="text-xs text-muted-foreground">Disabled rules remain saved but are not installed.</p>
          </div>
          <Switch id="m-nat-enabled" checked={enabled} onCheckedChange={setEnabled} />
        </div>
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </form>
    </BottomSheet>
  );
  return sheet();
}

/** Big tappable route-mode card — a phone-sized radio with room to explain itself. */
function RouteModeOption({
  icon,
  title,
  detail,
  selected,
  onSelect,
  disabled = false,
  disabledHint,
}: {
  icon: ReactNode;
  title: string;
  detail: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-13 w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-card active:bg-muted/70",
        disabled && "opacity-50",
      )}
    >
      <span className={cn("mt-0.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {disabled && disabledHint ? disabledHint : detail}
        </span>
      </span>
    </button>
  );
}
