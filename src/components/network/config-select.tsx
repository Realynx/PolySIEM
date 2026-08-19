"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { withCurrentChoice, type ConfigChoice } from "./edge-networks-types";

/** Sentinel for the escape hatch. Radix refuses an empty item value. */
const CUSTOM_VALUE = "__custom__";

export interface ConfigSelectProps {
  /** Applied to the trigger so an external <Label htmlFor> still works. */
  id?: string;
  value: string;
  onChange: (value: string) => void;
  choices: readonly ConfigChoice[];
  placeholder?: string;
  /** Wording of the escape hatch, e.g. "Custom interface…". */
  customLabel?: string;
  inputPlaceholder?: string;
  inputMode?: "numeric" | "text";
  /** Marks both controls invalid, mirroring the inline validation next to them. */
  invalid?: boolean;
  disabled?: boolean;
  /** Named for screen readers once the free-text input replaces the picker. */
  customAriaLabel?: string;
  className?: string;
  mono?: boolean;
}

/**
 * A picker for a field with knowable options, plus a "Custom…" escape hatch.
 *
 * Two rules make it safe to point at any stored configuration:
 *  · a stored value that is not in the list is shown as the selected option
 *    (annotated "current"), so opening the picker never rewrites it;
 *  · choosing "Custom…" reveals the original free-text input, so no value is
 *    unreachable.
 *
 * With no choices at all — an edge server PolySIEM has never synced, so its real
 * interfaces are unknown — it degrades to exactly the text input it replaced.
 */
export function ConfigSelect({
  id,
  value,
  onChange,
  choices,
  placeholder = "Choose a value",
  customLabel = "Custom…",
  inputPlaceholder,
  inputMode = "text",
  invalid = false,
  disabled = false,
  customAriaLabel,
  className,
  mono = true,
}: ConfigSelectProps) {
  const [custom, setCustom] = useState(false);

  // No knowable options — degrade to exactly the text input this replaced.
  if (choices.length === 0) {
    return (
      <ConfigTextInput
        id={id}
        value={value}
        onChange={onChange}
        placeholder={inputPlaceholder}
        inputMode={inputMode}
        disabled={disabled}
        invalid={invalid}
        mono={mono}
        className={className}
      />
    );
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <ConfigChoicePicker
        id={id}
        value={value}
        choices={choices}
        custom={custom}
        placeholder={placeholder}
        customLabel={customLabel}
        invalid={invalid}
        disabled={disabled}
        mono={mono}
        onSelect={(next) => {
          if (next === CUSTOM_VALUE) {
            setCustom(true);
            return;
          }
          setCustom(false);
          onChange(next);
        }}
      />
      {custom && (
        <ConfigTextInput
          value={value}
          onChange={onChange}
          placeholder={inputPlaceholder}
          inputMode={inputMode}
          invalid={invalid}
          mono={mono}
          ariaLabel={customAriaLabel ?? customLabel}
          autoFocus
        />
      )}
    </div>
  );
}

/** The free-text half: the fallback control and the "Custom…" escape hatch. */
function ConfigTextInput({
  id,
  value,
  onChange,
  placeholder,
  inputMode,
  disabled = false,
  invalid,
  mono,
  className,
  ariaLabel,
  autoFocus = false,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode: "numeric" | "text";
  disabled?: boolean;
  invalid: boolean;
  mono: boolean;
  className?: string;
  ariaLabel?: string;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      inputMode={inputMode}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-invalid={invalid || undefined}
      autoFocus={autoFocus}
      autoComplete="off"
      spellCheck={false}
      className={cn(mono && "font-mono", invalid && "border-destructive", className)}
    />
  );
}

/** The picker half: known options, the stored value, and the escape hatch. */
function ConfigChoicePicker({
  id,
  value,
  choices,
  custom,
  placeholder,
  customLabel,
  invalid,
  disabled,
  mono,
  onSelect,
}: {
  id?: string;
  value: string;
  choices: readonly ConfigChoice[];
  custom: boolean;
  placeholder: string;
  customLabel: string;
  invalid: boolean;
  disabled: boolean;
  mono: boolean;
  onSelect: (next: string) => void;
}) {
  const options = custom ? [...choices] : withCurrentChoice(choices, value);
  const selected = options.some((option) => option.value === value) ? value : "";
  return (
    <Select value={custom ? CUSTOM_VALUE : selected} disabled={disabled} onValueChange={onSelect}>
      <SelectTrigger id={id} aria-invalid={invalid || undefined} className={cn("w-full", invalid && "border-destructive")}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            <span className={cn(mono && "font-mono")}>{option.label}</span>
            {option.hint && <span className="text-xs text-muted-foreground">{option.hint}</span>}
          </SelectItem>
        ))}
        <SelectItem value={CUSTOM_VALUE}>{customLabel}</SelectItem>
      </SelectContent>
    </Select>
  );
}
