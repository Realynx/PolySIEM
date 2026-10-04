"use client";

import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import {
  privacyDraftRuleTier,
  privacyHostnameMatchExamples,
  vpnRateFieldHelp,
  vpnRateFieldLabel,
  PRIVACY_HOSTNAME_ECH_NOTE,
  PRIVACY_HOSTNAME_SCOPE_NOTE,
  PRIVACY_HOSTNAME_WILDCARD_NOTE,
  PRIVACY_RULE_DISABLED_NOTE,
  PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE,
  PRIVACY_RULE_MATCH_BLANK_NOTE,
} from "@/components/network/privacy-router-presentation";
import {
  privacyRuleUrl,
  privacyRulesUrl,
  PRIVACY_ROUTER_QUERY_PREFIX,
  type VpnExitDto,
  type PrivacyRouterDto,
  type PrivacyRoutingRuleDto,
  type PrivacyRoutingRuleInputBody,
  type PrivacyRuleActionKind,
  type PrivacyRuleTier,
} from "@/components/network/privacy-router-types";
import { PrivacyNotice } from "./mobile-privacy-atoms";

/**
 * Add or edit one routing rule, in a bottom sheet, against the same endpoints
 * the desktop dialog posts to.
 *
 * The one thing this form must not simplify is the throttle. A rule that lands
 * in the kernel gets an nftables policer that DROPS and only sees traffic on its
 * way out of the LAN; a rule that lands on the inspected path gets a token
 * bucket in the proxy that SHAPES both ways. So the field is labelled for the
 * tier the draft will actually land in — computed by `privacyDraftRuleTier` from the
 * list this rule is going into, which is also what the desktop editor uses.
 */

