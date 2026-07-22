"use client";

import { KeyRound, Trash2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { isTriggerKind, type NodeTypeMeta } from "@/lib/workflows/types";
import { CopyButton } from "@/components/ssh/copy-button";
import { parseTriggerParams, type TemplateVarGroup } from "@/components/workflows/lib";
import { categoryMeta } from "@/components/workflows/meta";
import { FieldInput } from "@/components/workflows/field-input";
import { TriggerParamsEditor } from "@/components/workflows/trigger-params-editor";
import type { BuilderFlowNode } from "@/components/workflows/builder-node";

/** Read-only hook URL block for a webhook trigger (token lives in its config). */
function WebhookUrlBlock({ token }: { token: string }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const url = `${origin}/api/workflows/hooks/${token}`;
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">Hook URL</p>
      {token === "" ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
          Save the workflow to generate this trigger&apos;s secret hook URL.
        </p>
      ) : (
        <>
          <div className="flex items-center gap-1">
            <Input readOnly value={url} className="font-mono text-xs" aria-label="Hook URL" />
            <CopyButton value={url} label="Copy hook URL" />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            POST a JSON object matching the parameters. The secret token in the URL is the only
            authentication — treat it like a password.
          </p>
        </>
      )}
    </div>
  );
}

function NodeIssues({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-2.5">
      {issues.map((issue, index) => <p key={index} className="flex items-start gap-1.5 text-xs text-destructive"><TriangleAlert className="mt-px size-3.5 shrink-0" />{issue}</p>)}
    </div>
  );
}

function NodeDescription({ description }: { description?: string }) {
  if (!description) return null;
  return <p className="text-xs leading-snug text-muted-foreground">{description}</p>;
}

function NodeConfigurationFields({
  node, meta, paramsTrigger, readOnly, templateGroups, onChangeConfig, setField,
}: {
  node: BuilderFlowNode;
  meta: NodeTypeMeta | null;
  paramsTrigger: boolean;
  readOnly: boolean;
  templateGroups: TemplateVarGroup[];
  onChangeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  setField: (key: string, value: unknown) => void;
}) {
  if (paramsTrigger) {
    return <div className="space-y-2"><p className="text-xs font-medium">Run parameters</p><TriggerParamsEditor params={parseTriggerParams(node.data.config)} disabled={readOnly} onChange={(params) => onChangeConfig(node.id, { ...node.data.config, params })} /></div>;
  }
  if (!meta) return <p className="text-xs text-muted-foreground">Unknown node type — the catalog does not describe it.</p>;
  if (meta.inputs.length === 0) return <p className="text-xs text-muted-foreground">This node has no settings.</p>;
  return meta.inputs.map((field) => <FieldInput key={field.key} field={field} value={node.data.config[field.key]} onChange={(value) => setField(field.key, value)} templateGroups={templateGroups} disabled={readOnly} />);
}

function NodeOutputs({ node, meta }: { node: BuilderFlowNode; meta: NodeTypeMeta | null }) {
  if (!meta || meta.outputs.length === 0) return null;
  return <><Separator /><div className="space-y-1.5"><p className="text-xs font-medium">Outputs</p><ul className="space-y-1">{meta.outputs.map((output) => (
    <li key={output.key} className="flex items-center gap-1.5 text-xs">
      <span className="min-w-0 flex-1 truncate text-muted-foreground">{output.label}</span>
      {output.secret && <span title="Secret — shown once after a run, never stored"><KeyRound className="size-3 shrink-0 text-warning" /></span>}
      <code className="max-w-44 shrink-0 truncate rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">{`{{nodes.${node.id}.${output.key}}}`}</code>
    </li>
  ))}</ul><p className="text-[11px] leading-snug text-muted-foreground/70">Downstream nodes can reference these from their template picker.</p></div></>;
}

