"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, CloudOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { NodeCategory, NodeTypeMeta } from "@/lib/workflows/types";
import { CATEGORY_ORDER } from "@/components/workflows/categories";
import { categoryMeta } from "@/components/workflows/meta";
import {
  filterNodeCatalog,
  groupNodeCatalog,
  type NodePaletteCategory,
} from "@/components/workflows/palette-model";

export const PALETTE_DRAG_MIME = "application/x-polysiem-workflow-node";

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.matches("input, textarea, select"))
  );
}

/**
 * Compact node launcher for the workflow canvas. The catalog stays out of the
 * way until requested, then behaves like a graph-editor command palette:
 * searchable, category-filterable, and fully keyboard navigable.
 */
export function NodePalette({
  catalog,
  loading,
  error,
  onRetry,
  onAdd,
}: {
  catalog: NodeTypeMeta[] | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onAdd: (meta: NodeTypeMeta) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<NodePaletteCategory>("all");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.shiftKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.toLowerCase() === "a" &&
        !isEditableTarget(event.target)
      ) {
        event.preventDefault();
        setOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const counts = useMemo(() => {
    const next = new Map<NodeCategory, number>();
    for (const meta of catalog ?? []) {
      next.set(meta.category, (next.get(meta.category) ?? 0) + 1);
    }
    return next;
  }, [catalog]);

  const groups = useMemo(
    () => groupNodeCatalog(filterNodeCatalog(catalog ?? [], query, category)),
    [catalog, category, query],
  );

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setCategory("all");
    }
  }

  function add(meta: NodeTypeMeta) {
    onAdd(meta);
    handleOpenChange(false);
  }

  return (
    <div className="absolute left-3 top-3 z-10">
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-9 gap-2 border-border bg-card/95 px-3 shadow-sm backdrop-blur"
            aria-label="Add workflow node"
            title="Add node (Shift+A)"
          >
            <Plus className="size-4" />
            <span>Add node</span>
            <ChevronDown className="size-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-[min(34rem,calc(100vw-2rem))] gap-0 overflow-hidden p-0"
        >
          <Command shouldFilter={false} className="rounded-lg p-0">
            <div className="border-b border-border/70 p-1">
              <CommandInput
                autoFocus
                value={query}
                onValueChange={setQuery}
                placeholder="Search nodes by name, purpose, or type…"
                aria-label="Search workflow nodes"
              />
            </div>

            <div className="grid min-h-0 grid-cols-[8.5rem_minmax(0,1fr)]">
              <nav
                className="max-h-[22rem] overflow-y-auto border-r border-border/70 p-1"
                aria-label="Node categories"
              >
                <button
                  type="button"
                  aria-pressed={category === "all"}
                  onClick={() => setCategory("all")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                    category === "all"
                      ? "bg-muted font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                  )}
                >
                  <span>All nodes</span>
                  <span className="tabular-nums opacity-60">{catalog?.length ?? 0}</span>
                </button>

                {CATEGORY_ORDER.filter((item) => counts.has(item)).map((item) => {
                  const meta = categoryMeta(item);
                  const Icon = meta.icon;
                  return (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={category === item}
                      onClick={() => setCategory(item)}
                      className={cn(
                        "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                        category === item
                          ? "bg-muted font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                      )}
                    >
                      <Icon className={cn("size-3.5", meta.fg)} />
                      <span className="min-w-0 flex-1 truncate">{meta.label}</span>
                      <span className="tabular-nums opacity-60">{counts.get(item)}</span>
                    </button>
                  );
                })}
              </nav>

              <CommandList className="max-h-[22rem] p-1">
                {loading && (
                  <div className="space-y-2 p-1" aria-label="Loading node catalog">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <Skeleton key={index} className="h-12 w-full" />
                    ))}
                  </div>
                )}

                {error && !loading && (
                  <div className="space-y-2 px-4 py-8 text-center">
                    <CloudOff className="mx-auto size-5 text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">
                      Node catalog unavailable — the workflow engine may still be starting.
                    </p>
                    <Button variant="outline" size="sm" onClick={onRetry}>
                      Retry
                    </Button>
                  </div>
                )}

                {!loading && !error && (
                  <>
                    <CommandEmpty>No nodes match this search.</CommandEmpty>
                    {groups.map((group) => (
                      <CommandGroup
                        key={group.category}
                        heading={category === "all" ? categoryMeta(group.category).label : undefined}
                      >
                        {group.entries.map((meta) => {
                          const identity = categoryMeta(meta.category);
                          const Icon = identity.icon;
                          return (
                            <CommandItem
                              key={meta.kind}
                              value={meta.kind}
                              draggable
                              title={meta.description}
                              className="items-start py-2 cursor-grab active:cursor-grabbing"
                              onSelect={() => add(meta)}
                              onDragStart={(event) => {
                                event.dataTransfer.setData(PALETTE_DRAG_MIME, meta.kind);
                                event.dataTransfer.effectAllowed = "move";
                              }}
                            >
                              <span
                                className={cn(
                                  "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md",
                                  identity.bg,
                                )}
                              >
                                <Icon className={cn("size-3.5", identity.fg)} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="flex items-baseline justify-between gap-2">
                                  <span className="truncate text-xs font-medium">{meta.title}</span>
                                  <span className="shrink-0 font-mono text-[9px] text-muted-foreground/70">
                                    {meta.kind}
                                  </span>
                                </span>
                                <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
                                  {meta.description}
                                </span>
                              </span>
                            </CommandItem>
                          );
                        })}
                      </CommandGroup>
                    ))}
                  </>
                )}
              </CommandList>
            </div>

            <div className="flex items-center gap-3 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
              <span><kbd className="font-mono">↑↓</kbd> navigate</span>
              <span><kbd className="font-mono">Enter</kbd> add</span>
              <span className="ml-auto">Drag to place precisely</span>
            </div>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
