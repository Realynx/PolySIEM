"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { THEME_COLORS } from "@/lib/types";
import { managedHostBaseUrlIssue } from "@/lib/managed-host-url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/components/shared/api-client";

interface InstanceSettingsView {
  instanceName: string;
  /** Origin managed hosts use to reach PolySIEM. "" = derive it per request. */
  managedHostBaseUrl: string;
  defaultTheme: string;
  staleRemoveThreshold: number;
  autoUpdate: {
    enabled: boolean;
    capable: boolean;
    enforcedByDemo: boolean;
  };
}

/**
 * The address PolySIEM hands to machines it manages.
 *
 * Left blank, PolySIEM works it out from the address the admin is browsing on —
 * which is right until the admin reaches PolySIEM some way the managed host
 * cannot: a dev server on localhost, a VPN-only name, an SSH tunnel. This field
 * is where an operator states the truth instead. It validates as you type
 * against the same rule the router apply enforces, so an address that could
 * never work is caught here rather than on a box across the network.
 */
function ManagedHostBaseUrlField({
  value,
  onChange,
  issue,
}: {
  value: string;
  onChange: (value: string) => void;
  issue: string | null;
}) {
  return (
    <div className="grid gap-2 border-t pt-4">
      <Label htmlFor="managed-host-base-url">PolySIEM address for managed hosts</Label>
      <Input
        id="managed-host-base-url"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="https://polysiem.lan:3000"
        maxLength={255}
        inputMode="url"
        spellCheck={false}
        aria-invalid={issue ? true : undefined}
        aria-describedby="managed-host-base-url-help"
        className="max-w-md"
      />
      <p id="managed-host-base-url-help" className="text-xs text-muted-foreground">
        Where privacy routers and connectors reach this instance — they download the SNI proxy and the installer from
        it, and connectors poll it. Leave blank to use APP_URL, or the address you are browsing PolySIEM on.
      </p>
      {issue && <p className="text-xs text-destructive">{issue}</p>}
    </div>
  );
}

export function InstanceSettingsForm({ initial }: { initial: InstanceSettingsView }) {
  const router = useRouter();
  const [instanceName, setInstanceName] = useState(initial.instanceName);
  const [managedHostBaseUrl, setManagedHostBaseUrl] = useState(initial.managedHostBaseUrl);
  const [defaultTheme, setDefaultTheme] = useState(initial.defaultTheme);
  const [threshold, setThreshold] = useState(String(initial.staleRemoveThreshold));
  const [autoUpdate, setAutoUpdate] = useState(initial.autoUpdate.enabled);

  // Blank is the documented "unset" value, so it is never an error.
  const trimmedBaseUrl = managedHostBaseUrl.trim();
  const baseUrlIssue = trimmedBaseUrl ? managedHostBaseUrlIssue(trimmedBaseUrl) : null;

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number.parseInt(threshold, 10);
      return apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          instanceName: instanceName.trim() || "PolySIEM",
          managedHostBaseUrl: trimmedBaseUrl,
          defaultTheme,
          staleRemoveThreshold: Number.isFinite(parsed) ? parsed : initial.staleRemoveThreshold,
          autoUpdate,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Instance settings saved");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <form
        className="contents"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <CardHeader>
          <CardTitle>Instance</CardTitle>
          <CardDescription>Global defaults for this PolySIEM installation.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="instance-name">Instance name</Label>
            <Input
              id="instance-name"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              maxLength={64}
              className="max-w-sm"
            />
            <p className="text-xs text-muted-foreground">Shown in the sidebar and browser title.</p>
          </div>
          <ManagedHostBaseUrlField
            value={managedHostBaseUrl}
            onChange={setManagedHostBaseUrl}
            issue={baseUrlIssue}
          />
          <div className="flex max-w-2xl items-start justify-between gap-5 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="auto-update">Automatic updates</Label>
              <p className="text-xs text-muted-foreground">
                {initial.autoUpdate.enforcedByDemo
                  ? "Required for the public demo so it follows the latest verified GitHub release."
                  : initial.autoUpdate.capable
                    ? "Checks every 15 minutes and uses the transactional host updater with backup, health verification, and rollback."
                    : "Available when PolySIEM is installed with the managed Linux Docker installer."}
              </p>
            </div>
            <Switch
              id="auto-update"
              checked={autoUpdate}
              onCheckedChange={setAutoUpdate}
              disabled={!initial.autoUpdate.capable || initial.autoUpdate.enforcedByDemo}
              aria-label="Automatically install verified PolySIEM releases"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="default-theme">Default theme for new users</Label>
            <Select value={defaultTheme} onValueChange={setDefaultTheme}>
              <SelectTrigger id="default-theme" className="max-w-sm capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {THEME_COLORS.map((c) => (
                  <SelectItem key={c} value={c} className="capitalize">
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="stale-threshold">Stale removal threshold</Label>
            <Input
              id="stale-threshold"
              type="number"
              min={1}
              max={100}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="max-w-32"
            />
            <p className="text-xs text-muted-foreground">
              Consecutive syncs an item can be missing before it is marked as removed.
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={save.isPending || baseUrlIssue !== null}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
