"use client";

import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { useEntityOptions, type EntityKind } from "@/components/workflows/api";

const KIND_LABEL: Record<EntityKind, string> = {
  network: "network",
  vm: "virtual machine",
  device: "device",
  integration: "integration",
  workflow: "workflow",
};

/**
 * Searchable combobox over inventory, integration, and workflow entities.
 * Stores the entity id; shows name + subtitle.
 */
export function EntityPicker({
  kind,
  value,
  onChange,
  disabled,
  placeholder,
}: {
  kind: EntityKind;
  value: string | null;
  onChange: (id: string | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data: options, isLoading, isError } = useEntityOptions(kind);
  const selected = options?.find((o) => o.id === value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selected && "text-muted-foreground")}>
            {selected
              ? selected.label
              : value
                ? `Unknown ${KIND_LABEL[kind]} (${value.slice(0, 8)}…)`
                : (placeholder ?? `Select a ${KIND_LABEL[kind]}…`)}
          </span>
          {isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin opacity-50" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <Command>
          <CommandInput placeholder={`Search ${KIND_LABEL[kind]}s…`} />
          <CommandList>
            <CommandEmpty>
              {isError
                ? "Could not load options."
                : isLoading
                  ? "Loading…"
                  : `No ${KIND_LABEL[kind]}s found.`}
            </CommandEmpty>
            <CommandGroup>
              {(options ?? []).map((option) => (
                <CommandItem
                  key={option.id}
                  value={`${option.label} ${option.subtitle ?? ""}`}
                  onSelect={() => {
                    onChange(option.id === value ? null : option.id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn("size-4", option.id === value ? "opacity-100" : "opacity-0")}
                  />
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {option.subtitle && (
                    <span className="shrink-0 text-xs text-muted-foreground">{option.subtitle}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
