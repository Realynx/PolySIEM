"use client";

import { ArrowRight, Check, RefreshCw } from "lucide-react";
import type { ManagedSettingName } from "@/lib/postgres-tuning/catalog";
import type { TuningRecommendation } from "@/lib/postgres-tuning/recommend";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

function StatusBadge({ setting }: { setting: TuningRecommendation }) {
  if (setting.pendingRestart) {
    return (
      <Badge variant="destructive">
        <RefreshCw /> Pending restart
      </Badge>
    );
  }
  if (!setting.differs) {
    return (
      <Badge variant="secondary">
        <Check /> Tuned
      </Badge>
    );
  }
  if (setting.restartRequired) return <Badge variant="outline">Needs restart</Badge>;
  return <Badge variant="outline">Applies live</Badge>;
}

function SettingRow({
  setting,
  checked,
  disabled,
  onCheckedChange,
}: {
  setting: TuningRecommendation;
  checked: boolean;
  disabled: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  const id = `pg-setting-${setting.name}`;
  return (
    <li className={cn("flex items-start gap-3 px-4 py-3", !setting.differs && "opacity-80")}>
      <Checkbox
        id={id}
        className="mt-0.5"
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onCheckedChange(value === true)}
        aria-label={`Apply ${setting.name}`}
      />
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <label htmlFor={id} className="font-mono text-sm font-medium">
            {setting.name}
          </label>
          <span className="flex items-center gap-1.5 font-mono text-sm">
            <span className={cn("text-muted-foreground", setting.differs && "line-through decoration-muted-foreground/50")}>
              {setting.current ?? "?"}
            </span>
            {setting.differs && (
              <>
                <ArrowRight className="size-3.5 text-muted-foreground" />
                <span className="font-semibold text-primary">{setting.recommended}</span>
              </>
            )}
          </span>
          <span className="ml-auto">
            <StatusBadge setting={setting} />
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{setting.reason}</p>
      </div>
    </li>
  );
}

export function TuningSettingsTable({
  settings,
  isChecked,
  disabled,
  onToggle,
}: {
  settings: TuningRecommendation[];
  isChecked: (name: ManagedSettingName) => boolean;
  disabled: boolean;
  onToggle: (name: ManagedSettingName, checked: boolean) => void;
}) {
  return (
    <ul className="divide-y rounded-lg border">
      {settings.map((setting) => (
        <SettingRow
          key={setting.name}
          setting={setting}
          checked={isChecked(setting.name)}
          disabled={disabled}
          onCheckedChange={(checked) => onToggle(setting.name, checked)}
        />
      ))}
    </ul>
  );
}
