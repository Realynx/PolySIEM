"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/components/shared/api-client";

export function ProfileForms({
  username,
  initialDisplayName,
  hasOtxKey,
}: {
  username: string;
  initialDisplayName: string;
  hasOtxKey: boolean;
}) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [otxKey, setOtxKey] = useState("");

  const saveOtxKey = useMutation({
    mutationFn: () =>
      apiFetch<{ detail?: string }>("/api/me/otx-key", {
        method: "PUT",
        body: JSON.stringify({ apiKey: otxKey.trim() }),
      }),
    onSuccess: (data) => {
      toast.success(data?.detail ? `OTX key saved — ${data.detail}` : "OTX key saved");
      setOtxKey("");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeOtxKey = useMutation({
    mutationFn: () => apiFetch("/api/me/otx-key", { method: "DELETE" }),
    onSuccess: () => {
      toast.success("OTX key removed");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const saveProfile = useMutation({
    mutationFn: () =>
      apiFetch("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ displayName: displayName.trim() || null }),
      }),
    onSuccess: () => {
      toast.success("Profile updated");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      apiFetch("/api/me", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
    onSuccess: () => {
      toast.success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New password and confirmation do not match");
      return;
    }
    changePassword.mutate();
  }

  return (
    <div className="space-y-6">
      <Card>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            saveProfile.mutate();
          }}
        >
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>How you appear across the dashboard.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="username">Username</Label>
              <Input id="username" value={username} readOnly disabled className="max-w-sm" />
              <p className="text-xs text-muted-foreground">Usernames cannot be changed.</p>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="displayName">Display name</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Ada Lovelace"
                maxLength={64}
                className="max-w-sm"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={saveProfile.isPending}>
              {saveProfile.isPending ? "Saving…" : "Save changes"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form className="contents" onSubmit={submitPassword}>
          <CardHeader>
            <CardTitle>Change password</CardTitle>
            <CardDescription>Changing your password signs out other sessions.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input
                id="currentPassword"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="max-w-sm"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="newPassword">New password</Label>
              <Input
                id="newPassword"
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="max-w-sm"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="max-w-sm"
              />
            </div>
          </CardContent>
          <CardFooter>
            <Button type="submit" disabled={changePassword.isPending}>
              {changePassword.isPending ? "Updating…" : "Update password"}
            </Button>
          </CardFooter>
        </form>
      </Card>

      <Card>
        <form
          className="contents"
          onSubmit={(e) => {
            e.preventDefault();
            if (otxKey.trim()) saveOtxKey.mutate();
          }}
        >
          <CardHeader>
            <CardTitle>Threat intelligence</CardTitle>
            <CardDescription>
              Connect your own AlienVault OTX account — the Threat intel page then shows{" "}
              <em>your</em> subscriptions instead of the shared instance feed. Get a free key at{" "}
              <a
                href="https://otx.alienvault.com/api"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                otx.alienvault.com/api
              </a>
              .
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {hasOtxKey && (
              <p className="text-sm text-muted-foreground">
                A personal OTX key is saved (stored encrypted, never shown again). Enter a new key to
                replace it.
              </p>
            )}
            <div className="grid gap-2">
              <Label htmlFor="otxKey">{hasOtxKey ? "Replace OTX key" : "OTX key"}</Label>
              <Input
                id="otxKey"
                type="password"
                autoComplete="off"
                value={otxKey}
                onChange={(e) => setOtxKey(e.target.value)}
                placeholder="Paste your OTX key"
                className="max-w-sm font-mono"
              />
            </div>
          </CardContent>
          <CardFooter className="gap-2">
            <Button type="submit" disabled={saveOtxKey.isPending || !otxKey.trim()}>
              {saveOtxKey.isPending ? "Checking key…" : "Save key"}
            </Button>
            {hasOtxKey && (
              <Button
                type="button"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={removeOtxKey.isPending}
                onClick={() => removeOtxKey.mutate()}
              >
                {removeOtxKey.isPending ? "Removing…" : "Remove key"}
              </Button>
            )}
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
