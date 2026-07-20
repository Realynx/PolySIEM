"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm({
  demoCredentials,
}: {
  demoCredentials?: { username: string; password: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState(demoCredentials?.username ?? "");
  const [password, setPassword] = useState(demoCredentials?.password ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(body?.error?.message ?? "Sign in failed");
        return;
      }
      // Only allow same-origin relative paths; reject protocol-relative
      // ("//evil.com") and backslash ("/\\evil.com") open-redirect payloads.
      const next = searchParams.get("next");
      const safeNext =
        next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
      router.push(safeNext);
      router.refresh();
    } catch {
      setError("Could not reach the server");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <form onSubmit={onSubmit} className="space-y-4">
          {demoCredentials && (
            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 text-sm">
              <div className="flex items-center gap-2 font-medium text-primary">
                <LockKeyhole className="size-4" /> Public read-only demo
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                The shared credentials are filled in. Sign in to explore; saved
                changes and administrative actions are locked.
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading && <Loader2 className="size-4 animate-spin" />}
            Sign in
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
