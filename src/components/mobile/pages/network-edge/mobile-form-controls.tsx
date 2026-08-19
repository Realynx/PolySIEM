"use client";

import { type ReactNode, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withCurrentChoice, type ConfigChoice } from "@/components/network/edge-networks-types";

/**
 * Phone form controls for the edge-network screens.
 *
 * `MobileSelectField` is the mobile answer to "give these fields dropdowns":
 * a Select over the known-good options with a "Custom…" escape hatch that
 * reveals the original free-text input. The option lists and the
 * unknown-value-preservation rule (`withCurrentChoice`) come from the shared
 * desktop layer, so both presentations offer exactly the same choices.
 *
 * `MobileOptionCard` is the tappable radio card the route-mode picker
 * established; the connector kind picker reuses it rather than growing a
 * second look-alike.
 */

/** Sentinel option value; no real field value can collide with it. */
const CUSTOM_OPTION = "__custom__";

export function MobileSelectField({
  id,
  label,
  value,
  onChange,
  choices,
  help,
  placeholder = "Choose…",
  customLabel = "Custom…",
  customPlaceholder,
  inputMode,
  mono = false,
  invalid = false,
  disabled = false,
}: {
  id: string;
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  choices: readonly ConfigChoice[];
  help?: ReactNode;
  placeholder?: string;
  customLabel?: string;
  customPlaceholder?: string;
  inputMode?: "numeric" | "text" | "url";
  mono?: boolean;
  invalid?: boolean;
  disabled?: boolean;
}) {
  const [custom, setCustom] = useState(false);
  const trimmed = value.trim();
  // An unknown stored value stays selectable rather than disappearing, so
  // opening a picker can never silently rewrite someone's configuration.
  const resolved = useMemo(() => withCurrentChoice(choices, trimmed), [choices, trimmed]);

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={custom ? CUSTOM_OPTION : trimmed || undefined}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === CUSTOM_OPTION) {
            // Keep the current value as the starting point of the free-text edit.
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(next);
        }}
      >
        <SelectTrigger id={custom ? undefined : id} className={cn("w-full", invalid && "border-destructive")}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {resolved.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              <span className={cn(mono && "font-mono")}>{choice.label}</span>
              {choice.hint && <span className="text-xs text-muted-foreground">· {choice.hint}</span>}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_OPTION}>{customLabel}</SelectItem>
        </SelectContent>
      </Select>
      {custom && (
        <Input
          id={id}
          autoFocus
          value={value}
          inputMode={inputMode}
          onChange={(event) => onChange(event.target.value)}
          placeholder={customPlaceholder}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          className={cn(mono && "font-mono", invalid && "border-destructive")}
        />
      )}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Big tappable card — a phone-sized radio with room to explain itself. */
export function MobileOptionCard({
  icon,
  title,
  detail,
  selected,
  onSelect,
  disabled = false,
  disabledHint,
}: {
  icon?: ReactNode;
  title: ReactNode;
  detail: ReactNode;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
  disabledHint?: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "flex min-h-13 w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected ? "border-primary bg-primary/5" : "bg-card active:bg-muted/70",
        disabled && "opacity-50",
      )}
    >
      {icon && <span className={cn("mt-0.5 shrink-0", selected ? "text-primary" : "text-muted-foreground")}>{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-tight font-medium">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">
          {disabled && disabledHint ? disabledHint : detail}
        </span>
      </span>
    </button>
  );
}
