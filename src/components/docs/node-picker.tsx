"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Box, Boxes, Container as ContainerIcon, Monitor, Network as NetworkIcon, Server } from "lucide-react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EMBEDDABLE_KINDS, type NodeEmbedKind } from "@/lib/docs/node-embed";
import type { SearchResult } from "@/lib/types";

const KINDS_PARAM = EMBEDDABLE_KINDS.join(",");

const KIND_ICON: Record<NodeEmbedKind, typeof Server> = {
  device: Server,
  vm: Monitor,
  container: ContainerIcon,
  network: NetworkIcon,
  service: Box,
};

const KIND_LABEL: Record<NodeEmbedKind, string> = {
  device: "Hosts",
  vm: "Virtual machines",
  container: "Containers",
  network: "Networks",
  service: "Services",
};

function isEmbeddableResult(r: SearchResult): r is SearchResult & { kind: NodeEmbedKind } {
  return (EMBEDDABLE_KINDS as readonly string[]).includes(r.kind);
}

interface NodePickerProps {
  onInsert: (kind: NodeEmbedKind, id: string) => void;
  disabled?: boolean;
}

/**
 * Toolbar control that searches embeddable entities (via /api/search, filtered
 * to device/vm/container/network/service) and inserts a `{{node:kind:id}}`
 * token at the editor cursor on selection. The token renders a live card and
 * makes this page appear as linked documentation on the inventory detail.
 */
export function NodePicker({ onInsert, disabled }: NodePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const { data: results } = useQuery<SearchResult[]>({
    queryKey: ["node-picker-search", query],
    queryFn: async () => {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(query)}&kinds=${KINDS_PARAM}`,
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { data?: SearchResult[] };
      return body.data ?? [];
    },
    enabled: open && query.trim().length >= 2,
    placeholderData: (prev) => prev,
  });

  // Defensive filter: only offer embeddable kinds even if search widens.
  const hits = (results ?? []).filter(isEmbeddableResult);
  const grouped = hits.reduce<Partial<Record<NodeEmbedKind, SearchResult[]>>>((acc, r) => {
    (acc[r.kind as NodeEmbedKind] ??= []).push(r);
    return acc;
  }, {});

  const select = (kind: NodeEmbedKind, id: string) => {
    onInsert(kind, id);
    setOpen(false);
    setQuery("");
  };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) setQuery("");
      }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Link inventory item"
              disabled={disabled}
            >
              <Boxes />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Link inventory item</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-80 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search hosts, VMs, containers…"
            value={query}
            onValueChange={setQuery}
          />
          <CommandList>
            <CommandEmpty>
              {query.trim().length >= 2 ? "No matching nodes." : "Type at least 2 characters."}
            </CommandEmpty>
            {(Object.entries(grouped) as [NodeEmbedKind, SearchResult[]][]).map(([kind, items]) => {
              const Icon = KIND_ICON[kind];
              return (
                <CommandGroup key={kind} heading={KIND_LABEL[kind]}>
                  {items.map((item) => (
                    <CommandItem
                      key={`${kind}-${item.id}`}
                      value={`${kind}-${item.id}-${item.name}`}
                      onSelect={() => select(kind, item.id)}
                    >
                      <Icon className="size-4" />
                      <span className="truncate">{item.name}</span>
                      {item.subtitle && (
                        <span className="ml-auto truncate text-xs text-muted-foreground">
                          {item.subtitle}
                        </span>
                      )}
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
