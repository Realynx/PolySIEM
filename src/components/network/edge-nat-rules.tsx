"use client";

import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, Link2, Loader2, Pencil, PlugZap, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  connectorKindLabel,
  connectorRouteWarning,
  connectorTunnelAddressFor,
  connectorUnavailableReason,
  EDGE_NETWORKS_QUERY_KEY,
  isConnectorSelectableFor,
  natRuleRouting,
  natRuleTargetCopy,
  ROUTE_MODE_CHOICES,
  ruleRouteMode,
  type ConnectorDto,
  type EdgeNatRule,
  type EdgeNatServer,
  type EdgeRouteMode,
  type NatProtocol,
  type NatRuleInput,
} from "./edge-networks-types";
import {
  edgeRoutePath,
  edgeRouteRisk,
  edgeRouteRowBadge,
  edgeRouteRowState,
  edgeRoutesBaselineState,
  isUnrestrictedSource,
  sensitivePortService,
  type EdgeRoutePath,
  type EdgeRouteRowState,
} from "./edge-sync-presentation";
import { isValidNetworkPort } from "./edge-network-utils";

/**
 * The Routes tab of an edge server card: which listeners the edge publishes and
 * where each one lands. Nothing is exposed until a rule exists AND is applied,
 * so the empty state says so rather than looking like a blank list.
 */
export function EdgeNatRulesTab({
  server,
  connectors,
  isAdmin,
  onAdd,
  onEdit,
  onDelete,
}: {
  server: EdgeNatServer;
  connectors: ConnectorDto[];
  isAdmin: boolean;
  onAdd: () => void;
  onEdit: (rule: EdgeNatRule) => void;
  onDelete: (rule: EdgeNatRule) => void;
}) {
  const canEdit = isAdmin && server.enabled;
  if (server.rules.length === 0) return <NatRulesEmptyState canEdit={canEdit} onAdd={onAdd} />;
  return <NatRulesTable server={server} connectors={connectors} canEdit={canEdit} onEdit={onEdit} onDelete={onDelete} />;
}

function NatRulesEmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">No ports are published</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This server exposes no lab targets until an explicit rule is added and applied.
      </p>
      {canEdit && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
          <Plus /> Add first rule
        </Button>
      )}
    </div>
  );
}

