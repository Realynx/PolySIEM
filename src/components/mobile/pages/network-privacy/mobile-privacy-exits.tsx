"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Trash2 } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  vpnExitDeletionCopy,
  vpnExitDisableImpact,
  vpnExitHealth,
  vpnExitProbeView,
  vpnExitStateByKey,
  vpnExitTransfer,
  vpnExitTransferSourceLabel,
  vpnExitsConcurrentNotice,
  VPN_EXITS_EMPTY_STATE,
  VPN_EXIT_DISABLED_NOTE,
  VPN_EXIT_STATE_MEANING,
  VPN_EXIT_TRANSFER_NOTE,
  type VpnExitDisableImpact,
} from "@/components/network/privacy-router-presentation";
import {
  vpnExitImpactQueryKey,
  vpnExitUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDeletionImpact,
  type VpnExitDto,
  type VpnExitProbeResult,
  type VpnExitStatusDto,
  type PrivacyRouterDto,
  type PrivacyRoutingRuleDto,
} from "@/components/network/privacy-router-types";
import { MobilePrivacyExitSheet } from "./mobile-privacy-exit-sheet";
import { VpnConcurrencyBlock, VpnExitStateBadge, PrivacyListNote, PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * The Exits tab on a phone — the WireGuard tunnels this router can send a flow
 * out of.
 *
 * Three things here are honest rather than convenient, and none of them is
 * dropped for a small screen:
 *
 *  - "Up" means link up AND a handshake no older than the agent's limit, so a
 *    tunnel that is up but dead reads down. The tab says what the state means.
 *  - `exitsConcurrent === false` is a visible, explained warning; `null` reads
 *    as "not probed yet", which is a different claim from "fine". The per-exit
 *    probe verdict — including `skip`, which is NOT a pass — is on the row's
 *    sheet.
 *  - Disabling an exit that rules still name will make the next apply refuse,
 *    and that is said AT THE TOGGLE rather than discovered at apply time.
 */
export function MobilePrivacyExitsPanel({
  router,
  exits,
  rules,
  exitStates,
  probes,
  isAdmin,
  addOpen,
  onAddOpenChange,
}: {
  router: PrivacyRouterDto;
  exits: VpnExitDto[];
  rules: PrivacyRoutingRuleDto[];
  exitStates: VpnExitStatusDto[];
  /** `EXIT_PROBE` verdicts from the last apply, keyed by exit key. */
  probes: Record<string, VpnExitProbeResult> | undefined;
  isAdmin: boolean;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<VpnExitDto | null>(null);
  const [deleting, setDeleting] = useState<VpnExitDto | null>(null);
  const [disabling, setDisabling] = useState<VpnExitDto | null>(null);
  const states = useMemo(() => vpnExitStateByKey(exitStates), [exitStates]);
  const canEdit = isAdmin && router.enabled;
  const enabledCount = exits.filter((exit) => exit.enabled).length;
  const toggle = useVpnExitToggle(router.id);
  const selectedExit = exits.find((exit) => exit.id === selected) ?? null;

  /**
   * Disabling is confirmed only when it would COST something: the service
   * refuses to push a list naming an exit the box will not have, because
   * dropping those rules instead would send their flows out of the WAN.
   */
  const requestDisable = (exit: VpnExitDto) => {
    if (vpnExitDisableImpact(exit, rules, router.defaultExitId === exit.id)) setDisabling(exit);
    else toggle.mutate({ exit, enabled: false });
  };

  return (
    <>
      <VpnConcurrencyBlock notice={vpnExitsConcurrentNotice(router.exitsConcurrent, enabledCount, probes)} />

      {exits.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-5 text-center">
          <p className="text-[13px] font-medium">{VPN_EXITS_EMPTY_STATE.title}</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{VPN_EXITS_EMPTY_STATE.detail}</p>
        </div>
      ) : (
        <>
          <PrivacyListNote>
            {enabledCount} of {exits.length} enabled
          </PrivacyListNote>
          <MobileList>
            {exits.map((exit) => (
              <VpnExitRow
                key={exit.id}
                exit={exit}
                state={states.get(exit.key)}
                isDefault={router.defaultExitId === exit.id}
                onSelect={() => setSelected(exit.id)}
              />
            ))}
          </MobileList>
          <PrivacyListNote>{VPN_EXIT_STATE_MEANING}</PrivacyListNote>
        </>
      )}

      {selectedExit && (
        <VpnExitDetailSheet
          exit={selectedExit}
          state={states.get(selectedExit.key)}
          probe={vpnExitProbeView(probes, selectedExit.key)}
          isDefault={router.defaultExitId === selectedExit.id}
          canEdit={canEdit}
          togglePending={toggle.isPending}
          onOpenChange={(open) => !open && setSelected(null)}
          onToggle={(enabled) => (enabled ? toggle.mutate({ exit: selectedExit, enabled: true }) : requestDisable(selectedExit))}
          onEdit={() => {
            setEditing(selectedExit);
            setSelected(null);
          }}
          onDelete={() => {
            setDeleting(selectedExit);
            setSelected(null);
          }}
        />
      )}

      {(addOpen || editing) && (
        <MobilePrivacyExitSheet
          router={router}
          exits={exits}
          exit={editing}
          onOpenChange={(open) => {
            if (open) return;
            setEditing(null);
            onAddOpenChange(false);
          }}
        />
      )}

      <VpnExitDisableDialog
        exit={disabling}
        impact={disabling ? vpnExitDisableImpact(disabling, rules, router.defaultExitId === disabling.id) : null}
        pending={toggle.isPending}
        onConfirm={() => {
          if (disabling) toggle.mutate({ exit: disabling, enabled: false });
          setDisabling(null);
        }}
        onClose={() => setDisabling(null)}
      />
      <VpnExitDeleteDialog router={router} exit={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

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
  state,
  isDefault,
  onSelect,
}: {
  exit: VpnExitDto;
  state: VpnExitStatusDto | undefined;
  isDefault: boolean;
  onSelect: () => void;
}) {
  const health = vpnExitHealth(exit, state);
  return (
    <MobileListRow
      onClick={onSelect}
      className={cn(!exit.enabled && "text-muted-foreground")}
      title={
        <>
          <span className="truncate">{exit.name}</span>
          <VpnExitStateBadge health={health} />
          {isDefault && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Default
            </Badge>
          )}
        </>
      }
      subtitle={
        <span className="font-mono">
          {exit.key} · {exit.ifName} · {exit.endpoint}
        </span>
      }
      trailing={<span className="text-[11px]">{health.handshake}</span>}
    />
  );
}

/** Every column the phone row had no room for, plus what each state means. */
function VpnExitDetailSheet({
  exit,
  state,
  probe,
  isDefault,
  canEdit,
  togglePending,
  onOpenChange,
  onToggle,
  onEdit,
  onDelete,
}: {
  exit: VpnExitDto;
  state: VpnExitStatusDto | undefined;
  probe: ReturnType<typeof vpnExitProbeView>;
  isDefault: boolean;
  canEdit: boolean;
  togglePending: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const health = vpnExitHealth(exit, state);
  const transfer = vpnExitTransfer(exit, state);
  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={exit.name}
      description="One WireGuard tunnel this router can send a flow out of."
    >
      <div className="flex flex-col gap-3 pb-2">
        <MobileList>
          <MobileKeyRow label="State">{health.label}</MobileKeyRow>
          <MobileKeyRow label="Last handshake">{health.handshake}</MobileKeyRow>
          <MobileKeyRow label="Transfer">
            ↓ {formatBytes(transfer.rx)} · ↑ {formatBytes(transfer.tx)}
          </MobileKeyRow>
          <MobileKeyRow label="Counters">{vpnExitTransferSourceLabel(transfer.source)}</MobileKeyRow>
          <MobileKeyRow label="Endpoint" mono>{exit.endpoint}</MobileKeyRow>
          <MobileKeyRow label="Address" mono>{exit.addressCidr}</MobileKeyRow>
          <MobileKeyRow label="Interface" mono>{exit.ifName}</MobileKeyRow>
          <MobileKeyRow label="MTU / keepalive">
            {exit.mtu} · {exit.keepalive}s
          </MobileKeyRow>
          <MobileKeyRow label="Private key">{exit.hasPrivateKey ? "stored" : "missing"}</MobileKeyRow>
          <MobileKeyRow label="Rules routing here">{exit.ruleCount}</MobileKeyRow>
          {isDefault && <MobileKeyRow label="Default action">this exit</MobileKeyRow>}
          {probe && <MobileKeyRow label="Concurrency probe">{probe.label}</MobileKeyRow>}
        </MobileList>

        <PrivacyListNote>{health.detail}</PrivacyListNote>
        <PrivacyListNote>{VPN_EXIT_TRANSFER_NOTE}</PrivacyListNote>
        {probe && (
          <PrivacyNotice tone={probe.tone === "ok" ? "info" : "warning"} title={probe.label} detail={probe.detail} />
        )}

        {canEdit && (
          <>
            <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium">Exit enabled</p>
                <p className="text-xs leading-snug text-muted-foreground">{VPN_EXIT_DISABLED_NOTE}</p>
              </div>
              <Switch
                checked={exit.enabled}
                disabled={togglePending}
                aria-label={`${exit.enabled ? "Disable" : "Enable"} ${exit.name}`}
                onCheckedChange={onToggle}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onEdit}>
                <Pencil /> Edit exit
              </Button>
              <Button variant="destructive" onClick={onDelete}>
                <Trash2 /> Delete exit
              </Button>
            </div>
          </>
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * Warned at the toggle, not at apply time. The refusal is the point: PolySIEM
 * will not push a list naming an exit the box will not have, because dropping
 * those rules instead would leak their flows out of the WAN.
 */
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
            {impact.ruleNames.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep it enabled</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending && <Loader2 className="animate-spin" />}
            Disable anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** The cascade is fetched and shown BEFORE anything is destroyed. */
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
  const impactQuery = useQuery({
    queryKey: vpnExitImpactQueryKey(router.id, exit?.id ?? ""),
    queryFn: () => apiFetch<VpnExitDeletionImpact>(vpnExitUrl(router.id, exit?.id ?? "")),
    enabled: exit !== null,
    retry: false,
  });
  const copy = vpnExitDeletionCopy(exit?.name ?? "this exit", impactQuery.data);
  const mutation = useMutation({
    mutationFn: (exitId: string) =>
      apiFetch<{ deletedRuleCount: number }>(vpnExitUrl(router.id, exitId), { method: "DELETE" }),
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
            {copy.ruleNames.map((name) => (
              <li key={name} className="truncate">
                {name}
              </li>
            ))}
          </ul>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {!copy.blocked && (
            <AlertDialogAction
              variant="destructive"
              disabled={mutation.isPending || impactQuery.isLoading}
              onClick={(event) => {
                event.preventDefault();
                if (exit) mutation.mutate(exit.id);
              }}
            >
              {mutation.isPending && <Loader2 className="animate-spin" />}
              {copy.confirmLabel}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
