"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  isTriggerParamType,
  TRIGGER_PARAM_TYPES,
  type TriggerParam,
  type TriggerParamType,
} from "@/lib/workflows/types";
import { slugifyKey } from "@/components/workflows/lib";

const PARAM_TYPE_LABELS: Record<TriggerParamType, string> = {
  string: "Text",
  number: "Number",
  boolean: "Yes / no",
  network: "Network",
  vm: "Virtual machine",
  device: "Device",
};

const PARAM_TYPES = TRIGGER_PARAM_TYPES.map((value) => ({
  value,
  label: PARAM_TYPE_LABELS[value],
}));

/**
 * Editor for the manual trigger's run parameters (config.params). Keys are
 * auto-slugged from the label until the user edits the key by hand.
 */
export function TriggerParamsEditor({
  params,
  onChange,
  disabled,
}: {
  params: TriggerParam[];
  onChange: (params: TriggerParam[]) => void;
  disabled?: boolean;
}) {
  const keyCounts = new Map<string, number>();
  for (const p of params) keyCounts.set(p.key, (keyCounts.get(p.key) ?? 0) + 1);

  const update = (index: number, patch: Partial<TriggerParam>) => {
    onChange(params.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  };

  const move = (index: number, delta: -1 | 1) => {
    const next = [...params];
    const [param] = next.splice(index, 1);
    next.splice(index + delta, 0, param);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {params.length === 0 && (
        <p className="rounded-md border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No run parameters yet. Parameters become the form shown when this workflow is executed,
          available to every node as{" "}
          <span className="font-mono text-[11px]">{"{{input.<key>}}"}</span>.
        </p>
      )}
      {params.map((param, index) => {
        const duplicate = (keyCounts.get(param.key) ?? 0) > 1;
        return (
          <div key={index} className="space-y-2 rounded-lg border border-border/70 bg-muted/20 p-2.5">
            <div className="flex items-center gap-1">
              <Input
                value={param.label}
                placeholder="Label (e.g. Machine name)"
                disabled={disabled}
                className="h-8"
                onChange={(e) => {
                  const label = e.target.value;
                  // Follow the label with an auto-slug until the key was hand-edited.
                  const autoKey = param.key === slugifyKey(param.label) || param.key === "";
                  update(index, { label, ...(autoKey ? { key: slugifyKey(label) } : {}) });
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                disabled={disabled || index === 0}
                onClick={() => move(index, -1)}
                aria-label="Move up"
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground"
                disabled={disabled || index === params.length - 1}
                onClick={() => move(index, 1)}
                aria-label="Move down"
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7 text-muted-foreground hover:text-destructive"
                disabled={disabled}
                onClick={() => onChange(params.filter((_, i) => i !== index))}
                aria-label="Remove parameter"
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={param.key}
                placeholder="key"
                disabled={disabled}
                className={cn(
                  "h-8 flex-1 font-mono text-xs",
                  duplicate && "border-destructive focus-visible:ring-destructive/40",
                )}
                title={duplicate ? "Duplicate key — keys must be unique" : "Referenced as {{input.<key>}}"}
                onChange={(e) => update(index, { key: slugifyKey(e.target.value) || e.target.value })}
              />
              <Select
                value={param.type}
                onValueChange={(type) => {
                  if (isTriggerParamType(type)) update(index, { type });
                }}
                disabled={disabled}
              >
                <SelectTrigger size="sm" className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PARAM_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Label className="flex items-center gap-1.5 text-xs font-normal text-muted-foreground">
                <Checkbox
                  checked={param.required}
                  disabled={disabled}
                  onCheckedChange={(checked) => update(index, { required: checked === true })}
                />
                Required
              </Label>
              <Input
                value={param.help ?? ""}
                placeholder="Help text (optional)"
                disabled={disabled}
                className="h-8 flex-1 text-xs"
                onChange={(e) =>
                  update(index, { help: e.target.value === "" ? undefined : e.target.value })
                }
              />
            </div>
          </div>
        );
      })}
      {!disabled && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={() =>
            onChange([...params, { key: "", label: "", type: "string", required: true }])
          }
        >
          <Plus className="size-3.5" /> Add parameter
        </Button>
      )}
    </div>
  );
}