interface PrivacyRuleFormState {
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

function seedVpnRuleForm(rule: PrivacyRoutingRuleDto | null): PrivacyRuleFormState {
  if (!rule) {
    return {
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
  }
  return {
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
function privacyRuleBodyFrom(form: PrivacyRuleFormState): PrivacyRoutingRuleInputBody {
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

/** The one message to toast when the form cannot be submitted, or null. */
function privacyRuleFormError(form: PrivacyRuleFormState): string | null {
  if (!form.name.trim()) return "Give the rule a name so the list stays readable.";
  if (form.action === "exit" && !form.exitId) return "Choose the exit this rule routes through.";
  return null;
}

function PrivacyRuleActionFields({
  form,
  exits,
  update,
}: {
  form: PrivacyRuleFormState;
  exits: VpnExitDto[];
  update: (patch: Partial<PrivacyRuleFormState>) => void;
}) {
  const selected = exits.find((exit) => exit.id === form.exitId);
  return (
    <>
      <div className="grid gap-1.5">
        <Label>Action</Label>
        <Select
          value={form.action}
          onValueChange={(value) =>
            update({
              action: value as PrivacyRuleActionKind,
              exitId: value === "exit" ? form.exitId || (exits.length === 1 ? exits[0].id : "") : "",
            })
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="direct">Direct (WAN)</SelectItem>
            <SelectItem value="exit">Through an exit</SelectItem>
            <SelectItem value="block">Block</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {form.action === "exit" && (
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-rule-exit">Exit</Label>
          <Select value={form.exitId} onValueChange={(exitId) => update({ exitId })}>
            <SelectTrigger id="m-privacy-rule-exit" className="w-full">
              <SelectValue placeholder="Choose an exit" />
            </SelectTrigger>
            <SelectContent>
              {exits.map((exit) => (
                <SelectItem key={exit.id} value={exit.id}>
                  {exit.name} · {exit.enabled ? exit.key : `${exit.key} · disabled`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && !selected.enabled && (
            <PrivacyNotice tone="warning" detail={PRIVACY_RULE_EXIT_DISABLED_EDITOR_NOTE} />
          )}
        </div>
      )}
    </>
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
      <Label htmlFor="m-privacy-rule-hostname">
        Hostname <span className="font-normal text-muted-foreground">(TLS SNI or HTTP Host)</span>
      </Label>
      <Input
        id="m-privacy-rule-hostname"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="*.netflix.com"
        autoCapitalize="none"
        autoComplete="off"
        spellCheck={false}
        maxLength={256}
      />
      <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_HOSTNAME_WILDCARD_NOTE}</p>
      <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_HOSTNAME_SCOPE_NOTE}</p>
      <p className="text-xs leading-snug text-muted-foreground">{PRIVACY_HOSTNAME_ECH_NOTE}</p>
      {examples.length > 1 && (
        <p className="text-xs leading-snug text-muted-foreground">
          Matches <span className="font-mono text-foreground/80">{examples.join(", ")}</span>, and anything else under it.
        </p>
      )}
    </div>
  );
}

/**
 * Labelled for the mechanism that will actually run. One uniform "rate limit"
 * would promise smooth two-way shaping on a rule that is about to get a
 * prerouting policer instead.
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
      <PrivacyNotice
        tone="info"
        title="A blocked rule has no throughput to limit"
        detail="Switch the action away from Block to set a throttle."
      />
    );
  }
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="m-privacy-rule-rate">
        {vpnRateFieldLabel(tier)} <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Input
        id="m-privacy-rule-rate"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="8000"
      />
      <p className="text-xs leading-snug text-muted-foreground">{vpnRateFieldHelp(tier)}</p>
    </div>
  );
}

function PrivacyRuleMatchFields({
  form,
  update,
}: {
  form: PrivacyRuleFormState;
  update: (patch: Partial<PrivacyRuleFormState>) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-rule-src">Source</Label>
        <Input
          id="m-privacy-rule-src"
          value={form.srcCidr}
          onChange={(event) => update({ srcCidr: event.target.value })}
          placeholder="10.0.3.50 or 10.0.3.0/24"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="m-privacy-rule-dst">Destination</Label>
        <Input
          id="m-privacy-rule-dst"
          value={form.dstCidr}
          onChange={(event) => update({ dstCidr: event.target.value })}
          placeholder="any"
          autoCapitalize="none"
          spellCheck={false}
        />
        <p className="text-xs text-muted-foreground">{PRIVACY_RULE_MATCH_BLANK_NOTE}</p>
      </div>
      <div className="grid grid-cols-[0.7fr_1fr] gap-3">
        <div className="grid gap-1.5">
          <Label>Protocol</Label>
          <Select value={form.proto} onValueChange={(value) => update({ proto: value as PrivacyRuleFormState["proto"] })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any</SelectItem>
              <SelectItem value="tcp">TCP</SelectItem>
              <SelectItem value="udp">UDP</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-rule-ports">Destination ports</Label>
          <Input
            id="m-privacy-rule-ports"
            value={form.dportSpec}
            onChange={(event) => update({ dportSpec: event.target.value })}
            placeholder="443 or 80,443"
            inputMode="numeric"
          />
        </div>
      </div>
    </>
  );
}

export function MobilePrivacyRuleSheet({
  router,
  rules,
  exits,
  rule,
  onOpenChange,
}: {
  router: PrivacyRouterDto;
  /** The list this rule is going into — it decides the draft's tier. */
  rules: PrivacyRoutingRuleDto[];
  exits: VpnExitDto[];
  /** Null adds a rule at the end of the list; a value edits that one. */
  rule: PrivacyRoutingRuleDto | null;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PrivacyRuleFormState>(() => seedVpnRuleForm(rule));
  const update = (patch: Partial<PrivacyRuleFormState>) => setForm((current) => ({ ...current, ...patch }));
  const tier = privacyDraftRuleTier(rules, {
    ruleId: rule?.id ?? null,
    hostname: form.hostname,
    enabled: form.enabled,
  });

  const mutation = useMutation({
    mutationFn: (body: PrivacyRoutingRuleInputBody) =>
      apiFetch(rule ? privacyRuleUrl(router.id, rule.id) : privacyRulesUrl(router.id), {
        method: rule ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success(`${rule ? "Updated" : "Added"} the rule. Apply the configuration when ready.`);
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: PRIVACY_ROUTER_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the rule: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const error = privacyRuleFormError(form);
    if (error) {
      toast.error(error);
      return;
    }
    mutation.mutate(privacyRuleBodyFrom(form));
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${rule ? "Edit" : "Add"} routing rule`}
      description={`One row of ${router.name}'s ordered list. The first rule that matches a flow decides where it leaves.`}
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-privacy-rule-name">Rule name</Label>
          <Input
            id="m-privacy-rule-name"
            value={form.name}
            onChange={(event) => update({ name: event.target.value })}
            placeholder="Streaming through the VPN"
            maxLength={128}
          />
        </div>

        <PrivacyRuleActionFields form={form} exits={exits} update={update} />
        <PrivacyRuleMatchFields form={form} update={update} />
        <PrivacyRuleHostnameField value={form.hostname} onChange={(hostname) => update({ hostname })} />
        <PrivacyRuleRateField
          tier={tier}
          value={form.rateKbps}
          disabled={form.action === "block"}
          onChange={(rateKbps) => update({ rateKbps })}
        />

        <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
          <div className="min-w-0">
            <Label htmlFor="m-privacy-rule-enabled">Rule enabled</Label>
            <p className="text-xs text-muted-foreground">{PRIVACY_RULE_DISABLED_NOTE}</p>
          </div>
          <Switch id="m-privacy-rule-enabled" checked={form.enabled} onCheckedChange={(enabled) => update({ enabled })} />
        </div>

        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2 className="animate-spin" />}
          {rule ? "Save rule" : "Add rule"}
        </Button>
      </form>
    </BottomSheet>
  );
}
