"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ChevronDown, Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { vpnRuleInertReason as privacyRuleInertReason } from "@/lib/integrations/privacy-router/rules";
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  movePrivacyRuleOrder,
  privacyAgentRuleSeqs,
  privacyDefaultActionLabel,
  vpnRateLimitView,
  privacyRuleActionLabel,
  privacyRuleCounterView,
  privacyRuleMatchView,
  privacyRuleSpeedHint,
  privacyRuleTierList,
  privacyRuleTierView,
  privacyRulesHaveMixedTiers,
  PRIVACY_DEFAULT_ACTION_DIRECT_NOTE,
  PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE,
  PRIVACY_DEFAULT_ACTION_NOTE,
  PRIVACY_DEFAULT_ACTION_ROW_TITLE,
  PRIVACY_HOSTNAME_ECH_NOTE,
  PRIVACY_HOSTNAME_ECH_REMEDY_NOTE,
  PRIVACY_HOSTNAME_SCOPE_NOTE,
  PRIVACY_QUIC_BLOCKED_NOTE,
  PRIVACY_RULES_EMPTY_STATE,
  PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_NOTE,
  PRIVACY_TIER_DERIVED_NOTE,
  PRIVACY_TIER_EXPLAINERS,
  type PrivacyRuleCounterView,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRouterUrl,
  privacyRuleUrl,
  privacyRulesReorderUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDto,
  type PrivacyRouterDto,
  type PrivacyRoutingRuleDto,
  type PrivacyRuleActionKind,
  type PrivacyRuleCounterDto,
  type PrivacyRuleTier,
} from "@/components/network/privacy-router-types";
import { MobilePrivacyRuleSheet } from "./mobile-privacy-rule-sheet";
import { PrivacyListNote, PrivacyNotice, PrivacyTierBadge } from "./mobile-privacy-atoms";

/**
 * The Rules tab on a phone — the firewall, as one ordered, first-match-wins
 * list.
 *
 * A desktop row spreads across eight columns; a 412px row has three slots, so
 * the position, the name and the Kernel/Inspected badge lead, the match reads as
 * one mono line underneath, and the action sits trailing. Nothing the desktop
 * table states is dropped for the space — the throttle mechanism, the matched
 * bytes, the reorder that would make an inspected row faster and the reason a
 * hostname rule is inert all live in the row's sheet, one tap away, in the same
 * words `privacy-router-presentation` gives the desktop table.
 */
export function MobilePrivacyRulesPanel({
  router,
  rules,
  exits,
  ruleCounters,
  hasStatus,
  isAdmin,
  addOpen,
  onAddOpenChange,
}: {
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  exits: VpnExitDto[];
  ruleCounters: PrivacyRuleCounterDto[];
  /** False until the router has been read, so counters say "—" not a claim. */
  hasStatus: boolean;
  isAdmin: boolean;
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<PrivacyRoutingRuleDto | null>(null);
  const [deleting, setDeleting] = useState<PrivacyRoutingRuleDto | null>(null);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const canEdit = isAdmin && router.enabled;

  const tiers = privacyRuleTierList(rules);
  // Keyed on the AGENT's sequence, not the stored one: the canonical ruleset
  // renumbers over the enabled rules only, so one disabled rule would otherwise
  // shift every counter below it onto the wrong row.
  const agentSeqs = privacyAgentRuleSeqs(rules);
  const countersBySeq = useMemo(
    () => new Map(ruleCounters.map((counter) => [counter.seq, counter])),
    [ruleCounters],
  );
  const reorder = useVpnRuleReorder(router.id);
  const selectedIndex = rules.findIndex((rule) => rule.id === selected);

  return (
    <>
      <PrivacyRulesHeader router={router} rules={rules} />

      {rules.length === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-5 text-center">
          <p className="text-[13px] font-medium">{PRIVACY_RULES_EMPTY_STATE.title}</p>
          <p className="mt-1 text-xs leading-snug text-muted-foreground">{PRIVACY_RULES_EMPTY_STATE.detail}</p>
        </div>
      ) : (
        <MobileList>
          {rules.map((rule, index) => (
            <PrivacyRuleRow
              key={rule.id}
              rule={rule}
              index={index}
              tier={tiers[index]}
              onSelect={() => setSelected(rule.id)}
            />
          ))}
        </MobileList>
      )}

      <PrivacyDefaultActionRow router={router} exits={exits} canEdit={canEdit} onEdit={() => setDefaultOpen(true)} />

      {defaultOpen && (
        <PrivacyDefaultActionSheet router={router} exits={exits} onOpenChange={setDefaultOpen} />
      )}

      {selectedIndex >= 0 && (
        <PrivacyRuleSheet
          rules={rules}
          index={selectedIndex}
          tier={tiers[selectedIndex]}
          counter={privacyRuleCounterView(
            tiers[selectedIndex],
            counterFor(agentSeqs[selectedIndex], countersBySeq),
            hasStatus,
            rules[selectedIndex].enabled,
          )}
          canEdit={canEdit}
          reordering={reorder.isPending}
          onOpenChange={(open) => !open && setSelected(null)}
          onMove={(direction) => {
            const order = movePrivacyRuleOrder(rules, rules[selectedIndex].id, direction);
            if (order) reorder.mutate(order);
          }}
          onEdit={() => {
            setEditing(rules[selectedIndex]);
            setSelected(null);
          }}
          onDelete={() => {
            setDeleting(rules[selectedIndex]);
            setSelected(null);
          }}
        />
      )}

      {(addOpen || editing) && (
        <MobilePrivacyRuleSheet
          router={router}
          rules={rules}
          exits={exits}
          rule={editing}
          onOpenChange={(open) => {
            if (open) return;
            setEditing(null);
            onAddOpenChange(false);
          }}
        />
      )}

      <PrivacyRuleDeleteDialog router={router} rule={deleting} onClose={() => setDeleting(null)} />
    </>
  );
}