function NatRulesTable({
  server,
  connectors,
  canEdit,
  onEdit,
  onDelete,
}: {
  server: EdgeNatServer;
  connectors: ConnectorDto[];
  canEdit: boolean;
  onEdit: (rule: EdgeNatRule) => void;
  onDelete: (rule: EdgeNatRule) => void;
}) {
  const lastAppliedAt = server.settings?.lastAppliedAt;
  // The state the card header already reports. A row only earns a badge when it
  // differs from this, so a column of identical values can never appear.
  const baseline = edgeRoutesBaselineState(server.rules, lastAppliedAt);
  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[11rem]">Published</TableHead>
            <TableHead className="w-[20rem]">How it gets there</TableHead>
            <TableHead>Lands on</TableHead>
            <TableHead className="w-[16rem]">Allowed source</TableHead>
            {canEdit && <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {server.rules.map((rule) => (
            <NatRuleRow
              key={rule.id}
              rule={rule}
              state={edgeRouteRowState(rule, lastAppliedAt)}
              baseline={baseline}
              path={edgeRoutePath(rule, connectors, server.id)}
              canEdit={canEdit}
              onEdit={() => onEdit(rule)}
              onDelete={() => onDelete(rule)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** One route, read left to right: what is published → how it gets there → where it lands. */
function NatRuleRow({
  rule,
  state,
  baseline,
  path,
  canEdit,
  onEdit,
  onDelete,
}: {
  rule: EdgeNatRule;
  state: EdgeRouteRowState;
  baseline: EdgeRouteRowState;
  path: EdgeRoutePath;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const badge = edgeRouteRowBadge(state, baseline);
  return (
    <TableRow className={cn(state === "disabled" && "text-muted-foreground")}>
      <TableCell className="align-top">
        <div className="font-mono text-sm font-medium tabular-nums">
          :{rule.publicPort}
          <span className="ml-1.5 font-sans text-[0.6875rem] font-normal uppercase text-muted-foreground">{rule.protocol}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">{rule.name}</span>
          {badge && <Badge variant={badge.variant} className="font-normal">{badge.label}</Badge>}
        </div>
      </TableCell>
      <TableCell className="align-top"><NatRulePathCell path={path} /></TableCell>
      <TableCell className="align-top font-mono text-xs">{rule.targetAddress}:{rule.targetPort}</TableCell>
      <TableCell className="align-top"><NatRuleSourceCell rule={rule} /></TableCell>
      {canEdit && (
        <TableCell className="align-top">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${rule.name}`} onClick={onEdit}><Pencil /></Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={`Delete ${rule.name}`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * The middle column. A connector hop is ordinary configuration, so it is styled
 * as information — the address is the one this connector holds ON THIS EDGE, and
 * the same connector holds a different one on every other edge box it serves.
 */
function NatRulePathCell({ path }: { path: EdgeRoutePath }) {
  if (path.kind === "direct") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
        {path.label}
      </span>
    );
  }
  return (
    <div className="min-w-0" title={path.noteDetail ?? undefined}>
      <span className="flex items-center gap-1.5 text-xs">
        <PlugZap className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{path.label}</span>
      </span>
      {(path.address || path.note) && (
        <p className="mt-0.5 truncate text-[0.6875rem] text-muted-foreground">
          {path.address && <span className="font-mono">{path.address}</span>}
          {path.address && path.note ? " · " : ""}
          {path.note}
        </p>
      )}
    </div>
  );
}

/**
 * An open source range is the common case and is styled as such. Amber is spent
 * only where it buys something: an admin port nothing is limiting, named.
 */
function NatRuleSourceCell({ rule }: { rule: EdgeNatRule }) {
  const risk = edgeRouteRisk(rule);
  return (
    <div className="min-w-0">
      {isUnrestrictedSource(rule)
        ? <span className="text-xs text-muted-foreground">Any source</span>
        : <span className="font-mono text-xs">{rule.sourceCidr}</span>}
      {risk && (
        <p className="mt-0.5 flex items-start gap-1 text-[0.6875rem] text-warning" title={risk.detail}>
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{risk.label}</span>
        </p>
      )}
    </div>
  );
}

interface NatRuleForm {
  ruleId: string | null;
  name: string;
  protocol: NatProtocol;
  publicPort: string;
  targetAddress: string;
  targetPort: string;
  sourceCidr: string;
  enabled: boolean;
  mode: EdgeRouteMode;
  connectorId: string | null;
}

const EMPTY_NAT_RULE_FORM: NatRuleForm = {
  ruleId: null,
  name: "",
  protocol: "tcp",
  publicPort: "",
  targetAddress: "",
  targetPort: "",
  sourceCidr: "",
  enabled: true,
  mode: "direct",
  connectorId: null,
};

function ruleToForm(rule: EdgeNatRule | null): NatRuleForm {
  if (!rule) return EMPTY_NAT_RULE_FORM;
  return {
    ruleId: rule.id,
    name: rule.name,
    protocol: rule.protocol,
    publicPort: String(rule.publicPort),
    targetAddress: rule.targetAddress,
    targetPort: String(rule.targetPort),
    sourceCidr: rule.sourceCidr ?? "",
    enabled: rule.enabled,
    mode: ruleRouteMode(rule),
    connectorId: rule.connectorId ?? null,
  };
}

export function NatRuleDialog({
  server,
  rule,
  connectors,
  open,
  onOpenChange,
  onLinkConnector,
}: {
  server: EdgeNatServer;
  rule: EdgeNatRule | null;
  /** Connectors LINKED to this edge — the only ones it can route through. */
  connectors: ConnectorDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sends the operator to this edge's connector link picker instead of a dead end. */
  onLinkConnector?: () => void;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => ruleToForm(rule), [rule]);
  const [form, setForm] = useState<NatRuleForm>(initial);
  const currentForm = open && form.ruleId !== initial.ruleId ? initial : form;
  const selectableConnectors = connectors.filter((connector) => isConnectorSelectableFor(connector, server.id));
  const targetCopy = natRuleTargetCopy(currentForm.mode);
  const connectorMissing = currentForm.mode === "connector" && !currentForm.connectorId;
  const mutation = useMutation({
    mutationFn: (input: NatRuleInput) => apiFetch(
      rule ? `/api/network/edge-networks/servers/${server.id}/rules/${rule.id}` : `/api/network/edge-networks/servers/${server.id}/rules`,
      { method: rule ? "PATCH" : "POST", body: JSON.stringify(input) },
    ),
    onSuccess: () => { toast.success(`${rule ? "Updated" : "Added"} NAT rule. Apply changes when ready.`); onOpenChange(false); void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY }); },
    onError: (error: Error) => toast.error(error.message),
  });
  const update = (patch: Partial<NatRuleForm>) => setForm({ ...currentForm, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const publicPort = Number(currentForm.publicPort);
    const targetPort = Number(currentForm.targetPort);
    if (!currentForm.name.trim() || !currentForm.targetAddress.trim() || !isValidNetworkPort(publicPort) || !isValidNetworkPort(targetPort)) { toast.error("Enter a name, private target, and valid ports from 1–65535."); return; }
    if (connectorMissing) { toast.error("Choose the connector that makes the last hop, or switch back to a direct route."); return; }
    mutation.mutate({
      name: currentForm.name.trim(),
      protocol: currentForm.protocol,
      publicPort,
      targetAddress: currentForm.targetAddress.trim(),
      targetPort,
      sourceCidr: currentForm.sourceCidr.trim() || undefined,
      enabled: currentForm.enabled,
      ...natRuleRouting(currentForm.mode, currentForm.connectorId),
    });
  };
  // Switching to connector mode preselects the only ready connector, if there is one.
  const selectMode = (mode: EdgeRouteMode) => update({
    mode,
    connectorId: mode === "connector"
      ? currentForm.connectorId ?? (selectableConnectors.length === 1 ? selectableConnectors[0].id : null)
      : currentForm.connectorId,
  });
  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader><DialogTitle>{rule ? "Edit" : "Add"} NAT rule</DialogTitle><DialogDescription>Publish one listener on {server.name} and send it to a private lab address.</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5"><Label htmlFor="nat-name">Rule name</Label><Input id="nat-name" value={currentForm.name} onChange={(event) => update({ name: event.target.value })} placeholder="Plex HTTPS" autoFocus /></div>

            <NatRouteModePicker serverId={server.id} mode={currentForm.mode} onSelect={selectMode} />

            <NatRuleConnectorField
              form={currentForm}
              server={server}
              connectors={connectors}
              selectable={selectableConnectors}
              onSelect={(connectorId) => update({ connectorId })}
              onLinkConnector={onLinkConnector ? () => { onOpenChange(false); onLinkConnector(); } : undefined}
            />

            <div className="grid gap-3 sm:grid-cols-[0.7fr_1fr]">
              <div className="grid gap-1.5"><Label>Protocol</Label><Select value={currentForm.protocol} onValueChange={(value) => update({ protocol: value as NatProtocol })}><SelectTrigger className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="tcp">TCP</SelectItem><SelectItem value="udp">UDP</SelectItem></SelectContent></Select></div>
              <div className="grid gap-1.5"><Label htmlFor="public-port">Edge port</Label><Input id="public-port" inputMode="numeric" value={currentForm.publicPort} onChange={(event) => update({ publicPort: event.target.value })} placeholder="443" /></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[1fr_0.55fr]">
              <div className="grid gap-1.5"><Label htmlFor="target-address">{targetCopy.label}</Label><Input id="target-address" value={currentForm.targetAddress} onChange={(event) => update({ targetAddress: event.target.value })} placeholder={targetCopy.placeholder} /></div>
              <div className="grid gap-1.5"><Label htmlFor="target-port">Target port</Label><Input id="target-port" inputMode="numeric" value={currentForm.targetPort} onChange={(event) => update({ targetPort: event.target.value })} placeholder="32400" /></div>
            </div>
            {targetCopy.help && <p className="-mt-2 text-xs text-muted-foreground">{targetCopy.help}</p>}
            <NatSourceCidrField
              value={currentForm.sourceCidr}
              publicPort={currentForm.publicPort}
              onChange={(sourceCidr) => update({ sourceCidr })}
            />
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3"><div><Label htmlFor="nat-enabled">Rule enabled</Label><p className="text-xs text-muted-foreground">Disabled rules remain saved but are not installed.</p></div><Switch id="nat-enabled" checked={currentForm.enabled} onCheckedChange={(enabled) => update({ enabled })} /></div>
          </div>
          <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose><Button type="submit" disabled={mutation.isPending || connectorMissing}>{mutation.isPending && <Loader2 className="animate-spin" />}{rule ? "Save rule" : "Add rule"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NatRouteModePicker({
  serverId,
  mode,
  onSelect,
}: {
  serverId: string;
  mode: EdgeRouteMode;
  onSelect: (mode: EdgeRouteMode) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label id={`route-mode-${serverId}`}>How traffic reaches the target</Label>
      <div role="radiogroup" aria-labelledby={`route-mode-${serverId}`} className="grid gap-2 sm:grid-cols-2">
        {ROUTE_MODE_CHOICES.map((choice) => {
          const active = mode === choice.value;
          return (
            <button
              key={choice.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onSelect(choice.value)}
              className={cn("flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent", active && "border-primary bg-primary/5")}
            >
              <span className={cn("mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border", active && "border-primary bg-primary text-primary-foreground")}>{active && <Check className="size-3" />}</span>
              <span className="min-w-0">
                <span className="block text-sm font-medium">{choice.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{choice.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Only rendered for connector mode: the picker over the connectors LINKED to
 * this edge box, or a way to link one when nothing is.
 */
function NatRuleConnectorField({
  form,
  server,
  connectors,
  selectable,
  onSelect,
  onLinkConnector,
}: {
  form: NatRuleForm;
  server: EdgeNatServer;
  connectors: ConnectorDto[];
  selectable: ConnectorDto[];
  onSelect: (connectorId: string) => void;
  onLinkConnector?: () => void;
}) {
  if (form.mode !== "connector") return null;
  if (selectable.length === 0) {
    return <NatRuleNoConnectors serverName={server.name} onLinkConnector={onLinkConnector} />;
  }
  // A manual connector (OPNsense, or any hand-configured peer) ends PolySIEM's
  // reach at the tunnel: it cannot program that side's forwarding.
  const selected = connectors.find((connector) => connector.id === form.connectorId);
  const warning = selected ? connectorRouteWarning(selected, { publicPort: form.publicPort }, server.id) : null;
  const address = selected ? connectorTunnelAddressFor(selected, server.id) : null;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="nat-connector">Connector</Label>
      <Select value={form.connectorId ?? ""} onValueChange={onSelect}>
        <SelectTrigger id="nat-connector" className="w-full"><SelectValue placeholder="Choose a connector" /></SelectTrigger>
        <SelectContent>
          {connectors.map((connector) => (
            <NatRuleConnectorOption key={connector.id} connector={connector} integrationId={server.id} />
          ))}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        Only connectors linked to {server.name} are listed. Traffic lands on the edge port below, crosses the tunnel to{" "}
        {address ? <code className="font-mono">{address}</code> : "its address on this edge"}, and the connector
        delivers it — that address is assigned automatically, and the same connector holds a different one on every
        other edge box it serves.
      </p>
      {warning && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{warning.title}</AlertTitle>
          <AlertDescription>{warning.detail}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function NatRuleConnectorOption({ connector, integrationId }: { connector: ConnectorDto; integrationId: string }) {
  const reason = connectorUnavailableReason(connector, integrationId);
  return (
    <SelectItem value={connector.id} disabled={reason !== null}>
      <span>{connector.name}</span>
      <span className="text-xs text-muted-foreground">
        {connectorKindLabel(connector)}
        {reason ? ` · ${reason}` : ""}
      </span>
    </SelectItem>
  );
}

/** Never a dead end: linking an existing connector is one click from here. */
function NatRuleNoConnectors({
  serverName,
  onLinkConnector,
}: {
  serverName: string;
  onLinkConnector?: () => void;
}) {
  return (
    <Alert>
      <PlugZap />
      <AlertTitle>No connector is ready on {serverName}</AlertTitle>
      <AlertDescription className="grid gap-2">
        <span>
          A connector is installed once and can serve several edge boxes. Link one you already run to {serverName}, or
          add a new one from the Connectors tab and run its install command.
        </span>
        {onLinkConnector && (
          <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={onLinkConnector}>
            <Link2 /> Link a connector
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/**
 * Leaving this blank is ordinary for a published web service, so the hint stays
 * neutral. It turns amber only when the port being published is an admin
 * service, and then it names the service rather than just colouring red.
 */
function NatSourceCidrField({
  value,
  publicPort,
  onChange,
}: {
  value: string;
  publicPort: string;
  onChange: (value: string) => void;
}) {
  const service = value.trim() ? null : sensitivePortService(publicPort);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="source-cidr">Allowed source CIDR <span className="font-normal text-muted-foreground">(recommended)</span></Label>
      <Input id="source-cidr" value={value} onChange={(event) => onChange(event.target.value)} placeholder="203.0.113.0/24" />
      <p className={cn("text-xs", service ? "text-warning" : "text-muted-foreground")}>
        {value.trim()
          ? "Only this source range can enter the rule."
          : service
            ? `Port ${publicPort} is a ${service} admin port. Left blank, any address on the internet can reach it.`
            : "Blank allows traffic from any internet address."}
      </p>
    </div>
  );
}
