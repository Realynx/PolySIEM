"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { PrivacyStatusCard } from "@/components/privacy/privacy-status-card";

type PrivacyField = "anonymousMode" | "shieldOnCapture" | "shieldOnBlur";

interface PrivacyFormProps {
  initialAnonymousMode: boolean;
  initialShieldOnCapture: boolean;
  initialShieldOnBlur: boolean;
}

export function PrivacyForm({
  initialAnonymousMode,
  initialShieldOnCapture,
  initialShieldOnBlur,
}: PrivacyFormProps) {
  const router = useRouter();
  const [values, setValues] = useState<Record<PrivacyField, boolean>>({
    anonymousMode: initialAnonymousMode,
    shieldOnCapture: initialShieldOnCapture,
    shieldOnBlur: initialShieldOnBlur,
  });

  const save = useMutation({
    mutationFn: ({ field, value }: { field: PrivacyField; value: boolean }) =>
      apiFetch("/api/me", { method: "PATCH", body: JSON.stringify({ [field]: value }) }),
    onSuccess: () => router.refresh(),
    onError: (err: Error, { field, value }) => {
      setValues((prev) => ({ ...prev, [field]: !value }));
      toast.error(err.message);
    },
  });

  function toggle(field: PrivacyField, value: boolean) {
    setValues((prev) => ({ ...prev, [field]: value }));
    save.mutate({ field, value });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Anonymization</CardTitle>
          <CardDescription>Hide identifying details everywhere data is displayed.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex max-w-2xl items-start justify-between gap-5">
            <div className="space-y-1">
              <Label htmlFor="anonymous-mode">Anonymous mode</Label>
              <p className="text-xs text-muted-foreground">
                Replace real names, hostnames, and IP addresses with consistent pseudonyms everywhere
                data is displayed. While active, avoid editing items — edit forms may be prefilled
                with pseudonyms instead of real values.
              </p>
            </div>
            <Switch
              id="anonymous-mode"
              checked={values.anonymousMode}
              onCheckedChange={(v) => toggle("anonymousMode", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Capture shield</CardTitle>
          <CardDescription>Automatic protection when the screen may be recorded or captured.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex max-w-2xl items-start justify-between gap-5">
            <div className="space-y-1">
              <Label htmlFor="shield-on-capture">Auto-anonymize when screen capture is detected</Label>
              <p className="text-xs text-muted-foreground">
                Best-effort detection of tab/screen recording. When a capture signal fires, anonymous
                mode engages automatically.
              </p>
            </div>
            <Switch
              id="shield-on-capture"
              checked={values.shieldOnCapture}
              onCheckedChange={(v) => toggle("shieldOnCapture", v)}
            />
          </div>
          <div className="flex max-w-2xl items-start justify-between gap-5 border-t pt-4">
            <div className="space-y-1">
              <Label htmlFor="shield-on-blur">Shield on focus loss &amp; PrintScreen</Label>
              <p className="text-xs text-muted-foreground">
                Instantly blur and anonymize the dashboard when the window loses focus, is hidden, or
                PrintScreen is pressed.
              </p>
            </div>
            <Switch
              id="shield-on-blur"
              checked={values.shieldOnBlur}
              onCheckedChange={(v) => toggle("shieldOnBlur", v)}
            />
          </div>
          <p className="max-w-2xl text-xs text-muted-foreground">
            Browsers cannot see OS-level screenshots of a focused window, so the shield covers screen
            recordings, focus loss, and repeat screenshots — not the very first PrintScreen frame.
          </p>
        </CardContent>
      </Card>

      <PrivacyStatusCard />
    </div>
  );
}
