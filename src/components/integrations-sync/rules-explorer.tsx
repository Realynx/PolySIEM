"use client";

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Search, ShieldCheck, StickyNote } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/empty-state";
import { ExplainRuleButton, useAiModels } from "@/components/ai";
import { cn } from "@/lib/utils";
import { filterFirewallRules, firewallInterfaceNames, referencedFirewallAliases } from "./firewall-rule-model";

export interface FirewallRuleDto {
  id: string;
  sequence: number | null;
  action: "PASS" | "BLOCK" | "REJECT";
  interfaceName: string | null;
  direction: string | null;
  protocol: string | null;
  sourceSpec: string | null;
  destSpec: string | null;
  destPort: string | null;
  descriptionText: string | null;
  enabled: boolean;
  status: string;
  annotation: string | null;
  metadata: Record<string, unknown> | null;
}

export interface FirewallAliasDto {
  name: string;
  aliasType: string | null;
  content: string[];
}

const ACTION_STYLES: Record<FirewallRuleDto["action"], string> = {
  PASS: "border-success/40 bg-success/10 text-success",
  BLOCK: "border-destructive/40 bg-destructive/10 text-destructive",
  REJECT: "border-warning/40 bg-warning/10 text-warning",
};

function ActionBadge({ action }: { action: FirewallRuleDto["action"] }) {
  return (
    <Badge variant="outline" className={cn("w-16 justify-center font-mono text-[11px]", ACTION_STYLES[action])}>
      {action}
    </Badge>
  );
}

/** Alias-content chips shown when a rule references an alias by name. */
function AliasExpansion({ label, alias }: { label: string; alias: FirewallAliasDto }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">
        {label} alias <span className="font-mono">{alias.name}</span> ({alias.aliasType ?? "?"}):
      </span>
      {alias.content.map((entry) => (
        <Badge key={entry} variant="outline" className="font-mono text-[11px]">
          {entry}
        </Badge>
      ))}
    </div>
  );
}

