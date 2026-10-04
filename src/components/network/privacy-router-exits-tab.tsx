"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Info, Loader2, Pencil, Plus, Trash2, TriangleAlert, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  vpnExitDeletionCopy,
  vpnExitDisableImpact,
  vpnExitFormError,
  vpnExitHealth,
  vpnExitKeyFromName,
  vpnExitKeyHelp,
  vpnExitProbeView,
  vpnExitStateByKey,
  vpnExitTransfer,
  vpnExitTransferSourceLabel,
  vpnExitsConcurrentNotice,
  VPN_EXITS_EMPTY_STATE,
  VPN_EXIT_ADVANCED_LABEL,
  VPN_EXIT_DISABLED_NOTE,
  VPN_EXIT_KEY_LABEL,
  VPN_EXIT_KEY_MAX_LENGTH,
  VPN_EXIT_MTU_NOTE,
  VPN_EXIT_NO_KEY_NOTE,
  VPN_EXIT_PRIVATE_KEY_NOTE,
  VPN_EXIT_STATE_MEANING,
  VPN_EXIT_TRANSFER_NOTE,
  type VpnExitDisableImpact,
  type VpnExitHealthView,
  type VpnExitProbeView,
  type VpnExitTone,
} from "./privacy-router-presentation";
import {
  vpnExitImpactQueryKey,
  vpnExitUrl,
  vpnExitsUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDeletionImpact,
  type VpnExitDto,
  type VpnExitInputBody,
  type VpnExitProbeResult,
  type VpnExitStatusDto,
  type PrivacyRouterDto,
  type PrivacyRoutingRuleDto,
} from "./privacy-router-types";

/**
 * The Exits tab — the WireGuard tunnels this router can send a flow out of.
 *
 * Three things here are honest rather than convenient, and each is a real
 * asymmetry the field report asked for:
 *
 *  - `EXIT_STATE up` means link up AND a handshake no older than 180 seconds, so
 *    a tunnel that is up but dead reads down. The tab says what the state means
 *    instead of leaving an operator to discover it.
 *  - `exitsConcurrent === false` means the kernel tier could not prove it can
 *    run several tunnels at once. That is the one place this feature can quietly
 *    under-deliver, so it is a notice at the top of the tab — and the per-exit
 *    `EXIT_PROBE` verdict behind that boolean is shown on each row, so the
 *    operator sees WHICH tunnel failed rather than only that one did.
 *  - Disabling an exit that rules still name will make the next apply refuse.
 *    The warning is at the toggle, not at apply time.
 */
