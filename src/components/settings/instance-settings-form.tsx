"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { THEME_COLORS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  defaultTheme: string;
  staleRemoveThreshold: number;
}

export function InstanceSettingsForm({ initial }: { initial: InstanceSettingsView }) {
  const router = useRouter();
  const [instanceName, setInstanceName] = useState(initial.instanceName);
  const [defaultTheme, setDefaultTheme] = useState(initial.defaultTheme);
  const [threshold, setThreshold] = useState(String(initial.staleRemoveThreshold));

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number.parseInt(threshold, 10);
      return apiFetch("/api/admin/settings", {
        method: "PATCH",
        body: JSON.stringify({
          instanceName: instanceName.trim() || "PolySIEM",
          defaultTheme,
          staleRemoveThreshold: Number.isFinite(parsed) ? parsed : initial.staleRemoveThreshold,
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
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