function AnnotationEditor({
  rule,
  onSaved,
}: {
  rule: FirewallRuleDto;
  onSaved: (annotation: string | null) => void;
}) {
  const [draft, setDraft] = useState(rule.annotation ?? "");
  const mutation = useMutation({
    mutationFn: async (annotation: string | null) => {
      const res = await fetch(`/api/firewall/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ annotation }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message ?? `Save failed (HTTP ${res.status})`);
      return body.data as { annotation: string | null };
    },
    onSuccess: (data) => {
      toast.success("Annotation saved");
      onSaved(data.annotation);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save annotation"),
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <StickyNote className="size-3.5" />
        Operator annotation (survives syncs)
      </div>
      <Textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Why does this rule exist? Who asked for it? Link a doc page…"
        rows={3}
      />
      <Button
        size="sm"
        disabled={mutation.isPending || draft === (rule.annotation ?? "")}
        onClick={() => mutation.mutate(draft.trim() === "" ? null : draft)}
      >
        {mutation.isPending ? "Saving…" : "Save annotation"}
      </Button>
    </div>
  );
}

function RuleDetails({
  open, rule, aiEnabled, aliases, onAnnotationSaved,
}: {
  open: boolean;
  rule: FirewallRuleDto;
  aiEnabled: boolean;
  aliases: Map<string, FirewallAliasDto>;
  onAnnotationSaved: (id: string, annotation: string | null) => void;
}) {
  if (!open) return null;
  const referencedAliases = referencedFirewallAliases(rule, aliases);
  return (
    <div className="space-y-4 border-t bg-muted/30 px-4 py-3">
      {aiEnabled && <div className="flex items-center gap-1.5"><ExplainRuleButton ruleId={rule.id} /><span className="text-xs text-muted-foreground">Explain this rule with AI</span></div>}
      {rule.annotation && <div className="flex items-start gap-2 rounded-md border border-info/30 bg-info/5 p-2.5 text-sm"><StickyNote className="mt-0.5 size-4 shrink-0 text-info" /><p className="whitespace-pre-wrap">{rule.annotation}</p></div>}
      {referencedAliases.length > 0 && <div className="space-y-1.5">{referencedAliases.map(({ label, alias }) => <AliasExpansion key={`${label}-${alias.name}`} label={label} alias={alias} />)}</div>}
      <AnnotationEditor rule={rule} onSaved={(annotation) => onAnnotationSaved(rule.id, annotation)} />
      {rule.metadata && <details><summary className="cursor-pointer text-xs font-medium text-muted-foreground">Raw rule metadata</summary><pre className="mt-2 max-h-64 overflow-auto rounded-md border bg-background p-3 text-xs">{JSON.stringify(rule.metadata, null, 2)}</pre></details>}
    </div>
  );
}

function RuleRow({
  rule,
  aliases,
  onAnnotationSaved,
}: {
  rule: FirewallRuleDto;
  aliases: Map<string, FirewallAliasDto>;
  onAnnotationSaved: (id: string, annotation: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const { data: aiInfo } = useAiModels();
  const aiEnabled = Boolean(aiInfo?.enabled);

  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "grid w-full grid-cols-[auto_auto_1fr] items-center gap-x-3 gap-y-1 px-3 py-2 text-left text-sm hover:bg-muted/50 sm:grid-cols-[1.25rem_2rem_4.5rem_5rem_minmax(0,1.4fr)_minmax(0,1fr)_auto]",
          !rule.enabled && "opacity-50",
        )}
      >
        {open ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
        <span className="font-mono text-xs text-muted-foreground">{rule.sequence ?? "—"}</span>
        <ActionBadge action={rule.action} />
        <span className="hidden font-mono text-xs text-muted-foreground sm:block">{rule.protocol ?? "any"}</span>
        <span className="truncate font-mono text-xs">
          {rule.sourceSpec ?? "any"}
          <span className="mx-1 text-muted-foreground">→</span>
          {rule.destSpec ?? "any"}
          {rule.destPort ? <span className="text-muted-foreground">:{rule.destPort}</span> : null}
        </span>
        <span className="col-span-2 truncate text-xs text-muted-foreground sm:col-span-1">
          {rule.descriptionText ?? ""}
        </span>
        <span className="flex items-center gap-1.5 justify-self-end">
          {!rule.enabled && (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              disabled
            </Badge>
          )}
          {rule.annotation ? <StickyNote className="size-3.5 text-info" aria-label="Has annotation" /> : null}
        </span>
      </button>
      <RuleDetails {...{ open, rule, aiEnabled, aliases, onAnnotationSaved }} />
    </div>
  );
}

export function RulesExplorer({
  rules: initialRules,
  aliases,
}: {
  rules: FirewallRuleDto[];
  aliases: FirewallAliasDto[];
}) {
  const [rules, setRules] = useState(initialRules);
  const [iface, setIface] = useState<string>("all");
  const [action, setAction] = useState<string>("all");
  const [q, setQ] = useState("");

  const aliasMap = useMemo(() => new Map(aliases.map((a) => [a.name, a])), [aliases]);
  const interfaceNames = useMemo(
    () => firewallInterfaceNames(rules),
    [rules],
  );

  const filtered = useMemo(
    () => filterFirewallRules(rules, { iface, action, query: q }),
    [rules, iface, action, q],
  );

  const groups = useMemo(() => {
    const map = new Map<string, FirewallRuleDto[]>();
    for (const rule of filtered) {
      const key = rule.interfaceName ?? "Unassigned";
      const list = map.get(key) ?? [];
      list.push(rule);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0));
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filtered]);

  const onAnnotationSaved = (id: string, annotation: string | null) =>
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, annotation } : r)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search rules…"
            className="w-64 pl-8"
            aria-label="Filter rules"
          />
        </div>
        <Select value={iface} onValueChange={setIface}>
          <SelectTrigger className="w-40" aria-label="Filter by interface">
            <SelectValue placeholder="Interface" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All interfaces</SelectItem>
            {interfaceNames.map((name) => (
              <SelectItem key={name} value={name}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-32" aria-label="Filter by action">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            <SelectItem value="PASS">Pass</SelectItem>
            <SelectItem value="BLOCK">Block</SelectItem>
            <SelectItem value="REJECT">Reject</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          {filtered.length} of {rules.length} rules
        </span>
      </div>

      {groups.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No rules match"
          description="Try a different search, interface, or action filter."
        />
      ) : (
        groups.map(([name, groupRules]) => (
          <Collapsible key={name} defaultOpen>
            <div className="overflow-hidden rounded-lg border">
              <CollapsibleTrigger className="flex w-full items-center gap-2 bg-muted/50 px-3 py-2 text-sm font-medium hover:bg-muted [&[data-state=closed]_.chev]:-rotate-90">
                <ChevronDown className="chev size-4 text-muted-foreground transition-transform" />
                {name}
                <Badge variant="outline" className="ml-1 text-[11px] text-muted-foreground">
                  {groupRules.length}
                </Badge>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="border-t">
                  {groupRules.map((rule) => (
                    <RuleRow key={rule.id} rule={rule} aliases={aliasMap} onAnnotationSaved={onAnnotationSaved} />
                  ))}
                </div>
              </CollapsibleContent>
            </div>
          </Collapsible>
        ))
      )}
    </div>
  );
}
