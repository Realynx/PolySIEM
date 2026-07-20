"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Check, Loader2, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiSend } from "@/components/inventory/client-api";
import type {
  InterviewServiceCandidate,
  InterviewServicePlan,
} from "@/lib/ai/agent/contract";

interface EditableServiceCandidate extends InterviewServiceCandidate {
  key: string;
  selected: boolean;
}

export interface ServicesReviewProps {
  plan: InterviewServicePlan;
  onBack: () => void;
  onComplete: () => void;
}

export function ServicesReview({
  plan,
  onBack,
  onComplete,
}: ServicesReviewProps) {
  const router = useRouter();
  const [rows, setRows] = useState<EditableServiceCandidate[]>(() =>
    plan.services.map((service, index) => ({
      ...service,
      key: `${service.target.id}:${index}`,
      selected: true,
    })),
  );
  const [saving, setSaving] = useState(false);
  const [targets, setTargets] = useState<InterviewServiceCandidate["target"][]>(
    [],
  );

  useEffect(() => {
    setRows(
      plan.services.map((service, index) => ({
        ...service,
        key: `${service.target.id}:${index}`,
        selected: true,
      })),
    );
  }, [plan]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (["hosts", "vms", "containers"] as const).map(async (entity) => {
        const result = await apiSend<{
          items: { id: string; name: string }[];
        }>(`/api/inventory/${entity}?pageSize=200`, "GET");
        const kind =
          entity === "hosts" ? "device" : entity === "vms" ? "vm" : "container";
        return result.items.map(
          (item) => ({ ...item, kind }) as InterviewServiceCandidate["target"],
        );
      }),
    )
      .then((groups) => {
        if (!cancelled) setTargets(groups.flat());
      })
      .catch(() => {
        // Keep the verified proposal target if relation options fail to load.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key: string, patch: Partial<EditableServiceCandidate>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const selected = rows.filter((row) => row.selected);

  const createSelected = async () => {
    if (selected.length === 0) return;
    const invalid = selected.find(
      (row) =>
        !row.name.trim() ||
        (row.port !== null &&
          (!Number.isInteger(row.port) || row.port < 1 || row.port > 65535)) ||
        (Boolean(row.url?.trim()) &&
          !/^https?:\/\/[^\s]+$/i.test(row.url!.trim())),
    );
    if (invalid) {
      toast.error(
        "Every selected service needs a name, a valid port, and an HTTP(S) URL when provided.",
      );
      return;
    }

    setSaving(true);
    const createdKeys = new Set<string>();
    const failures: string[] = [];
    for (const row of selected) {
      try {
        await apiSend("/api/inventory/services", "POST", {
          name: row.name.trim(),
          url: row.url?.trim() || null,
          port: row.port,
          protocol: row.protocol,
          description: row.description?.trim() || null,
          ...(row.target.kind === "device" ? { deviceId: row.target.id } : {}),
          ...(row.target.kind === "vm" ? { vmId: row.target.id } : {}),
          ...(row.target.kind === "container"
            ? { containerId: row.target.id }
            : {}),
        });
        createdKeys.add(row.key);
      } catch (error) {
        failures.push(
          `${row.name}: ${error instanceof Error ? error.message : "could not be created"}`,
        );
      }
    }

    if (createdKeys.size > 0) {
      setRows((current) => current.filter((row) => !createdKeys.has(row.key)));
      toast.success(
        `Created ${createdKeys.size} service ${createdKeys.size === 1 ? "entry" : "entries"}.`,
      );
      router.refresh();
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} service ${failures.length === 1 ? "was" : "were"} not created.`,
        {
          description: failures.slice(0, 2).join(" · "),
        },
      );
    } else {
      onComplete();
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed bg-muted/35 p-3 text-xs leading-5 text-muted-foreground">
        These are proposals, not SSH discoveries. Confirm the service,
        attachment, and endpoint; unchecked rows will not be created.
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border bg-card p-5 text-center">
          <Check className="mx-auto size-5 text-success" aria-hidden />
          <p className="mt-2 text-sm font-medium">No pending service entries</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Nothing new was proposed, or all selected entries were created.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.key}
              className="rounded-xl border bg-card p-3 transition-opacity data-[selected=false]:opacity-55"
              data-selected={row.selected}
            >
              <div className="flex items-start gap-3">
                <Checkbox
                  checked={row.selected}
                  onCheckedChange={(checked) =>
                    update(row.key, { selected: checked === true })
                  }
                  aria-label={`Create ${row.name}`}
                  className="mt-2"
                />
                <div className="min-w-0 flex-1 space-y-3">
                  <div className="grid grid-cols-[minmax(0,1fr)_88px] gap-2">
                    <div className="space-y-1">
                      <Label
                        htmlFor={`service-name-${row.key}`}
                        className="text-xs"
                      >
                        Service
                      </Label>
                      <Input
                        id={`service-name-${row.key}`}
                        value={row.name}
                        onChange={(event) =>
                          update(row.key, { name: event.target.value })
                        }
                        disabled={!row.selected || saving}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor={`service-port-${row.key}`}
                        className="text-xs"
                      >
                        Port
                      </Label>
                      <Input
                        id={`service-port-${row.key}`}
                        type="number"
                        min={1}
                        max={65535}
                        value={row.port ?? ""}
                        onChange={(event) =>
                          update(row.key, {
                            port:
                              event.target.value === ""
                                ? null
                                : Number(event.target.value),
                          })
                        }
                        disabled={!row.selected || saving}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Protocol</Label>
                      <Select
                        value={row.protocol ?? "none"}
                        onValueChange={(value) =>
                          update(row.key, {
                            protocol:
                              value === "none"
                                ? null
                                : (value as EditableServiceCandidate["protocol"]),
                          })
                        }
                        disabled={!row.selected || saving}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">—</SelectItem>
                          <SelectItem value="http">HTTP</SelectItem>
                          <SelectItem value="https">HTTPS</SelectItem>
                          <SelectItem value="tcp">TCP</SelectItem>
                          <SelectItem value="udp">UDP</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor={`service-url-${row.key}`}
                        className="text-xs"
                      >
                        URL
                      </Label>
                      <Input
                        id={`service-url-${row.key}`}
                        value={row.url ?? ""}
                        onChange={(event) =>
                          update(row.key, { url: event.target.value || null })
                        }
                        placeholder="https://service.example"
                        disabled={!row.selected || saving}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor={`service-description-${row.key}`}
                      className="text-xs"
                    >
                      Description
                    </Label>
                    <Textarea
                      id={`service-description-${row.key}`}
                      rows={2}
                      value={row.description ?? ""}
                      onChange={(event) =>
                        update(row.key, {
                          description: event.target.value || null,
                        })
                      }
                      disabled={!row.selected || saving}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label className="text-xs">Runs on</Label>
                    <Select
                      value={`${row.target.kind}:${row.target.id}`}
                      onValueChange={(value) => {
                        const target = targets.find(
                          (candidate) =>
                            `${candidate.kind}:${candidate.id}` === value,
                        );
                        if (target) update(row.key, { target });
                      }}
                      disabled={!row.selected || saving || targets.length === 0}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {row.target.name} ({row.target.kind})
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((target) => (
                          <SelectItem
                            key={`${target.kind}:${target.id}`}
                            value={`${target.kind}:${target.id}`}
                          >
                            {target.name} ({target.kind})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="rounded-lg bg-muted/45 px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
                    <p>Basis: {row.evidence}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {plan.notes.length > 0 && (
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs font-medium">Needs follow-up</p>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {plan.notes.map((note, index) => (
              <li key={index}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
          <ArrowLeft className="size-3.5" />
          Back
        </Button>
        {rows.length > 0 ? (
          <Button
            size="sm"
            onClick={() => void createSelected()}
            disabled={saving || selected.length === 0}
          >
            {saving ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ServerCog className="size-3.5" />
            )}
            Create {selected.length || "selected"} service
            {selected.length === 1 ? "" : "s"}
          </Button>
        ) : (
          <Button size="sm" onClick={onComplete}>
            Done
          </Button>
        )}
      </div>
    </div>
  );
}