/** No agent sequence means the rule is disabled and the box never rendered it. */
function counterFor(
  agentSeq: number | null | undefined,
  counters: Map<number, PrivacyRuleCounterDto>,
): PrivacyRuleCounterDto | undefined {
  return agentSeq === null || agentSeq === undefined ? undefined : counters.get(agentSeq);
}

/** POSTs the WHOLE order — `seq` is unique per router, so a partial list is refused. */
function useVpnRuleReorder(routerId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ruleIds: string[]) =>
      apiFetch<PrivacyRoutingRuleDto[]>(privacyRulesReorderUrl(routerId), {
        method: "POST",
        body: JSON.stringify({ ruleIds }),
      }),
    onSuccess: () => {
      toast.success("Reordered. Apply the configuration to push the new order.");
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not reorder the rules: ${error.message}`),
  });
}

/**
 * The one sentence that makes an ordered list readable, and — behind a
 * disclosure — what the two tiers actually mean. Both explanations are the
 * shared ones, so the phone cannot describe the datapath differently.
 */
function PrivacyRulesHeader({ router, rules }: { router: PrivacyRouterDto; rules: PrivacyRoutingRuleDto[] }) {
  const [open, setOpen] = useState(false);
  const mixed = privacyRulesHaveMixedTiers(rules);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border bg-card">
      <CollapsibleTrigger asChild>
        <button type="button" className="flex min-h-11 w-full items-center gap-2 px-3.5 py-2 text-left active:bg-muted/60">
          <span className="min-w-0 flex-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {rules.length} rule{rules.length === 1 ? "" : "s"}
            </span>
            {" · evaluated top to bottom, first match wins"}
            {mixed && " · two enforcement tiers in use"}
          </span>
          <ChevronDown
            className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-2 border-t px-3.5 py-3 text-[11px] leading-snug text-muted-foreground">
          {PRIVACY_TIER_EXPLAINERS.map((view) => (
            <p key={view.tier}>
              <span className="font-medium text-foreground">{view.label}</span> — {view.detail}
            </p>
          ))}
          <p>{PRIVACY_TIER_DERIVED_NOTE}</p>
          <p>{PRIVACY_HOSTNAME_SCOPE_NOTE}</p>
          <p>{PRIVACY_HOSTNAME_ECH_NOTE} {PRIVACY_HOSTNAME_ECH_REMEDY_NOTE}</p>
          {router.blockQuic && <p>{PRIVACY_QUIC_BLOCKED_NOTE}</p>}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The evaluation position, as the row's leading key — this is an ordered list. */
function RuleSeqChip({ index, enabled }: { index: number; enabled: boolean }) {
  return (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-md bg-muted font-mono text-[11px] leading-none font-medium",
        !enabled && "opacity-50",
      )}
    >
      {index + 1}
    </span>
  );
}

function PrivacyRuleRow({
  rule,
  index,
  tier,
  onSelect,
}: {
  rule: PrivacyRoutingRuleDto;
  index: number;
  tier: PrivacyRuleTier;
  onSelect: () => void;
}) {
  const match = privacyRuleMatchView(rule);
  const warn = rule.exitDisabled || privacyRuleInertReason(toInertShape(rule)) !== null;
  return (
    <MobileListRow
      onClick={onSelect}
      className={cn(!rule.enabled && "text-muted-foreground")}
      leading={<RuleSeqChip index={index} enabled={rule.enabled} />}
      title={
        <>
          <span className="truncate">{rule.name}</span>
          <PrivacyTierBadge tier={tier} />
          {!rule.enabled && (
            <Badge variant="outline" className="text-[10px] font-normal">
              Disabled
            </Badge>
          )}
        </>
      }
      subtitle={<span className="font-mono">{match.summary}</span>}
      trailing={
        <>
          {warn && <TriangleAlert className="size-3.5 text-warning" aria-hidden="true" />}
          <span className="max-w-24 truncate text-[11px]">{privacyRuleActionLabel(rule)}</span>
        </>
      }
    />
  );
}

/** The shape `privacyRuleInertReason` reads, off a DTO. */
function toInertShape(rule: PrivacyRoutingRuleDto) {
  return {
    action: "direct" as const,
    proto: rule.proto as "tcp" | "udp" | null,
    dportSpec: rule.dportSpec,
    hostname: rule.hostname,
  };
}

/**
 * Everything the desktop table's columns carry, for one rule.
 *
 * The tier's meaning, the reorder that would speed this row up, the throttle
 * mechanism and the matched-bytes claim are all here rather than compressed out
 * of existence — each of them is a real asymmetry that becomes a support
 * question when a phone quietly drops it.
 */
function PrivacyRuleSheet({
  rules,
  index,
  tier,
  counter,
  canEdit,
  reordering,
  onOpenChange,
  onMove,
  onEdit,
  onDelete,
}: {
  rules: PrivacyRoutingRuleDto[];
  index: number;
  tier: PrivacyRuleTier;
  counter: PrivacyRuleCounterView;
  canEdit: boolean;
  reordering: boolean;
  onOpenChange: (open: boolean) => void;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const rule = rules[index];
  const match = privacyRuleMatchView(rule);
  const rate = vpnRateLimitView(tier, rule.rateKbps);
  const speedHint = privacyRuleSpeedHint(rules, index);
  const inert = privacyRuleInertReason(toInertShape(rule));
  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={rule.name}
      description={`Rule ${index + 1} of ${rules.length} · the first rule that matches a flow decides where it leaves.`}
    >
      <div className="flex flex-col gap-3 pb-2">
        {rule.exitDisabled && <PrivacyNotice tone="warning" detail={PRIVACY_RULE_EXIT_DISABLED_NOTE} />}
        {inert && <PrivacyNotice tone="warning" title="This rule can never match" detail={inert} />}

        <MobileList>
          <MobileKeyRow label="Action">{privacyRuleActionLabel(rule)}</MobileKeyRow>
          <MobileKeyRow label="Source" mono>{match.source}</MobileKeyRow>
          <MobileKeyRow label="Destination" mono>{match.destination}</MobileKeyRow>
          <MobileKeyRow label="Ports" mono>{match.ports}</MobileKeyRow>
          <MobileKeyRow label="Hostname" mono>{match.hostnameLabel}</MobileKeyRow>
          <MobileKeyRow label="Enforced">{privacyRuleTierView(tier).label}</MobileKeyRow>
          <MobileKeyRow label="Throttle">{rate ? rate.label : "No limit"}</MobileKeyRow>
          <MobileKeyRow label="Matched bytes">{counter.label}</MobileKeyRow>
          <MobileKeyRow label="Rule">{rule.enabled ? "Enabled" : "Disabled"}</MobileKeyRow>
        </MobileList>

        <PrivacyListNote>{privacyRuleTierView(tier).detail}</PrivacyListNote>
        {speedHint && <PrivacyListNote>{speedHint}</PrivacyListNote>}
        {rate && <PrivacyListNote>{rate.detail}</PrivacyListNote>}
        <PrivacyListNote>{counter.detail}</PrivacyListNote>

        {canEdit && (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" disabled={index === 0 || reordering} onClick={() => onMove(-1)}>
                <ArrowUp /> Move up
              </Button>
              <Button variant="outline" disabled={index === rules.length - 1 || reordering} onClick={() => onMove(1)}>
                <ArrowDown /> Move down
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" onClick={onEdit}>
                <Pencil /> Edit rule
              </Button>
              <Button variant="destructive" onClick={onDelete}>
                <Trash2 /> Remove rule
              </Button>
            </div>
          </div>
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * The terminal row: what happens to a flow no rule matched.
 *
 * It used to be a dropdown in the add sheet, chosen before a single rule
 * existed. At the foot of the list its meaning IS its position, so the row that
 * already showed it is now the row that edits it.
 */
function PrivacyDefaultActionRow({
  router,
  exits,
  canEdit,
  onEdit,
}: {
  router: PrivacyRouterDto;
  exits: VpnExitDto[];
  canEdit: boolean;
  onEdit: () => void;
}) {
  const label = privacyDefaultActionLabel(router, exits);
  const body = (
    <>
      <span className="min-w-0 text-left text-xs">
        <span className="font-medium">{PRIVACY_DEFAULT_ACTION_ROW_TITLE}</span>
        <span className="mt-0.5 block text-muted-foreground">the router&apos;s default action</span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <Badge variant="outline" className="text-[11px] font-normal">{label}</Badge>
        {canEdit && <Pencil className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      </span>
    </>
  );
  const className = "flex min-h-13 w-full items-center justify-between gap-3 rounded-xl border border-dashed px-3.5 py-2.5";
  if (!canEdit) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Change the default action, currently ${label}`}
      className={cn(className, "text-left active:bg-muted/60")}
    >
      {body}
    </button>
  );
}

