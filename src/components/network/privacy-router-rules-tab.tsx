"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Ban,
  ChevronDown,
  Cpu,
  Gauge,
  Globe,
  Loader2,
  Pencil,
  Plus,
  ScanEye,
  Trash2,
  TriangleAlert,
} from "lucide-react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  movePrivacyRuleOrder,
  privacyAgentRuleSeqs,
  privacyDefaultActionLabel,
  privacyDraftRuleTier,
  vpnRateFieldHelp,
  vpnRateFieldLabel,
  vpnRateLimitView,
  privacyRuleActionLabel,
  privacyRuleCounterView,
  privacyRuleMatchView,
  privacyRuleSpeedHint,
  privacyRuleTierList,
  privacyRuleTierView,
  privacyRulesHaveMixedTiers,
  privacyHostnameMatchExamples,
  PRIVACY_DEFAULT_ACTION_DIRECT_NOTE,
  PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE,
  PRIVACY_DEFAULT_ACTION_NOTE,
  PRIVACY_DEFAULT_ACTION_ROW_TITLE,
  PRIVACY_HOSTNAME_ECH_NOTE,
  PRIVACY_HOSTNAME_ECH_REMEDY_NOTE,
  PRIVACY_HOSTNAME_SCOPE_NOTE,
  PRIVACY_HOSTNAME_WILDCARD_NOTE,
  PRIVACY_QUIC_BLOCKED_NOTE,
  PRIVACY_RULES_EMPTY_STATE,
  PRIVACY_RULE_DISABLED_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_NOTE,
  PRIVACY_RULE_MATCH_BLANK_NOTE,
  PRIVACY_TIER_DERIVED_NOTE,
  PRIVACY_TIER_EXPLAINERS,
  type PrivacyRuleCounterView,
} from "./privacy-router-presentation";
import {
  privacyRouterUrl,
  privacyRuleUrl,
  privacyRulesReorderUrl,
  privacyRulesUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDto,
  type PrivacyRouterDto,
  type PrivacyRoutingRuleDto,
  type PrivacyRoutingRuleInputBody,
  type PrivacyRuleActionKind,
  type PrivacyRuleCounterDto,
  type PrivacyRuleTier,
} from "./privacy-router-types";

/**
 * The Rules tab — the firewall.
 *
 * One ordered, first-match-wins list, exactly as an operator expects a firewall
 * to read: top to bottom, the first row that matches decides the flow. What is
 * NOT ordinary firewall furniture, and is therefore stated on every row, is
 * WHERE the row is enforced: nftables outright (Kernel) or after the userspace
 * proxy has read a hostname (Inspected). That is derived from the whole list,
 * never configured, and moving a rule above the first hostname rule changes it.
 */
