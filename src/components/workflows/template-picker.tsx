"use client";

import { useState } from "react";
import { Braces, KeyRound } from "lucide-react";
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
import type { TemplateVarGroup } from "@/components/workflows/lib";

/**
 * "{{ }}" popover button listing the template variables a field may reference:
 * the trigger's run inputs and outputs of upstream nodes. Selecting one calls
 * `onInsert` with the full reference (the caller inserts it at the cursor).
 */
export function TemplatePickerButton({
  groups,
  onInsert,
  disabled,
}: {
  groups: TemplateVarGroup[];
  onInsert: (ref: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const empty = groups.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={disabled}
          className="size-7 shrink-0 text-muted-foreground hover:text-foreground"
          title="Insert a template variable"
          aria-label="Insert a template variable"
        >
          <Braces className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <Command>
          <CommandInput placeholder="Search variables…" />
          <CommandList>
            <CommandEmpty>
              {empty
                ? "No variables yet — add trigger parameters or connect upstream nodes."
                : "No matching variables."}
            </CommandEmpty>
            {groups.map((group) => (
              <CommandGroup key={group.title} heading={group.title}>
                {group.vars.map((v) => (
                  <CommandItem
                    key={v.ref}
                    value={`${group.title} ${v.label} ${v.ref}`}
                    onSelect={() => {
                      onInsert(v.ref);
                      setOpen(false);
                    }}
                  >
                    <span className="min-w-0 flex-1 truncate">{v.label}</span>
                    {v.secret && (
                      <KeyRound className="size-3 shrink-0 text-warning" aria-label="Secret output" />
                    )}
                    <span className="max-w-40 shrink-0 truncate font-mono text-[10px] text-muted-foreground">
                      {v.ref}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
