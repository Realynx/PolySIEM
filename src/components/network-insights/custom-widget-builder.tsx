"use client";

import { useState } from "react";
import { BarChart3, CircleGauge, Donut, Save, X } from "lucide-react";
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
import {
  CUSTOM_GRAPHIC_DATASETS,
  customGraphicDataset,
  sanitizeCustomGraphicSpec,
  type CustomGraphicSpec,
  type CustomGraphicType,
} from "./custom-specs";
import type { NetworkInsightWidgetSize } from "./types";

const TYPE_LABEL: Record<CustomGraphicType, { label: string; icon: typeof BarChart3 }> = {
  metric: { label: "Metric", icon: CircleGauge },
  bar: { label: "Bar chart", icon: BarChart3 },
  donut: { label: "Donut", icon: Donut },
};

function newSpec(): CustomGraphicSpec {
  return {
    id: `user-${crypto.randomUUID()}`,
    title: "My network graphic",
    dataset: "core",
    measure: "totalEvents",
    visualization: "metric",
    limit: 8,
    size: "compact",
  };
}

export function CustomWidgetBuilder({
  initial,
  onSave,
  onCancel,
}: {
  initial?: CustomGraphicSpec;
  onSave: (spec: CustomGraphicSpec) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<CustomGraphicSpec>(() => initial ?? newSpec());
  const dataset = customGraphicDataset(draft.dataset);
  const safe = sanitizeCustomGraphicSpec(draft);

  return (
    <div className="space-y-4 rounded-lg border border-primary/25 bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">{initial ? "Edit graphic" : "Add a graphic"}</p>
          <p className="text-xs text-muted-foreground">
            Choose from curated Network Insights data; no raw query is executed.
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Close graphic builder"><X /></Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
          <Label htmlFor="custom-graphic-title">Title</Label>
          <Input
            id="custom-graphic-title"
            value={draft.title}
            maxLength={80}
            onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Dataset</Label>
          <Select
            value={draft.dataset}
            onValueChange={(value) => {
              const next = customGraphicDataset(value);
              setDraft((current) => ({
                ...current,
                dataset: next.value,
                measure: next.measures[0].value,
                visualization: next.visualizations[0],
                size: next.sizes[0],
              }));
            }}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CUSTOM_GRAPHIC_DATASETS.map((entry) => (
                <SelectItem key={entry.value} value={entry.value}>{entry.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{dataset.description}</p>
        </div>
        <div className="space-y-1.5">
          <Label>Measure</Label>
          <Select value={draft.measure} onValueChange={(measure) => setDraft((current) => ({ ...current, measure }))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dataset.measures.map((measure) => (
                <SelectItem key={measure.value} value={measure.value}>{measure.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Visualization</Label>
          <Select
            value={draft.visualization}
            onValueChange={(visualization) => setDraft((current) => ({ ...current, visualization: visualization as CustomGraphicType }))}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dataset.visualizations.map((visualization) => {
                const { icon: Icon, label } = TYPE_LABEL[visualization];
                return <SelectItem key={visualization} value={visualization}><Icon className="size-3.5" />{label}</SelectItem>;
              })}
            </SelectContent>
          </Select>
        </div>
        {draft.visualization !== "metric" && (
          <div className="space-y-1.5">
            <Label>Rows / segments</Label>
            <Select value={String(draft.limit)} onValueChange={(limit) => setDraft((current) => ({ ...current, limit: Number(limit) }))}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[3, 5, 8, 10, 15].map((limit) => <SelectItem key={limit} value={String(limit)}>{limit}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label>Widget size</Label>
          <Select value={draft.size} onValueChange={(size) => setDraft((current) => ({ ...current, size: size as NetworkInsightWidgetSize }))}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {dataset.sizes.map((size) => <SelectItem key={size} value={size}>{size === "compact" ? "Compact" : size === "half" ? "Half width" : size === "wide" ? "Wide" : "Full width"}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button size="sm" disabled={!safe || !draft.title.trim()} onClick={() => safe && onSave(safe)}><Save /> Save graphic</Button>
      </div>
    </div>
  );
}
