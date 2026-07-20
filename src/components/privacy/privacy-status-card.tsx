"use client";

import { Cpu, Eye, EyeOff, Loader2, MonitorUp } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { usePrivacy } from "@/components/privacy/privacy-provider";

function StatusRow({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "ok" | "warn" | "muted";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-amber-600 dark:text-amber-400"
        : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className={`font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Live detection status shown on the Privacy settings page. */
export function PrivacyStatusCard() {
  const privacy = usePrivacy();
  if (!privacy) return null;

  const { hardwareAccel, captureState, settings, anonymize } = privacy;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Detection status</CardTitle>
        <CardDescription>
          What the capture detector can see from this browser right now.
        </CardDescription>
      </CardHeader>
      <CardContent className="max-w-2xl space-y-3">
        {hardwareAccel === null ? (
          <StatusRow
            icon={<Loader2 className="size-4 animate-spin" />}
            label="Hardware acceleration"
            value="Probing…"
            tone="muted"
          />
        ) : (
          <StatusRow
            icon={<Cpu className="size-4" />}
            label="Hardware acceleration"
            value={
              hardwareAccel.accelerated
                ? `Available (${hardwareAccel.method.toUpperCase()}${
                    hardwareAccel.renderer ? ` — ${hardwareAccel.renderer}` : ""
                  })`
                : hardwareAccel.supported
                  ? "Software rendering — capture heuristics limited"
                  : "Not detectable in this browser"
            }
            tone={hardwareAccel.accelerated ? "ok" : "warn"}
          />
        )}
        <StatusRow
          icon={<MonitorUp className="size-4" />}
          label="Screen capture"
          value={
            !settings.shieldOnCapture
              ? "Detector off"
              : captureState.capturing
                ? `Detected (${captureState.signals.join(", ")})`
                : "No capture signals"
          }
          tone={
            !settings.shieldOnCapture
              ? "muted"
              : captureState.capturing
                ? "warn"
                : "ok"
          }
        />
        <StatusRow
          icon={anonymize ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          label="Displayed data"
          value={anonymize ? "Anonymized" : "Real values"}
          tone={anonymize ? "warn" : "muted"}
        />
      </CardContent>
    </Card>
  );
}
