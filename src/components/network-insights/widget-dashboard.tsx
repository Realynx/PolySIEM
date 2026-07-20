"use client";

import {
  Component,
  useEffect,
  useMemo,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  LayoutDashboard,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Settings2,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { NetworkInsightsResponse } from "@/lib/types";
import { DEFAULT_NETWORK_INSIGHT_WIDGETS } from "./default-widgets";
import { CustomWidgetBuilder } from "./custom-widget-builder";
import { customGraphicDefinition } from "./custom-widgets";
import {
  CUSTOM_GRAPHIC_VERSION,
  deleteCustomGraphic,
  parseCustomGraphicStore,
  upsertCustomGraphic,
  type CustomGraphicSpec,
} from "./custom-specs";
import {
  defaultNetworkInsightLayout,
  moveNetworkInsightWidget,
  parseNetworkInsightLayout,
  reconcileNetworkInsightLayout,
  reorderNetworkInsightWidgets,
  updateNetworkInsightWidget,
} from "./layout";
import type {
  NetworkInsightWidgetDefinition,
  NetworkInsightWidgetLayout,
  NetworkInsightWidgetSize,
} from "./types";

const DEFAULT_STORAGE_KEY = "polysiem.network-insights.widgets.v1";
const ALL_SIZES: readonly NetworkInsightWidgetSize[] = [
  "compact",
  "half",
  "wide",
  "full",
];
const SIZE_LABEL: Record<NetworkInsightWidgetSize, string> = {
  compact: "Compact",
  half: "Half width",
  wide: "Wide",
  full: "Full width",
};
const SIZE_CLASS: Record<NetworkInsightWidgetSize, string> = {
  compact: "xl:col-span-4",
  half: "xl:col-span-6",
  wide: "xl:col-span-8",
  full: "xl:col-span-12",
};

class WidgetErrorBoundary extends Component<
  { title: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[network-insights] widget "${this.props.title}" failed`, error, info);
  }

  render() {
    return this.state.failed ? (
      <p className="text-xs text-destructive">This widget could not be rendered.</p>
    ) : (
      this.props.children
    );
  }
}

function writeLayout(storageKey: string, layout: NetworkInsightWidgetLayout): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(layout));
  } catch {
    // Storage may be unavailable in private/restricted browser contexts.
  }
}

function WidgetSettings({
  definitions,
  layout,
  customSpecs,
  onChange,
  onReset,
  onSaveCustom,
  onDeleteCustom,
}: {
  definitions: readonly NetworkInsightWidgetDefinition[];
  layout: NetworkInsightWidgetLayout;
  customSpecs: readonly CustomGraphicSpec[];
  onChange: (layout: NetworkInsightWidgetLayout) => void;
  onReset: () => void;
  onSaveCustom: (spec: CustomGraphicSpec) => void;
  onDeleteCustom: (id: string) => void;
}) {
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const customById = new Map(customSpecs.map((spec) => [spec.id, spec]));
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? customById.get(editingId) : undefined;
  return (
    <Card className="border-primary/20 bg-muted/20">
      <CardHeader className="border-b">
        <CardTitle>Customize dashboard</CardTitle>
        <div className="flex items-center gap-2">
          <p className="flex-1 text-xs text-muted-foreground">
            Show, size and order widgets. Changes are saved in this browser.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { setEditingId(null); setBuilderOpen(true); }}
          >
            <Plus /> Add graphic
          </Button>
          <Button variant="outline" size="sm" onClick={onReset}>
            <RotateCcw /> Reset defaults
          </Button>
        </div>
      </CardHeader>
      {builderOpen && (
        <div className="border-b p-4">
          <CustomWidgetBuilder
            key={editing?.id ?? "new-graphic"}
            initial={editing}
            onCancel={() => { setBuilderOpen(false); setEditingId(null); }}
            onSave={(spec) => {
              onSaveCustom(spec);
              setBuilderOpen(false);
              setEditingId(null);
            }}
          />
        </div>
      )}
      <CardContent className="divide-y p-0">
        {layout.items.map((item, index) => {
          const definition = byId.get(item.id);
          if (!definition) return null;
          const sizes = definition.allowedSizes ?? ALL_SIZES;
          return (
            <div key={item.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <Checkbox
                  id={`widget-visible-${item.id}`}
                  checked={item.visible}
                  onCheckedChange={(checked) =>
                    onChange(
                      updateNetworkInsightWidget(layout, item.id, {
                        visible: checked === true,
                      }),
                    )
                  }
                />
                <Label htmlFor={`widget-visible-${item.id}`} className="min-w-40 flex-1">
                  <span className="block text-sm font-medium">{definition.title}</span>
                  <span className="block text-xs font-normal text-muted-foreground">
                    {definition.description}
                  </span>
                </Label>
                <Select
                  value={item.size}
                  onValueChange={(size) =>
                    onChange(
                      updateNetworkInsightWidget(layout, item.id, {
                        size: size as NetworkInsightWidgetSize,
                      }),
                    )
                  }
                >
                  <SelectTrigger size="sm" className="w-32" aria-label={`${definition.title} size`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {sizes.map((size) => (
                      <SelectItem key={size} value={size}>{SIZE_LABEL[size]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <div className="flex items-center">
                  {customById.has(item.id) && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${definition.title}`}
                        onClick={() => { setEditingId(item.id); setBuilderOpen(true); }}
                      ><Pencil /></Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-destructive"
                        aria-label={`Delete ${definition.title}`}
                        onClick={() => onDeleteCustom(item.id)}
                      ><Trash2 /></Button>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === 0}
                    aria-label={`Move ${definition.title} up`}
                    onClick={() => onChange(moveNetworkInsightWidget(layout, item.id, -1))}
                  ><ChevronUp /></Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={index === layout.items.length - 1}
                    aria-label={`Move ${definition.title} down`}
                    onClick={() => onChange(moveNetworkInsightWidget(layout, item.id, 1))}
                  ><ChevronDown /></Button>
                </div>
              </div>
              {(definition.settings?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-x-6 gap-y-2 pl-7">
                  {definition.settings?.map((setting) => {
                    const value = item.config[setting.key];
                    if (setting.type === "toggle") {
                      return (
                        <Label key={setting.key} className="flex items-center gap-2 text-xs font-normal">
                          <Switch
                            checked={value === true}
                            onCheckedChange={(checked) =>
                              onChange(updateNetworkInsightWidget(layout, item.id, {
                                config: { [setting.key]: checked },
                              }))
                            }
                          />
                          {setting.label}
                        </Label>
                      );
                    }
                    return (
                      <div key={setting.key} className="flex items-center gap-2">
                        <Label className="text-xs font-normal">{setting.label}</Label>
                        <Select
                          value={String(value)}
                          onValueChange={(selected) => {
                            const option = setting.options?.find((entry) => String(entry.value) === selected);
                            if (!option) return;
                            onChange(updateNetworkInsightWidget(layout, item.id, {
                              config: { [setting.key]: option.value },
                            }));
                          }}
                        >
                          <SelectTrigger size="sm" className="w-32"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {setting.options?.map((option) => (
                              <SelectItem key={String(option.value)} value={String(option.value)}>{option.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

export interface NetworkInsightsWidgetDashboardProps {
  data: NetworkInsightsResponse;
  isRefreshing?: boolean;
  windowLabel?: string;
  /** Override to scope persistence by user or dashboard instance. */
  storageKey?: string;
  /** Pass defaults plus custom definitions to extend the dashboard. */
  definitions?: readonly NetworkInsightWidgetDefinition[];
  className?: string;
}

/** Reorderable, configurable visualization surface for Network Insights data. */
export function NetworkInsightsWidgetDashboard({
  data,
  isRefreshing = false,
  windowLabel,
  storageKey = DEFAULT_STORAGE_KEY,
  definitions = DEFAULT_NETWORK_INSIGHT_WIDGETS,
  className,
}: NetworkInsightsWidgetDashboardProps) {
  const registryKey = definitions.map((definition) => definition.id).join("\u0000");
  const [layout, setLayout] = useState(() => defaultNetworkInsightLayout(definitions));
  const [customSpecs, setCustomSpecs] = useState<CustomGraphicSpec[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [customizing, setCustomizing] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const allDefinitions = useMemo(
    () => [...definitions, ...customSpecs.map(customGraphicDefinition)],
    [definitions, customSpecs],
  );
  const definitionsById = useMemo(
    () => new Map(allDefinitions.map((definition) => [definition.id, definition])),
    [allDefinitions],
  );

  useEffect(() => {
    let serializedLayout: string | null = null;
    let serializedCustom: string | null = null;
    try {
      serializedLayout = window.localStorage.getItem(storageKey);
      serializedCustom = window.localStorage.getItem(`${storageKey}.graphics.v${CUSTOM_GRAPHIC_VERSION}`);
    } catch {
      // Use defaults when storage cannot be read.
    }
    const stored = parseCustomGraphicStore(serializedCustom);
    const hydratedDefinitions = [
      ...definitions,
      ...stored.items.map(customGraphicDefinition),
    ];
    setCustomSpecs(stored.items);
    setLayout(parseNetworkInsightLayout(serializedLayout, hydratedDefinitions));
    setHydrated(true);
  }, [storageKey, registryKey, definitions]);

  useEffect(() => {
    if (!hydrated) return;
    writeLayout(storageKey, layout);
    try {
      window.localStorage.setItem(
        `${storageKey}.graphics.v${CUSTOM_GRAPHIC_VERSION}`,
        JSON.stringify({ version: CUSTOM_GRAPHIC_VERSION, items: customSpecs }),
      );
    } catch {
      // Storage may be unavailable in private/restricted browser contexts.
    }
  }, [customSpecs, hydrated, layout, storageKey]);

  useEffect(() => {
    if (hydrated) {
      setLayout((current) => reconcileNetworkInsightLayout(current, allDefinitions));
    }
  }, [allDefinitions, hydrated]);

  const visibleItems = layout.items.filter((item) => item.visible);

  return (
    <section className={cn("space-y-4", className)} aria-label="Customizable Network Insights widgets">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-muted/40 px-3 py-2 ring-1 ring-foreground/10">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="grid size-7 place-items-center rounded-lg bg-background text-foreground ring-1 ring-foreground/10">
            <LayoutDashboard className="size-3.5" />
          </span>
          <span>
            <span className="font-medium text-foreground">Dashboard layout</span>
            <span className="hidden sm:inline"> · {visibleItems.length} of {layout.items.length} widgets visible</span>
          </span>
          {isRefreshing && <RefreshCw className="size-3.5 animate-spin" aria-label="Refreshing insights" />}
        </div>
        <Button
          variant={customizing ? "secondary" : "outline"}
          size="sm"
          onClick={() => setCustomizing((value) => !value)}
          aria-expanded={customizing}
        >
          <Settings2 /> {customizing ? "Done customizing" : "Customize"}
        </Button>
      </div>

      {customizing && (
        <WidgetSettings
          definitions={allDefinitions}
          layout={layout}
          customSpecs={customSpecs}
          onChange={(next) => setLayout(reconcileNetworkInsightLayout(next, allDefinitions))}
          onSaveCustom={(spec) => {
            setCustomSpecs((current) => upsertCustomGraphic(current, spec));
            setLayout((current) => updateNetworkInsightWidget(current, spec.id, { size: spec.size }));
          }}
          onDeleteCustom={(id) => setCustomSpecs((current) => deleteCustomGraphic(current, id))}
          onReset={() => {
            setCustomSpecs([]);
            setLayout(defaultNetworkInsightLayout(definitions));
          }}
        />
      )}

      {visibleItems.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <LayoutDashboard className="size-8 text-muted-foreground" />
            <div><p className="font-medium">No widgets are visible</p><p className="text-sm text-muted-foreground">Open Customize to restore the views you need.</p></div>
            {!customizing && <Button variant="outline" size="sm" onClick={() => setCustomizing(true)}>Customize dashboard</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-12">
          {visibleItems.map((item) => {
            const definition = definitionsById.get(item.id);
            if (!definition) return null;
            return (
              <Card
                key={item.id}
                className={cn(
                  "h-full",
                  SIZE_CLASS[item.size],
                  customizing && "cursor-grab border-primary/20",
                  draggedId === item.id && "opacity-50",
                )}
                draggable={customizing}
                onDragStart={(event) => {
                  setDraggedId(item.id);
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", item.id);
                }}
                onDragEnd={() => setDraggedId(null)}
                onDragOver={(event) => {
                  if (customizing && draggedId && draggedId !== item.id) event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const sourceId = draggedId ?? event.dataTransfer.getData("text/plain");
                  if (sourceId) setLayout((current) => reorderNetworkInsightWidgets(current, sourceId, item.id));
                  setDraggedId(null);
                }}
              >
                <CardHeader className="border-b">
                  <div className="flex items-start gap-2">
                    {customizing && <GripVertical className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />}
                    <div className="min-w-0 flex-1">
                      <CardTitle>{definition.title}</CardTitle>
                      <p className="mt-0.5 text-xs text-muted-foreground">{definition.description}</p>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="flex-1">
                  <WidgetErrorBoundary title={definition.title}>
                    {definition.render({ data, config: item.config, windowLabel })}
                  </WidgetErrorBoundary>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