function TriggerKindSelector({
  trigger, triggerKinds, node, readOnly, onChangeKind,
}: {
  trigger: boolean;
  triggerKinds: NodeTypeMeta[];
  node: BuilderFlowNode;
  readOnly: boolean;
  onChangeKind: (nodeId: string, kind: string) => void;
}) {
  if (!trigger || triggerKinds.length <= 1) return null;
  return (
    <div className="space-y-1.5">
      <Label htmlFor="wf-trigger-kind" className="text-xs">Trigger type</Label>
      <Select value={node.data.kind} onValueChange={(kind) => { if (kind !== node.data.kind) onChangeKind(node.id, kind); }} disabled={readOnly}>
        <SelectTrigger id="wf-trigger-kind" className="w-full"><SelectValue placeholder="Select a trigger type…" /></SelectTrigger>
        <SelectContent>{triggerKinds.map((kind) => <SelectItem key={kind.kind} value={kind.kind}>{kind.title}</SelectItem>)}</SelectContent>
      </Select>
    </div>
  );
}

/**
 * Right-hand overlay editing the selected node. Rendered 100% dynamically from
 * the node kind's FieldSpec list (trigger nodes edit their TriggerParam list
 * instead) — no per-action forms exist anywhere in the builder.
 */
export function ConfigPanel({
  node,
  templateGroups,
  triggerKinds,
  readOnly,
  onChangeConfig,
  onChangeLabel,
  onChangeKind,
  onDelete,
  onClose,
}: {
  node: BuilderFlowNode;
  templateGroups: TemplateVarGroup[];
  /** Catalog entries for every "trigger.*" kind — drives the trigger-type select. */
  triggerKinds: NodeTypeMeta[];
  readOnly: boolean;
  onChangeConfig: (nodeId: string, config: Record<string, unknown>) => void;
  onChangeLabel: (nodeId: string, label: string | null) => void;
  /** Swap a trigger node to another trigger kind (config migrated by the builder). */
  onChangeKind: (nodeId: string, kind: string) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}) {
  const { meta } = node.data;
  const cat = categoryMeta(meta?.category);
  const Icon = cat.icon;
  const trigger = isTriggerKind(node.data.kind);
  // Manual + webhook declare no config fields and edit a run-param list
  // instead; every other trigger flavor (schedule, Elasticsearch) declares
  // real FieldSpecs and gets the generic form.
  const paramsTrigger = trigger && (meta?.inputs.length ?? 0) === 0;

  const setField = (key: string, value: unknown) => {
    const next = { ...node.data.config };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChangeConfig(node.id, next);
  };

  return (
    <div className="absolute inset-y-3 right-3 z-10 flex w-[340px] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-xl border border-border bg-card/95 shadow-md backdrop-blur">
      <div className="flex items-center gap-2.5 border-b border-border/70 px-4 py-3">
        <div className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", cat.bg)}>
          <Icon className={cn("size-4", cat.fg)} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{meta?.title ?? node.data.kind}</p>
          <p className="truncate font-mono text-[10px] text-muted-foreground">{node.data.kind}</p>
        </div>
        <Button variant="ghost" size="icon" className="size-6" onClick={onClose} aria-label="Close panel">
          <X className="size-4" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <NodeIssues issues={node.data.issues} />

        <NodeDescription description={meta?.description} />

        <div className="space-y-1.5">
          <Label htmlFor="wf-node-label" className="text-xs">
            Display name
          </Label>
          <Input
            id="wf-node-label"
            value={node.data.label ?? ""}
            placeholder={meta?.title ?? "Node name"}
            disabled={readOnly}
            onChange={(e) => onChangeLabel(node.id, e.target.value === "" ? null : e.target.value)}
          />
        </div>

        <Separator />

        <TriggerKindSelector {...{ trigger, triggerKinds, node, readOnly, onChangeKind }} />

        {node.data.kind === "trigger.webhook" && !readOnly && (
          <WebhookUrlBlock
            token={typeof node.data.config.token === "string" ? node.data.config.token : ""}
          />
        )}

        <NodeConfigurationFields {...{ node, meta, paramsTrigger, readOnly, templateGroups, onChangeConfig, setField }} />

        <NodeOutputs node={node} meta={meta} />
      </div>

      {!readOnly && (
        <div className="border-t border-border/70 p-3">
          <Button
            variant="outline"
            size="sm"
            className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(node.id)}
          >
            <Trash2 className="size-3.5" /> Remove node
          </Button>
        </div>
      )}
    </div>
  );
}