/**
 * Editing the last line of the firewall.
 *
 * `direct` is the shipped default and the safe one: a fresh router changes
 * nothing until a rule opts a service into a tunnel. Choosing an exit reroutes
 * everything OPNsense points at this box, including devices nobody has written
 * a rule for — so that consequence is stated at the control.
 */
function PrivacyDefaultActionSheet({
  router,
  exits,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  exits: VpnExitDto[];
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    action: router.defaultAction as PrivacyRuleActionKind,
    exitId: router.defaultExitId ?? "",
  });
  const selected = exits.find((exit) => exit.id === form.exitId);
  const mutation = useMutation({
    mutationFn: (body: { defaultAction: PrivacyRuleActionKind; defaultExitId: string | null }) =>
      apiFetch(privacyRouterUrl(router.id), { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => {
      toast.success("Default action saved. Apply the configuration to push it.");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the default action: ${error.message}`),
  });

  const submit = () => {
    if (form.action === "exit" && !form.exitId) {
      toast.error("Choose the exit the default action routes through.");
      return;
    }
    mutation.mutate({
      defaultAction: form.action,
      defaultExitId: form.action === "exit" ? form.exitId : null,
    });
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={PRIVACY_DEFAULT_ACTION_ROW_TITLE}
      description={PRIVACY_DEFAULT_ACTION_NOTE}
    >
      <div className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label>Default action</Label>
          <Select
            value={form.action}
            onValueChange={(value) => setForm({
              action: value as PrivacyRuleActionKind,
              exitId: value === "exit" ? form.exitId || (exits.length === 1 ? exits[0].id : "") : "",
            })}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="direct">Direct (WAN)</SelectItem>
              <SelectItem value="exit" disabled={exits.length === 0}>Through an exit</SelectItem>
              <SelectItem value="block">Block</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs leading-snug text-muted-foreground">
            {exits.length === 0 ? PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE : PRIVACY_DEFAULT_ACTION_DIRECT_NOTE}
          </p>
        </div>

        {form.action === "exit" && (
          <div className="grid gap-1.5">
            <Label htmlFor="m-privacy-default-exit">Default exit</Label>
            <Select value={form.exitId} onValueChange={(exitId) => setForm({ ...form, exitId })}>
              <SelectTrigger id="m-privacy-default-exit" className="w-full">
                <SelectValue placeholder="Choose an exit" />
              </SelectTrigger>
              <SelectContent>
                {exits.map((exit) => (
                  <SelectItem key={exit.id} value={exit.id}>
                    {exit.enabled ? exit.name : `${exit.name} · disabled`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selected && !selected.enabled && (
              <p className="text-xs leading-snug text-warning">{PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE}</p>
            )}
          </div>
        )}

        <Button type="button" className="w-full" disabled={mutation.isPending} onClick={submit}>
          {mutation.isPending && <Loader2 className="animate-spin" />}Save default action
        </Button>
      </div>
    </BottomSheet>
  );
}

function PrivacyRuleDeleteDialog({
  router,
  rule,
  onClose,
}: {
  router: PrivacyRouterDto;
  rule: PrivacyRoutingRuleDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (ruleId: string) => apiFetch(privacyRuleUrl(router.id, ruleId), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Rule removed. Apply the configuration to update the router.");
      onClose();
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not delete the rule: ${error.message}`),
  });
  return (
    <AlertDialog open={rule !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {rule?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The rule is removed here and the positions below it close up. The router keeps routing by its current
            ruleset until the configuration is applied.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (rule) mutation.mutate(rule.id);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