export function PrivacyRouterRulesTab({
  router,
  rules,
  exits,
  ruleCounters,
  hasStatus,
  isAdmin,
}: {
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  exits: VpnExitDto[];
  ruleCounters: PrivacyRuleCounterDto[];
  /** False until the router has been read, so counters render "—" not a claim. */
  hasStatus: boolean;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<{ open: boolean; rule: PrivacyRoutingRuleDto | null }>({ open: false, rule: null });
  const [deleting, setDeleting] = useState<PrivacyRoutingRuleDto | null>(null);
  const [defaultOpen, setDefaultOpen] = useState(false);
  const canEdit = isAdmin && router.enabled;

  return (
    <div className="space-y-4">
      <PrivacyRulesHeader router={router} rules={rules} canEdit={canEdit} onAdd={() => setEditing({ open: true, rule: null })} />
      {rules.length === 0 ? (
        <PrivacyRulesEmptyState canEdit={canEdit} onAdd={() => setEditing({ open: true, rule: null })} />
      ) : (
        <PrivacyRulesTable
          router={router}
          rules={rules}
          ruleCounters={ruleCounters}
          hasStatus={hasStatus}
          canEdit={canEdit}
          onEdit={(rule) => setEditing({ open: true, rule })}
          onDelete={setDeleting}
        />
      )}
      <PrivacyDefaultActionRow router={router} exits={exits} canEdit={canEdit} onEdit={() => setDefaultOpen(true)} />

      <PrivacyDefaultActionDialog
        router={router}
        exits={exits}
        open={defaultOpen}
        onOpenChange={setDefaultOpen}
      />

      <PrivacyRuleDialog
        router={router}
        rules={rules}
        exits={exits}
        rule={editing.rule}
        open={editing.open}
        onOpenChange={(open) => setEditing((current) => ({ ...current, open }))}
      />
      <PrivacyRuleDeleteDialog router={router} rule={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

/** The one sentence that makes an ordered list readable, plus the add button. */
function PrivacyRulesHeader({
  router,
  rules,
  canEdit,
  onAdd,
}: {
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  canEdit: boolean;
  onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const mixed = privacyRulesHaveMixedTiers(rules);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border bg-muted/20">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-3 py-2">
        <p className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
          <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="font-medium tabular-nums">{rules.length} rule{rules.length === 1 ? "" : "s"}</span>
          <span className="text-muted-foreground/50" aria-hidden="true">·</span>
          <span className="text-muted-foreground">evaluated top to bottom, first match wins</span>
          {mixed && (
            <>
              <span className="text-muted-foreground/50" aria-hidden="true">·</span>
              <span className="text-muted-foreground">two enforcement tiers in use</span>
            </>
          )}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm">
              How this works
              <ChevronDown className={cn("transition-transform", open && "rotate-180")} aria-hidden="true" />
            </Button>
          </CollapsibleTrigger>
          {canEdit && <Button variant="outline" size="sm" onClick={onAdd}><Plus /> Add rule</Button>}
        </div>
      </div>
      <CollapsibleContent>
        <div className="space-y-2 border-t p-3 text-xs text-muted-foreground">
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

function PrivacyRulesEmptyState({ canEdit, onAdd }: { canEdit: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">{PRIVACY_RULES_EMPTY_STATE.title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{PRIVACY_RULES_EMPTY_STATE.detail}</p>
      {canEdit && <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}><Plus /> Add first rule</Button>}
    </div>
  );
}

function PrivacyRulesTable({
  router,
  rules,
  ruleCounters,
  hasStatus,
  canEdit,
  onEdit,
  onDelete,
}: {
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  ruleCounters: PrivacyRuleCounterDto[];
  hasStatus: boolean;
  canEdit: boolean;
  onEdit: (rule: PrivacyRoutingRuleDto) => void;
  onDelete: (rule: PrivacyRoutingRuleDto) => void;
}) {
  const queryClient = useQueryClient();
  const tiers = privacyRuleTierList(rules);
  // Keyed on the AGENT's sequence, not the stored one: the canonical ruleset
  // renumbers over the enabled rules only, so one disabled rule would otherwise
  // shift every counter below it onto the wrong row.
  const agentSeqs = privacyAgentRuleSeqs(rules);
  const countersBySeq = useMemo(
    () => new Map(ruleCounters.map((counter) => [counter.seq, counter])),
    [ruleCounters],
  );
  const reorder = useMutation({
    mutationFn: (ruleIds: string[]) => apiFetch<PrivacyRoutingRuleDto[]>(privacyRulesReorderUrl(router.id), {
      method: "POST",
      body: JSON.stringify({ ruleIds }),
    }),
    onSuccess: () => {
      toast.success("Reordered. Apply the configuration to push the new order.");
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not reorder the rules: ${error.message}`),
  });

  const move = (rule: PrivacyRoutingRuleDto, direction: -1 | 1) => {
    const order = movePrivacyRuleOrder(rules, rule.id, direction);
    if (order) reorder.mutate(order);
  };

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[3.5rem]">#</TableHead>
            <TableHead className="w-[16rem]">Rule</TableHead>
            <TableHead className="w-[20rem]">Matches</TableHead>
            <TableHead className="w-[11rem]">Action</TableHead>
            <TableHead className="w-[12rem]">Enforced</TableHead>
            <TableHead className="w-[11rem]">Throttle</TableHead>
            <TableHead className="w-[9rem]">Matched bytes</TableHead>
            {canEdit && <TableHead className="w-[7.5rem]"><span className="sr-only">Actions</span></TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rules.map((rule, index) => (
            <PrivacyRuleRow
              key={rule.id}
              rule={rule}
              index={index}
              tier={tiers[index]}
              speedHint={privacyRuleSpeedHint(rules, index)}
              counter={privacyRuleCounterView(tiers[index], counterFor(agentSeqs[index], countersBySeq), hasStatus, rule.enabled)}
              canEdit={canEdit}
              isFirst={index === 0}
              isLast={index === rules.length - 1}
              reordering={reorder.isPending}
              onMove={(direction) => move(rule, direction)}
              onEdit={() => onEdit(rule)}
              onDelete={() => onDelete(rule)}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** No agent sequence means the rule is disabled and the box never rendered it. */
function counterFor(
  agentSeq: number | null,
  counters: Map<number, PrivacyRuleCounterDto>,
): PrivacyRuleCounterDto | undefined {
  return agentSeq === null ? undefined : counters.get(agentSeq);
}

function PrivacyRuleRow({
  rule,
  index,
  tier,
  speedHint,
  counter,
  canEdit,
  isFirst,
  isLast,
  reordering,
  onMove,
  onEdit,
  onDelete,
}: {
  rule: PrivacyRoutingRuleDto;
  index: number;
  tier: PrivacyRuleTier;
  speedHint: string | null;
  counter: PrivacyRuleCounterView;
  canEdit: boolean;
  isFirst: boolean;
  isLast: boolean;
  reordering: boolean;
  onMove: (direction: -1 | 1) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const match = privacyRuleMatchView(rule);
  const inert = privacyRuleInertReason({ action: "direct", proto: rule.proto as "tcp" | "udp" | null, dportSpec: rule.dportSpec, hostname: rule.hostname });
  return (
    <TableRow className={cn(!rule.enabled && "text-muted-foreground")}>
      <TableCell className="align-top font-mono text-xs tabular-nums text-muted-foreground">{index + 1}</TableCell>
      <TableCell className="align-top">
        <p className="text-sm font-medium">{rule.name}</p>
        {!rule.enabled && <Badge variant="outline" className="mt-1 font-normal">Disabled</Badge>}
      </TableCell>
      <TableCell className="align-top">
        <p className="font-mono text-xs break-all">
          {match.source} → {match.destination}
        </p>
        <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">
          {match.ports}
          {match.hostname && <span className="ml-1.5 font-mono text-foreground/80">{match.hostname}</span>}
        </p>
        {inert && (
          <p className="mt-1 flex items-start gap-1 text-[0.6875rem] text-warning">
            <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
            <span>{inert}</span>
          </p>
        )}
      </TableCell>
      <TableCell className="align-top"><PrivacyRuleActionCell rule={rule} /></TableCell>
      <TableCell className="align-top"><PrivacyRuleTierCell tier={tier} speedHint={speedHint} /></TableCell>
      <TableCell className="align-top"><PrivacyRuleThrottleCell tier={tier} rateKbps={rule.rateKbps} /></TableCell>
      <TableCell className="align-top">
        <p className={cn("text-xs tabular-nums", counter.kind === "not-counted" && "text-muted-foreground")} title={counter.detail}>
          {counter.label}
        </p>
      </TableCell>
      {canEdit && (
        <TableCell className="align-top">
          <div className="flex justify-end gap-0.5">
            <Button variant="ghost" size="icon-sm" disabled={isFirst || reordering} aria-label={`Move ${rule.name} up`} onClick={() => onMove(-1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" disabled={isLast || reordering} aria-label={`Move ${rule.name} down`} onClick={() => onMove(1)}><ArrowDown /></Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${rule.name}`} onClick={onEdit}><Pencil /></Button>
            <Button variant="ghost" size="icon-sm" className="text-destructive hover:text-destructive" aria-label={`Delete ${rule.name}`} onClick={onDelete}><Trash2 /></Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

/** An exit the operator has switched off is amber: it will refuse the next apply. */
function PrivacyRuleActionCell({ rule }: { rule: PrivacyRoutingRuleDto }) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs">
        {rule.action === "block" && <Ban className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        <span className="truncate">{privacyRuleActionLabel(rule)}</span>
      </p>
      {rule.exitDisabled && (
        <p className="mt-0.5 flex items-start gap-1 text-[0.6875rem] text-warning">
          <TriangleAlert className="mt-px size-3 shrink-0" aria-hidden="true" />
          <span>{PRIVACY_RULE_EXIT_DISABLED_NOTE}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The Kernel / Inspected badge, and — where one exists — the reorder that would
 * make this row faster. The hint is what turns a derived label into something an
 * operator can act on.
 */
function PrivacyRuleTierCell({ tier, speedHint }: { tier: PrivacyRuleTier; speedHint: string | null }) {
  const view = privacyRuleTierView(tier);
  const Icon = tier === "kernel" ? Cpu : ScanEye;
  return (
    <div className="min-w-0">
      <Badge variant={tier === "kernel" ? "secondary" : "outline"} className="font-normal" title={view.detail}>
        <Icon className="size-3" aria-hidden="true" />
        {view.label}
      </Badge>
      {speedHint && <p className="mt-1 text-[0.6875rem] text-muted-foreground">{speedHint}</p>}
    </div>
  );
}

/**
 * The two throttle mechanisms are never presented as one field. A kernel rule
 * gets a policer that drops and only sees the upstream direction; an inspected
 * rule gets a token bucket that shapes both ways.
 */
function PrivacyRuleThrottleCell({ tier, rateKbps }: { tier: PrivacyRuleTier; rateKbps: number | null }) {
  const view = vpnRateLimitView(tier, rateKbps);
  if (!view) return <span className="text-xs text-muted-foreground">No limit</span>;
  return (
    <p className="flex items-start gap-1.5 text-xs" title={view.detail}>
      <Gauge className="mt-px size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0">
        <span className="block tabular-nums">{view.rate}</span>
        <span className="block text-[0.6875rem] text-muted-foreground">
          {view.mechanism === "policer" ? "policed · drops · upstream only" : "shaped · both directions"}
        </span>
      </span>
    </p>
  );
}

/**
 * The terminal row: what happens to a flow no rule matched.
 *
 * This used to be a dropdown in the add dialog, chosen before a single rule
 * existed. It is the last line of the firewall, and at the foot of the list its
 * meaning is its position — so the row that already SHOWED it is now the row
 * that EDITS it, rather than the value living somewhere the reader has to go
 * looking for.
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
      <p className="min-w-0 text-left text-sm">
        <span className="font-medium">{PRIVACY_DEFAULT_ACTION_ROW_TITLE}</span>
        <span className="ml-1.5 text-muted-foreground">— the router&apos;s default action</span>
      </p>
      <span className="flex shrink-0 items-center gap-1.5">
        <Badge variant="outline" className="font-normal">{label}</Badge>
        {canEdit && <Pencil className="size-3.5 text-muted-foreground" aria-hidden="true" />}
      </span>
    </>
  );
  const className = "flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg border border-dashed px-3 py-2";
  if (!canEdit) return <div className={className}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`Change the default action, currently ${label}`}
      className={cn(className, "transition-colors hover:bg-accent")}
    >
      {body}
    </button>
  );
}

/**
 * Editing the last line of the firewall.
 *
 * `direct` is the shipped default and the safe one: a fresh router changes
 * nothing until a rule opts a service into a tunnel. Choosing an exit here
 * reroutes everything OPNsense points at this box, including devices nobody has
 * written a rule for — so that consequence is stated at the control, not
 * discovered afterwards.
 */
function PrivacyDefaultActionDialog({
  router,
  exits,
  open,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  exits: VpnExitDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const initial = {
    action: router.defaultAction as PrivacyRuleActionKind,
    exitId: router.defaultExitId ?? "",
  };
  const [form, setForm] = useState(initial);
  const current = open ? form : initial;
  const selected = exits.find((exit) => exit.id === current.exitId);
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
    if (current.action === "exit" && !current.exitId) {
      toast.error("Choose the exit the default action routes through.");
      return;
    }
    mutation.mutate({
      defaultAction: current.action,
      defaultExitId: current.action === "exit" ? current.exitId : null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{PRIVACY_DEFAULT_ACTION_ROW_TITLE}</DialogTitle>
          <DialogDescription>{PRIVACY_DEFAULT_ACTION_NOTE}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-1">
          <div className="grid gap-1.5">
            <Label>Default action</Label>
            <Select
              value={current.action}
              onValueChange={(value) => setForm({
                action: value as PrivacyRuleActionKind,
                exitId: value === "exit" ? current.exitId || (exits.length === 1 ? exits[0].id : "") : "",
              })}
            >
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="direct">Direct (WAN)</SelectItem>
                <SelectItem value="exit" disabled={exits.length === 0}>Through an exit</SelectItem>
                <SelectItem value="block">Block</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {exits.length === 0 ? PRIVACY_DEFAULT_ACTION_NO_EXIT_NOTE : PRIVACY_DEFAULT_ACTION_DIRECT_NOTE}
            </p>
          </div>

          {current.action === "exit" && (
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-default-exit">Default exit</Label>
              <Select value={current.exitId} onValueChange={(exitId) => setForm({ ...current, exitId })}>
                <SelectTrigger id="privacy-default-exit" className="w-full">
                  <SelectValue placeholder="Choose an exit" />
                </SelectTrigger>
                <SelectContent>
                  {exits.map((exit) => (
                    <SelectItem key={exit.id} value={exit.id}>
                      <span>{exit.name}</span>
                      <span className="text-xs text-muted-foreground">{exit.enabled ? exit.key : `${exit.key} · disabled`}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selected && !selected.enabled && (
                <p className="text-xs text-warning">{PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE}</p>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
          <Button type="button" disabled={mutation.isPending} onClick={submit}>
            {mutation.isPending && <Loader2 className="animate-spin" />}Save default action
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Rule editor                                                         */
/* ------------------------------------------------------------------ */

interface PrivacyRuleForm {
  ruleId: string | null;
  name: string;
  enabled: boolean;
  action: PrivacyRuleActionKind;
  exitId: string;
  srcCidr: string;
  dstCidr: string;
  proto: "any" | "tcp" | "udp";
  dportSpec: string;
  hostname: string;
  rateKbps: string;
}

const EMPTY_PRIVACY_RULE_FORM: PrivacyRuleForm = {
  ruleId: null,
  name: "",
  enabled: true,
  action: "direct",
  exitId: "",
  srcCidr: "",
  dstCidr: "",
  proto: "any",
  dportSpec: "",
  hostname: "",
  rateKbps: "",
};

function ruleToForm(rule: PrivacyRoutingRuleDto | null): PrivacyRuleForm {
  if (!rule) return EMPTY_PRIVACY_RULE_FORM;
  return {
    ruleId: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    action: rule.action as PrivacyRuleActionKind,
    exitId: rule.exitId ?? "",
    srcCidr: rule.srcCidr ?? "",
    dstCidr: rule.dstCidr ?? "",
    proto: (rule.proto as "tcp" | "udp" | null) ?? "any",
    dportSpec: rule.dportSpec ?? "",
    hostname: rule.hostname ?? "",
    rateKbps: rule.rateKbps === null ? "" : String(rule.rateKbps),
  };
}

/** Strings in, coerced at submit. Empty means "no condition", never `""`. */
function formToBody(form: PrivacyRuleForm): PrivacyRoutingRuleInputBody {
  const rate = Number(form.rateKbps.trim());
  return {
    name: form.name.trim(),
    enabled: form.enabled,
    action: form.action,
    exitId: form.action === "exit" ? form.exitId || null : null,
    srcCidr: form.srcCidr.trim() || null,
    dstCidr: form.dstCidr.trim() || null,
    proto: form.proto === "any" ? null : form.proto,
    dportSpec: form.dportSpec.trim() || null,
    hostname: form.hostname.trim() || null,
    rateKbps: form.rateKbps.trim() && Number.isFinite(rate) && rate > 0 ? Math.round(rate) : null,
  };
}

export function PrivacyRuleDialog({
  router,
  rules,
  exits,
  rule,
  open,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  rules: PrivacyRoutingRuleDto[];
  exits: VpnExitDto[];
  rule: PrivacyRoutingRuleDto | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const initial = useMemo(() => ruleToForm(rule), [rule]);
  const [form, setForm] = useState<PrivacyRuleForm>(initial);
  const current = open && form.ruleId !== initial.ruleId ? initial : form;
  // The tier this rule WILL land on once saved, so the throttle field can be
  // labelled for the mechanism that actually runs. Shared with mobile so both
  // editors preview the same thing.
  const tier = privacyDraftRuleTier(rules, {
    ruleId: current.ruleId,
    hostname: current.hostname,
    enabled: current.enabled,
  });
  const mutation = useMutation({
    mutationFn: (body: PrivacyRoutingRuleInputBody) => apiFetch(
      rule ? privacyRuleUrl(router.id, rule.id) : privacyRulesUrl(router.id),
      { method: rule ? "PATCH" : "POST", body: JSON.stringify(body) },
    ),
    onSuccess: () => {
      toast.success(`${rule ? "Updated" : "Added"} the rule. Apply the configuration when ready.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the rule: ${error.message}`),
  });

  const update = (patch: Partial<PrivacyRuleForm>) => setForm({ ...current, ...patch });
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!current.name.trim()) { toast.error("Give the rule a name so the list stays readable."); return; }
    if (current.action === "exit" && !current.exitId) { toast.error("Choose the exit this rule routes through."); return; }
    mutation.mutate(formToBody(current));
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setForm(initial); onOpenChange(next); }}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{rule ? "Edit" : "Add"} routing rule</DialogTitle>
            <DialogDescription>
              One row of {router.name}&apos;s ordered list. The first rule that matches a flow decides where it leaves.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor="privacy-rule-name">Rule name</Label>
              <Input id="privacy-rule-name" value={current.name} onChange={(event) => update({ name: event.target.value })} placeholder="Streaming through the VPN" autoFocus maxLength={128} />
            </div>

            <PrivacyRuleActionField form={current} exits={exits} onChange={update} />

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-rule-src">Source</Label>
                <Input id="privacy-rule-src" value={current.srcCidr} onChange={(event) => update({ srcCidr: event.target.value })} placeholder="10.0.3.50 or 10.0.3.0/24" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-rule-dst">Destination</Label>
                <Input id="privacy-rule-dst" value={current.dstCidr} onChange={(event) => update({ dstCidr: event.target.value })} placeholder="any" />
              </div>
            </div>
            <p className="-mt-2 text-xs text-muted-foreground">{PRIVACY_RULE_MATCH_BLANK_NOTE}</p>

            <div className="grid gap-3 sm:grid-cols-[0.7fr_1fr]">
              <div className="grid gap-1.5">
                <Label>Protocol</Label>
                <Select value={current.proto} onValueChange={(value) => update({ proto: value as PrivacyRuleForm["proto"] })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="tcp">TCP</SelectItem>
                    <SelectItem value="udp">UDP</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="privacy-rule-ports">Destination ports</Label>
                <Input id="privacy-rule-ports" value={current.dportSpec} onChange={(event) => update({ dportSpec: event.target.value })} placeholder="443 or 80,443 or 8000-8100" />
              </div>
            </div>

            <PrivacyRuleHostnameField value={current.hostname} onChange={(hostname) => update({ hostname })} />

            <PrivacyRuleRateField tier={tier} value={current.rateKbps} disabled={current.action === "block"} onChange={(rateKbps) => update({ rateKbps })} />

            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="privacy-rule-enabled">Rule enabled</Label>
                <p className="text-xs text-muted-foreground">{PRIVACY_RULE_DISABLED_NOTE}</p>
              </div>
              <Switch id="privacy-rule-enabled" checked={current.enabled} onCheckedChange={(enabled) => update({ enabled })} />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}{rule ? "Save rule" : "Add rule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PrivacyRuleActionField({
  form,
  exits,
  onChange,
}: {
  form: PrivacyRuleForm;
  exits: VpnExitDto[];
  onChange: (patch: Partial<PrivacyRuleForm>) => void;
}) {
  const selected = exits.find((exit) => exit.id === form.exitId);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label>Action</Label>
        <Select
          value={form.action}
          onValueChange={(value) => onChange({
            action: value as PrivacyRuleActionKind,
            exitId: value === "exit" ? form.exitId || (exits.length === 1 ? exits[0].id : "") : "",
          })}
        >
          <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="direct">Direct (WAN)</SelectItem>
            <SelectItem value="exit">Through an exit</SelectItem>
            <SelectItem value="block">Block</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {form.action === "exit" && (
        <div className="grid gap-1.5">
          <Label htmlFor="privacy-rule-exit">Exit</Label>
          <Select value={form.exitId} onValueChange={(exitId) => onChange({ exitId })}>
            <SelectTrigger id="privacy-rule-exit" className="w-full"><SelectValue placeholder="Choose an exit" /></SelectTrigger>
            <SelectContent>
              {exits.map((exit) => (
                <SelectItem key={exit.id} value={exit.id}>
                  <span>{exit.name}</span>
                  <span className="text-xs text-muted-foreground">{exit.enabled ? exit.key : `${exit.key} · disabled`}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && !selected.enabled && (
            <p className="text-xs text-warning">{PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE}</p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The two surprising cases are stated where the pattern is typed: a leading `*.`
 * covers the apex, and ECH leaves the proxy matching an outer cover name, so a
 * rule naming the real host silently never fires.
 */
function PrivacyRuleHostnameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const examples = privacyHostnameMatchExamples(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="privacy-rule-hostname">
        Hostname <span className="font-normal text-muted-foreground">(TLS SNI or HTTP Host)</span>
      </Label>
      <Input id="privacy-rule-hostname" value={value} onChange={(event) => onChange(event.target.value)} placeholder="*.netflix.com" maxLength={256} />
      <p className="text-xs text-muted-foreground">{PRIVACY_HOSTNAME_WILDCARD_NOTE}</p>
      <p className="text-xs text-muted-foreground">{PRIVACY_HOSTNAME_SCOPE_NOTE}</p>
      <p className="text-xs text-muted-foreground">{PRIVACY_HOSTNAME_ECH_NOTE}</p>
      {examples.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Matches <span className="font-mono text-foreground/80">{examples.join(", ")}</span>, and anything else under it.
        </p>
      )}
    </div>
  );
}

/**
 * The throttle field is labelled for the mechanism that will actually run. One
 * uniform "rate limit" would promise smooth two-way shaping on a rule that is
 * about to get a prerouting policer instead.
 */
function PrivacyRuleRateField({
  tier,
  value,
  disabled,
  onChange,
}: {
  tier: PrivacyRuleTier;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (disabled) {
    return (
      <Alert>
        <Ban />
        <AlertTitle>A blocked rule has no throughput to limit</AlertTitle>
        <AlertDescription>Switch the action away from Block to set a throttle.</AlertDescription>
      </Alert>
    );
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="privacy-rule-rate">{vpnRateFieldLabel(tier)} <span className="font-normal text-muted-foreground">(optional)</span></Label>
      <Input id="privacy-rule-rate" inputMode="numeric" value={value} onChange={(event) => onChange(event.target.value)} placeholder="8000" />
      <p className="text-xs text-muted-foreground">{vpnRateFieldHelp(tier)}</p>
    </div>
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
            The rule is removed here and the positions below it close up. The router keeps routing by its current ruleset
            until the configuration is applied.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => { event.preventDefault(); if (rule) mutation.mutate(rule.id); }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}Remove rule
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