export function PrivacyRouterExitsTab({
  router,
  exits,
  rules,
  exitStates,
  probes,
  isAdmin,
}: {
  router: PrivacyRouterDto;
  exits: VpnExitDto[];
  rules: PrivacyRoutingRuleDto[];
  exitStates: VpnExitStatusDto[];
  /** The last STATUS read's per-exit probe verdicts; undefined until one succeeds. */
  probes: Record<string, VpnExitProbeResult> | undefined;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<{ open: boolean; exit: VpnExitDto | null }>({ open: false, exit: null });
  const [deleting, setDeleting] = useState<VpnExitDto | null>(null);
  const [disabling, setDisabling] = useState<VpnExitDto | null>(null);
  const states = useMemo(() => vpnExitStateByKey(exitStates), [exitStates]);
  const canEdit = isAdmin && router.enabled;
  const concurrency = vpnExitsConcurrentNotice(
    router.exitsConcurrent,
    exits.filter((exit) => exit.enabled).length,
    probes,
  );
  const toggle = useVpnExitToggle(router.id);

  /**
   * Disabling is confirmed only when it would COST something. Rules that name
   * the exit make the next apply refuse, and that refusal is the point: the
   * service will not push a list naming an exit the box will not have, because
   * dropping those rules instead would send their flows out of the WAN. So the
   * question is asked here rather than discovered at apply time — and skipped
   * entirely when nothing names the exit.
   */
  const requestDisable = (exit: VpnExitDto) => {
    if (vpnExitDisableImpact(exit, rules, router.defaultExitId === exit.id)) setDisabling(exit);
    else toggle.mutate({ exit, enabled: false });
  };

  return (
    <div className="space-y-4">
      {concurrency && (
        <Alert variant={concurrency.tone === "warning" ? "destructive" : "default"}>
          {concurrency.tone === "warning" ? <TriangleAlert /> : <Info />}
          <AlertTitle>{concurrency.title}</AlertTitle>
          <AlertDescription>{concurrency.detail}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border bg-muted/20 px-3 py-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <Waypoints className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium tabular-nums">
            {exits.filter((exit) => exit.enabled).length} of {exits.length} enabled
          </span>
          <span className="text-muted-foreground/50" aria-hidden="true">·</span>
          <span className="text-muted-foreground">{VPN_EXIT_STATE_MEANING}</span>
        </p>
        {canEdit && (
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => setEditing({ open: true, exit: null })}>
            <Plus /> Add exit
          </Button>
        )}
      </div>

      {exits.length === 0 ? (
        <VpnExitsEmptyState canEdit={canEdit} onAdd={() => setEditing({ open: true, exit: null })} />
      ) : (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[15rem]">Exit</TableHead>
                  <TableHead className="w-[9rem]">State</TableHead>
                  <TableHead className="w-[9rem]">Last handshake</TableHead>
                  <TableHead className="w-[11rem]">Transfer</TableHead>
                  <TableHead>Tunnel</TableHead>
                  <TableHead className="w-[7rem]">Rules</TableHead>
                  {canEdit && <TableHead className="w-[9rem]"><span className="sr-only">Actions</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {exits.map((exit) => (
                  <VpnExitRow
                    key={exit.id}
                    exit={exit}
                    router={router}
                    state={states.get(exit.key)}
                    probe={vpnExitProbeView(probes, exit.key)}
                    canEdit={canEdit}
                    togglePending={toggle.isPending}
                    onEnable={() => toggle.mutate({ exit, enabled: true })}
                    onRequestDisable={() => requestDisable(exit)}
                    onEdit={() => setEditing({ open: true, exit })}
                    onDelete={() => setDeleting(exit)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
          {/* The Transfer column's counters reset with the interface, which looks like data loss. */}
          <p className="text-xs text-muted-foreground">{VPN_EXIT_TRANSFER_NOTE}</p>
        </div>
      )}

      <VpnExitDialog
        router={router}
        exits={exits}
        exit={editing.exit}
        open={editing.open}
        onOpenChange={(open) => setEditing((current) => ({ ...current, open }))}
      />
      <VpnExitDisableDialog
        exit={disabling}
        impact={disabling ? vpnExitDisableImpact(disabling, rules, router.defaultExitId === disabling.id) : null}
        pending={toggle.isPending}
        onConfirm={() => { if (disabling) toggle.mutate({ exit: disabling, enabled: false }); setDisabling(null); }}
        onClose={() => setDisabling(null)}
      />
      <VpnExitDeleteDialog router={router} exit={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function VpnExitsEmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">{VPN_EXITS_EMPTY_STATE.title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{VPN_EXITS_EMPTY_STATE.detail}</p>
      {canEdit && <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}><Plus /> Add first exit</Button>}
    </div>
  );
}

const EXIT_TONE_VARIANT: Record<VpnExitTone, "secondary" | "destructive" | "outline"> = {
  up: "secondary",
  down: "destructive",
  disabled: "outline",
  unknown: "outline",
};

/** One mutation for both directions of the enable switch, shared by the dialog. */
function useVpnExitToggle(routerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ exit, enabled }: { exit: VpnExitDto; enabled: boolean }) =>
      apiFetch(vpnExitUrl(routerId, exit.id), { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: (_result, { exit, enabled }) => {
      toast.success(`${exit.name} ${enabled ? "enabled" : "disabled"}. Apply the configuration to change the router.`);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not change the exit: ${error.message}`),
  });
}

function VpnExitRow({
  exit,
  router,
  state,
  probe,
  canEdit,
  togglePending,
  onEnable,
  onRequestDisable,
  onEdit,
  onDelete,
}: {
  exit: VpnExitDto;
  router: PrivacyRouterDto;
  state: VpnExitStatusDto | undefined;
  probe: VpnExitProbeView | null;
  canEdit: boolean;
  togglePending: boolean;
  onEnable: () => void;
  onRequestDisable: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const health = vpnExitHealth(exit, state);
  const transfer = vpnExitTransfer(exit, state);
  const isDefault = router.defaultExitId === exit.id;

  return (
    <TableRow className={cn(!exit.enabled && "text-muted-foreground")}>
      <TableCell className="align-top">
        <p className="text-sm font-medium">{exit.name}</p>
        <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{exit.key} · {exit.ifName}</p>
        {isDefault && <Badge variant="outline" className="mt-1 font-normal">Default action</Badge>}
      </TableCell>
      <TableCell className="align-top"><VpnExitStateCell health={health} probe={probe} /></TableCell>
      <TableCell className="align-top text-xs tabular-nums">{health.handshake}</TableCell>
      <TableCell className="align-top">
        <p className="text-xs tabular-nums">↓ {formatBytes(transfer.rx)} · ↑ {formatBytes(transfer.tx)}</p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{vpnExitTransferSourceLabel(transfer.source)}</p>
      </TableCell>
      <TableCell className="align-top">
        <p className="font-mono text-xs break-all">{exit.endpoint}</p>
        <p className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">{exit.addressCidr} · MTU {exit.mtu}</p>
      </TableCell>
      <TableCell className="align-top text-xs tabular-nums">{exit.ruleCount}</TableCell>
      {canEdit && (
        <TableCell className="align-top">
          <div className="flex items-start justify-end gap-1">
            <Switch
              checked={exit.enabled}
              disabled={togglePending}
              aria-label={`${exit.enabled ? "Disable" : "Enable"} ${exit.name}`}
              onCheckedChange={(next) => (next ? onEnable() : onRequestDisable())}
            />
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${exit.name}`} onClick={onEdit}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${exit.name}`} onClick={onDelete}><Trash2 /></Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/**
 * `skip` is amber rather than neutral: the box could not measure the exit, which
 * is not the same as it passing, and colouring it as a pass is the one mistake
 * the probe exists to prevent.
 */
const PROBE_TONE_CLASS: Record<VpnExitProbeView["tone"], string> = {
  ok: "text-muted-foreground",
  fail: "text-destructive",
  skip: "text-warning",
};

/**
 * The badge carries the meaning of the state in its tooltip, not just a colour.
 *
 * Under it sits the exit's own `EXIT_PROBE` verdict from the last apply — the
 * per-exit detail behind the router-wide `exitsConcurrent` flag, so "one of your
 * exits could not be used concurrently" becomes "this one could not".
 */
function VpnExitStateCell({ health, probe }: { health: VpnExitHealthView; probe: VpnExitProbeView | null }) {
  return (
    <div className="space-y-1">
      <Badge variant={EXIT_TONE_VARIANT[health.tone]} className="font-normal" title={health.detail}>
        {health.tone === "up" && <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />}
        {health.label}
      </Badge>
      {probe && (
        <p className={cn("text-[0.6875rem]", PROBE_TONE_CLASS[probe.tone])} title={probe.detail}>
          Concurrency probe: {probe.label}
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Disable — warned at the toggle, not at apply time                   */
/* ------------------------------------------------------------------ */

function VpnExitDisableDialog({
  exit,
  impact,
  pending,
  onConfirm,
  onClose,
}: {
  exit: VpnExitDto | null;
  impact: VpnExitDisableImpact | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <AlertDialog open={exit !== null && impact !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{impact?.title ?? "Disable this exit?"}</AlertDialogTitle>
          <AlertDialogDescription>{impact?.detail}</AlertDialogDescription>
        </AlertDialogHeader>
        {impact && impact.ruleNames.length > 0 && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2.5 text-sm">
            {impact.ruleNames.map((name) => <li key={name} className="truncate">{name}</li>)}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it enabled</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {pending && <Loader2 className="animate-spin" />}Disable anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Delete — the cascade is shown before anything is destroyed          */
/* ------------------------------------------------------------------ */

function VpnExitDeleteDialog({
  router,
  exit,
  onClose,
}: {
  router: PrivacyRouterDto;
  exit: VpnExitDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  // The API reports the blast radius BEFORE the delete: `PrivacyRoutingRule.exitId`
  // cascades, so the rules routing through an exit die with it.
  const impactQuery = useQuery({
    queryKey: vpnExitImpactQueryKey(router.id, exit?.id ?? ""),
    queryFn: () => apiFetch<VpnExitDeletionImpact>(vpnExitUrl(router.id, exit?.id ?? "")),
    enabled: exit !== null,
    retry: false,
  });
  const copy = vpnExitDeletionCopy(exit?.name ?? "this exit", impactQuery.data);
  const mutation = useMutation({
    mutationFn: (exitId: string) => apiFetch<{ deletedRuleCount: number }>(vpnExitUrl(router.id, exitId), { method: "DELETE" }),
    onSuccess: (result) => {
      toast.success(
        result.deletedRuleCount > 0
          ? `Exit deleted, along with ${result.deletedRuleCount} routing rule${result.deletedRuleCount === 1 ? "" : "s"}.`
          : "Exit deleted. Apply the configuration to tear the tunnel down.",
      );
      onClose();
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not delete the exit: ${error.message}`),
  });

  return (
    <AlertDialog open={exit !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.title}</AlertDialogTitle>
          <AlertDialogDescription>
            {impactQuery.isLoading ? "Checking what this delete would take with it…" : copy.detail}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {copy.ruleNames.length > 0 && !copy.blocked && (
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border bg-muted/20 p-2.5 text-sm">
            {copy.ruleNames.map((name) => <li key={name} className="truncate">{name}</li>)}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {!copy.blocked && (
            <AlertDialogAction
              variant="destructive"
              disabled={mutation.isPending || impactQuery.isLoading}
              onClick={(event) => { event.preventDefault(); if (exit) mutation.mutate(exit.id); }}
            >
              {mutation.isPending && <Loader2 className="animate-spin" />}{copy.confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ------------------------------------------------------------------ */
/* Exit editor                                                         */
/* ------------------------------------------------------------------ */

/**
 * The exit editor's state.
 *
 * `key` is no longer typed by hand in the ordinary case: PolySIEM derives it
 * from the name, and `keyTouched` records that the operator took it over so a
 * later edit to the name does not silently rename the tunnel's interface under
 * them. An existing exit starts touched — its interface already exists.
 */
interface VpnExitForm {
  exitId: string | null;
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

const EMPTY_VPN_EXIT_FORM: VpnExitForm = {
  exitId: null,
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

function exitToForm(exit: VpnExitDto | null): VpnExitForm {
  if (!exit) return EMPTY_VPN_EXIT_FORM;
  return {
    exitId: exit.id,
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

function formToExitBody(form: VpnExitForm): VpnExitInputBody {
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

/**
 * Add or edit one WireGuard exit.
 *
 * The form asks for a NAME and the four values off the provider's config file.
 * It no longer asks for a "Key" beside "Name" — in a dialog that also takes a
 * WireGuard private key, a second field called key is a hazard, not a label
 * problem ("I'm not sure what key means. It's right next to name."). PolySIEM
 * derives the slug from the name, keeps it unique against the exits that already
 * exist, and leaves it editable under Advanced as the "interface suffix" it
 * actually is — at the far end of the form from any key material.
 */
export function VpnExitDialog({
  router,
  exits,
  exit,
  open,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  /** The router's existing exits, so a derived suffix cannot collide with one. */
  exits: readonly VpnExitDto[];
  exit: VpnExitDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => exitToForm(exit), [exit]);
  const [form, setForm] = useState<VpnExitForm>(initial);
  const current = open && form.exitId !== initial.exitId ? initial : form;
  const takenKeys = useMemo(
    () => exits.filter((one) => one.id !== exit?.id).map((one) => one.key),
    [exits, exit],
  );
  const mutation = useMutation({
    mutationFn: (body: VpnExitInputBody) => apiFetch(
      exit ? vpnExitUrl(router.id, exit.id) : vpnExitsUrl(router.id),
      { method: exit ? "PATCH" : "POST", body: JSON.stringify(body) },
    ),
    onSuccess: () => {
      toast.success(`${exit ? "Updated" : "Added"} the exit. Apply the configuration to bring it up.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the exit: ${error.message}`),
  });

  const update = (patch: Partial<VpnExitForm>) => setForm({ ...current, ...patch });
  /** Typing a name re-derives the suffix, unless the operator has taken it over. */
  const updateName = (name: string) =>
    update({ name, ...(current.keyTouched ? {} : { key: vpnExitKeyFromName(name, takenKeys) }) });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = vpnExitFormError(current, exit === null);
    if (error) { toast.error(error); return; }
    mutation.mutate(formToExitBody(current));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{exit ? "Edit" : "Add"} exit</DialogTitle>
            <DialogDescription>
              One WireGuard tunnel on {router.name}. Every value comes from the provider&apos;s config file.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-exit-name">Name</Label>
              <Input id="privacy-exit-name" value={current.name} onChange={(event) => updateName(event.target.value)} placeholder="Netherlands 1" maxLength={64} autoFocus={!exit} />
              <p className="text-xs text-muted-foreground">{vpnExitKeyHelp(current.key)}</p>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="privacy-exit-address">Interface address</Label>
              <Input id="privacy-exit-address" value={current.addressCidr} onChange={(event) => update({ addressCidr: event.target.value })} placeholder="10.2.0.2/32" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-exit-endpoint">Endpoint</Label>
              <Input id="privacy-exit-endpoint" value={current.endpoint} onChange={(event) => update({ endpoint: event.target.value })} placeholder="nl-1.example.net:51820" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-exit-peer">Peer public key</Label>
              <Input id="privacy-exit-peer" value={current.peerPublicKey} onChange={(event) => update({ peerPublicKey: event.target.value })} placeholder="44-character base64 key" spellCheck={false} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-exit-private">Private key {exit && <span className="font-normal text-muted-foreground">(leave blank to keep the stored one)</span>}</Label>
              <Input id="privacy-exit-private" type="password" value={current.privateKey} onChange={(event) => update({ privateKey: event.target.value })} placeholder="44-character base64 key" autoComplete="off" spellCheck={false} />
              <p className="text-xs text-muted-foreground">
                {VPN_EXIT_PRIVATE_KEY_NOTE}
                {exit?.hasPrivateKey === false && VPN_EXIT_NO_KEY_NOTE}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-exit-keepalive">Persistent keepalive (s)</Label>
                <Input id="privacy-exit-keepalive" inputMode="numeric" value={current.keepalive} onChange={(event) => update({ keepalive: event.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-exit-mtu">MTU</Label>
                <Input id="privacy-exit-mtu" inputMode="numeric" value={current.mtu} onChange={(event) => update({ mtu: event.target.value })} />
                <p className="text-xs text-muted-foreground">{VPN_EXIT_MTU_NOTE}</p>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="privacy-exit-enabled">Exit enabled</Label>
                <p className="text-xs text-muted-foreground">{VPN_EXIT_DISABLED_NOTE}</p>
              </div>
              <Switch id="privacy-exit-enabled" checked={current.enabled} onCheckedChange={(enabled) => update({ enabled })} />
            </div>

            <VpnExitAdvanced
              value={current.key}
              onChange={(key) => update({ key: key.toLowerCase(), keyTouched: true })}
            />
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}{exit ? "Save exit" : "Add exit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The derived interface suffix, editable but out of the way.
 *
 * Collapsed, last on the form, and as far from the private-key field as the
 * layout allows — the point of moving it was that two adjacent fields called
 * "key" invited one to be filled with the other.
 */
function VpnExitAdvanced({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="w-full justify-between px-3">
          <span className="font-normal">{VPN_EXIT_ADVANCED_LABEL}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="font-mono">{value || "—"}</span>
            <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
          </span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-1.5 border-t p-3">
          <Label htmlFor="privacy-exit-key">{VPN_EXIT_KEY_LABEL}</Label>
          <Input
            id="privacy-exit-key"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="nl1"
            maxLength={VPN_EXIT_KEY_MAX_LENGTH}
            autoCapitalize="none"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">{vpnExitKeyHelp(value)}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
