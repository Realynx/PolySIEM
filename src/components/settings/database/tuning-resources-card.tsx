"use client";

import { Cpu, HardDrive, MemoryStick, RotateCcw, Server, type LucideIcon } from "lucide-react";
import { formatBytes } from "@/lib/format";
import type { DetectedResources, TuningOverrides } from "@/lib/postgres-tuning/model";
import type { StorageKind, TuningBudget } from "@/lib/postgres-tuning/recommend";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

const GB = 1024 ** 3;

const STORAGE_LABEL: Record<StorageKind, string> = { ssd: "SSD", hdd: "HDD", unknown: "Unknown" };

function Fact({ icon: Icon, label, value, source }: { icon: LucideIcon; label: string; value: string; source: string }) {
  return (
    <div className="flex min-w-0 items-start gap-3 rounded-lg border bg-muted/30 p-3">
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium">{value}</p>
        <p className="truncate text-xs text-muted-foreground" title={source}>
          {source}
        </p>
      </div>
    </div>
  );
}

function OverrideFields({
  detected,
  overrides,
  onChange,
}: {
  detected: DetectedResources;
  overrides: TuningOverrides;
  onChange: (next: TuningOverrides) => void;
}) {
  const memoryGb = overrides.memoryBytes === undefined ? "" : String(Math.round((overrides.memoryBytes / GB) * 100) / 100);
  const setMemory = (raw: string) => {
    const gb = Number.parseFloat(raw);
    onChange({ ...overrides, memoryBytes: raw.trim() && gb > 0 ? Math.round(gb * GB) : undefined });
  };
  const setCpus = (raw: string) => {
    const cpus = Number.parseInt(raw, 10);
    onChange({ ...overrides, cpus: raw.trim() && cpus > 0 ? cpus : undefined });
  };

  return (
    <div className="grid gap-4 border-t pt-4 sm:grid-cols-3">
      <div className="grid gap-2">
        <Label htmlFor="pg-memory">Memory (GB)</Label>
        <Input
          id="pg-memory"
          type="number"
          min={0.25}
          step={0.25}
          inputMode="decimal"
          value={memoryGb}
          placeholder={String(Math.round((detected.memoryBytes / GB) * 100) / 100)}
          onChange={(e) => setMemory(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pg-cpus">CPUs</Label>
        <Input
          id="pg-cpus"
          type="number"
          min={1}
          max={512}
          inputMode="numeric"
          value={overrides.cpus ?? ""}
          placeholder={String(detected.cpus)}
          onChange={(e) => setCpus(e.target.value)}
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="pg-storage">Storage</Label>
        <Select
          value={overrides.storage ?? "detected"}
          onValueChange={(value) =>
            onChange({ ...overrides, storage: value === "detected" ? undefined : (value as StorageKind) })
          }
        >
          <SelectTrigger id="pg-storage" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="detected">Detected ({STORAGE_LABEL[detected.storage]})</SelectItem>
            <SelectItem value="ssd">SSD / NVMe</SelectItem>
            <SelectItem value="hdd">Spinning disk (HDD)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-start justify-between gap-4 sm:col-span-3">
        <div className="space-y-1">
          <Label htmlFor="pg-shares-host">PolySIEM runs on the same machine</Label>
          <p className="text-xs text-muted-foreground">
            Reserves {formatBytes(detected.appMemoryBytes)} ({detected.appMemorySource.toLowerCase()}) for the app before
            sizing PostgreSQL.
          </p>
        </div>
        <Switch
          id="pg-shares-host"
          checked={overrides.sharesHostWithApp ?? detected.sharesHostWithApp}
          onCheckedChange={(checked) =>
            onChange({ ...overrides, sharesHostWithApp: checked === detected.sharesHostWithApp ? undefined : checked })
          }
        />
      </div>
    </div>
  );
}

export function TuningResourcesCard({
  detected,
  overrides,
  budget,
  databaseHost,
  onChange,
}: {
  detected: DetectedResources;
  overrides: TuningOverrides;
  budget: TuningBudget;
  databaseHost: string | null;
  onChange: (next: TuningOverrides) => void;
}) {
  const overridden = Object.values(overrides).some((value) => value !== undefined);
  const memory = overrides.memoryBytes ?? detected.memoryBytes;
  const cpus = overrides.cpus ?? detected.cpus;
  const storage = overrides.storage ?? detected.storage;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Resources</CardTitle>
          <div className="flex items-center gap-2">
            {detected.needsConfirmation && !overridden && <Badge variant="outline">Confirm these values</Badge>}
            {overridden && <Badge variant="secondary">Overridden</Badge>}
            {overridden && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
                <RotateCcw className="size-3.5" /> Use detected
              </Button>
            )}
          </div>
        </div>
        <CardDescription>
          What PostgreSQL has to work with. Recommendations update as you change these.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {detected.note && <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">{detected.note}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={MemoryStick} label="Memory" value={formatBytes(memory)} source={overrides.memoryBytes ? "entered by you" : detected.memorySource} />
          <Fact icon={Cpu} label="CPUs" value={String(cpus)} source={overrides.cpus ? "entered by you" : detected.cpuSource} />
          <Fact icon={HardDrive} label="Storage" value={STORAGE_LABEL[storage]} source={overrides.storage ? "entered by you" : detected.storageSource} />
          <Fact
            icon={Server}
            label="PostgreSQL budget"
            value={formatBytes(budget.pgBudgetBytes)}
            source={`database host: ${databaseHost ?? "unknown"}`}
          />
        </div>
        <OverrideFields detected={detected} overrides={overrides} onChange={onChange} />
      </CardContent>
    </Card>
  );
}
