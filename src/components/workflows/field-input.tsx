"use client";

import { useRef, useState } from "react";
import { Braces, List } from "lucide-react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { FieldSpec, TriggerParam } from "@/lib/workflows/types";
import { insertAtCursor, type TemplateVarGroup } from "@/components/workflows/lib";
import { EntityPicker } from "@/components/workflows/entity-picker";
import { TemplatePickerButton } from "@/components/workflows/template-picker";

/** A TriggerParam rendered with the same machinery as a catalog FieldSpec. */
export function triggerParamToField(param: TriggerParam): FieldSpec {
  return {
    key: param.key,
    label: param.label,
    type: param.type,
    required: param.required,
    help: param.help,
    templateable: false,
  };
}

function isTemplateable(field: FieldSpec): boolean {
  return field.templateable ?? (field.type === "string" || field.type === "text");
}

/**
 * Renders ONE config field purely from its FieldSpec — the same component
 * drives node config panels and the run-input dialog, so new engine field
 * types/actions need zero UI changes.
 *
 * - string/text: input or textarea with a template-variable picker inserting
 *   at the cursor (when templateable and variables are offered)
 * - number/boolean/select: native controls
 * - network/vm/device: searchable entity picker; when the spec marks the field
 *   templateable, a small toggle switches to a template expression input
 */
export function FieldInput({
  field,
  value,
  onChange,
  templateGroups,
  disabled,
  idPrefix = "wf-field",
}: {
  field: FieldSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  /** Template variables offered for templateable fields; omit to disable the picker. */
  templateGroups?: TemplateVarGroup[];
  disabled?: boolean;
  idPrefix?: string;
}) {
  const id = `${idPrefix}-${field.key}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isEntity =
    field.type === "network" ||
    field.type === "vm" ||
    field.type === "device" ||
    field.type === "integration" ||
    field.type === "workflow";
  const templateable = isTemplateable(field);
  const stringValue = typeof value === "string" ? value : "";
  // Entity fields holding a template expression open in template mode.
  const [entityTemplateMode, setEntityTemplateMode] = useState(
    () => isEntity && stringValue.includes("{{"),
  );

  const insertRef = (ref: string) => {
    const el = field.type === "text" ? textareaRef.current : inputRef.current;
    const current = typeof value === "string" ? value : "";
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    const next = insertAtCursor(current, start, end, ref);
    onChange(next.value);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(next.cursor, next.cursor);
    });
  };

  const picker =
    templateable && templateGroups !== undefined ? (
      <TemplatePickerButton groups={templateGroups} onInsert={insertRef} disabled={disabled} />
    ) : null;

  let control: React.ReactNode;
  switch (field.type) {
    case "boolean":
      control = (
        <div className="flex h-9 items-center">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
            disabled={disabled}
            aria-label={field.label}
          />
        </div>
      );
      break;
    case "number":
      control = (
        <Input
          id={id}
          type="number"
          value={typeof value === "number" ? value : ""}
          placeholder={field.placeholder}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
      break;
    case "select":
      control = (
        <Select
          value={stringValue || undefined}
          onValueChange={(v) => onChange(v)}
          disabled={disabled}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder={field.placeholder ?? "Select…"} />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
      break;
    case "network":
    case "vm":
    case "device":
    case "integration":
    case "workflow":
      control =
        entityTemplateMode && templateable ? (
          <div className="flex items-center gap-1">
            <Input
              id={id}
              ref={inputRef}
              value={stringValue}
              placeholder={field.placeholder ?? "{{input.…}}"}
              disabled={disabled}
              className="font-mono text-xs"
              onChange={(e) => onChange(e.target.value)}
            />
            {picker}
          </div>
        ) : (
          <EntityPicker
            kind={field.type}
            value={stringValue || null}
            onChange={(entityId) => onChange(entityId ?? undefined)}
            disabled={disabled}
            placeholder={field.placeholder}
          />
        );
      break;
    case "text":
      control = (
        <div className="flex items-start gap-1">
          <Textarea
            id={id}
            ref={textareaRef}
            value={stringValue}
            placeholder={field.placeholder}
            disabled={disabled}
            rows={4}
            className={cn(stringValue.includes("{{") && "font-mono text-xs")}
            onChange={(e) => onChange(e.target.value)}
          />
          {picker}
        </div>
      );
      break;
    default: // string
      control = (
        <div className="flex items-center gap-1">
          <Input
            id={id}
            ref={inputRef}
            value={stringValue}
            placeholder={field.placeholder}
            disabled={disabled}
            className={cn(stringValue.includes("{{") && "font-mono text-xs")}
            onChange={(e) => onChange(e.target.value)}
          />
          {picker}
        </div>
      );
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id} className="text-xs">
          {field.label}
          {field.required && <span className="text-destructive">*</span>}
        </Label>
        {isEntity && templateable && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => {
              const next = !entityTemplateMode;
              setEntityTemplateMode(next);
              onChange(undefined); // switching modes clears the incompatible value
            }}
          >
            {entityTemplateMode ? (
              <>
                <List className="size-3" /> Pick from inventory
              </>
            ) : (
              <>
                <Braces className="size-3" /> Use template
              </>
            )}
          </Button>
        )}
      </div>
      {control}
      {field.help && <p className="text-xs leading-snug text-muted-foreground">{field.help}</p>}
    </div>
  );
}
