"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { SourceValue } from "@/lib/types";
import { apiSend } from "./client-api";
import {
  buildPayload,
  ENTITY_CONFIGS,
  NONE_VALUE,
  type EntityKey,
  type FieldDef,
  type FormValues,
  type RelationKind,
} from "./entity-configs";

interface EntityFormDialogProps {
  /** Registry key — plain string so it can cross the RSC boundary. */
  entity: EntityKey;
  mode: "create" | "edit";
  /** Required in edit mode. */
  entityId?: string;
  /** Pre-filled string values (edit mode). */
  initial?: FormValues;
  /** Entity source — synced entities only expose syncedEditable fields. */
  source?: SourceValue;
  trigger: ReactNode;
}

function defaultsFor(fields: FieldDef[], initial?: FormValues): FormValues {
  const values: FormValues = {};
  for (const field of fields) {
    const preset = initial?.[field.name];
    if (preset !== undefined && preset !== "") {
      values[field.name] = preset;
    } else if (field.type === "select") {
      values[field.name] = field.options?.[0]?.value ?? "";
    } else if (field.type === "relation") {
      values[field.name] = NONE_VALUE;
    } else {
      values[field.name] = "";
    }
  }
  return values;
}

/** Create/edit dialog for any inventory entity, driven by its EntityConfig. */
export function EntityFormDialog({ entity, mode, entityId, initial, source, trigger }: EntityFormDialogProps) {
  const config = ENTITY_CONFIGS[entity];
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const synced = mode === "edit" && source !== undefined && source !== "MANUAL";
  const fields = useMemo(
    () => (synced ? config.fields.filter((f) => f.syncedEditable) : config.fields),
    [config.fields, synced],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(
      config.formSchema as unknown as Parameters<typeof zodResolver>[0],
    ) as unknown as Resolver<FormValues>,
    defaultValues: defaultsFor(config.fields, initial),
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const payload = buildPayload(fields, values, mode);
      if (mode === "create") {
        await apiSend(config.apiPath, "POST", payload);
        const label = values.name || values.address || config.singular;
        toast.success(`Created ${config.singular} “${label}”`);
      } else {
        await apiSend(`${config.apiPath}/${entityId}`, "PATCH", payload);
        toast.success(`Saved changes to ${config.singular}`);
      }
      setOpen(false);
      form.reset(defaultsFor(config.fields, mode === "edit" ? values : undefined));
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    }
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {mode === "create" ? `Add ${config.singular}` : `Edit ${config.singular}`}
          </DialogTitle>
          <DialogDescription>
            {synced
              ? "This entry is managed by an integration sync — only annotation fields can be edited."
              : mode === "create"
                ? `Manually document a ${config.singular} in your inventory.`
                : "Update the fields below and save your changes."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.name} className={cn("space-y-1.5", field.colSpan2 && "sm:col-span-2")}>
              <Label htmlFor={`ef-${field.name}`}>
                {field.label}
                {field.required && <span className="text-destructive"> *</span>}
              </Label>
              <FieldControl field={field} form={form} />
              {errors[field.name] && (
                <p className="text-xs text-destructive">{errors[field.name]?.message as string}</p>
              )}
            </div>
          ))}
          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" />}
              {mode === "create" ? `Create ${config.singular}` : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FieldControl({ field, form }: { field: FieldDef; form: ReturnType<typeof useForm<FormValues>> }) {
  if (field.type === "textarea") {
    return (
      <Textarea
        id={`ef-${field.name}`}
        rows={4}
        placeholder={field.placeholder}
        {...form.register(field.name)}
      />
    );
  }
  if (field.type === "select") {
    return (
      <Controller
        control={form.control}
        name={field.name}
        render={({ field: rhf }) => (
          <Select value={rhf.value} onValueChange={rhf.onChange}>
            <SelectTrigger id={`ef-${field.name}`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    );
  }
  if (field.type === "relation" && field.relation) {
    return <RelationSelect field={field} relation={field.relation} form={form} />;
  }
  return (
    <Input
      id={`ef-${field.name}`}
      placeholder={field.placeholder}
      inputMode={field.type === "number" ? "decimal" : undefined}
      {...form.register(field.name)}
    />
  );
}

function RelationSelect({
  field,
  relation,
  form,
}: {
  field: FieldDef;
  relation: RelationKind;
  form: ReturnType<typeof useForm<FormValues>>;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["relation-options", relation],
    queryFn: () =>
      apiSend<{ items: { id: string; name: string }[] }>(
        `/api/inventory/${relation}?pageSize=200`,
        "GET",
      ),
  });
  const options = data?.items ?? [];

  return (
    <Controller
      control={form.control}
      name={field.name}
      render={({ field: rhf }) => (
        <Select value={rhf.value} onValueChange={rhf.onChange}>
          <SelectTrigger id={`ef-${field.name}`} className="w-full">
            <SelectValue placeholder={isLoading ? "Loading…" : "None"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE_VALUE}>None</SelectItem>
            {options.map((opt) => (
              <SelectItem key={opt.id} value={opt.id}>
                {opt.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    />
  );
}
