"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/components/shared/api-client";
import type { ApiTokenView } from "@/components/settings/api-tokens-manager";
import { CopyButton } from "@/components/ssh/copy-button";
import { formatRelative } from "@/lib/format";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";
import {
  MobileEmpty,
  MobileKeyRow,
  MobileList,
  MobileListRow,
} from "@/components/mobile/ui/mobile-list";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";

/** Same cache key as the desktop `ApiTokensManager` so both views stay in sync. */
const TOKENS_KEY = ["admin-api-tokens"];

/** Mirrors the scope catalog rendered by the desktop create-token dialog. */
const SCOPE_INFO: { value: string; label: string; description: string }[] = [
  { value: "read", label: "read", description: "Read inventory, networks, docs, and search" },
  { value: "write_docs", label: "write_docs", description: "Create and update documentation pages" },
  { value: "trigger_sync", label: "trigger_sync", description: "Trigger integration syncs" },
  { value: "credentials", label: "credentials", description: "Read AI credential store secrets" },
];

function tokenState(t: ApiTokenView): "revoked" | "expired" | null {
  if (t.revokedAt) return "revoked";
  if (t.expiresAt !== null && new Date(t.expiresAt).getTime() < Date.now()) return "expired";
  return null;
}

/**
 * Phone API-token management: rows into a detail sheet with revoke/delete, a
 * FAB into the create form, and the mandatory one-time raw-token reveal. Same
 * /api/admin/api-tokens endpoints as the desktop `ApiTokensManager`.
 */
export function MobileApiTokensSettingsPage({ initialTokens }: { initialTokens: ApiTokenView[] }) {
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => apiFetch<ApiTokenView[]>("/api/admin/api-tokens"),
    initialData: initialTokens,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(null);
  const target = tokens.find((t) => t.id === targetId) ?? null;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: TOKENS_KEY });

  return (
    <>
      <MobilePageHeader title="API tokens" backHref="/settings" />
      <MobilePage>
        {tokens.length === 0 ? (
          <MobileEmpty
            icon={<KeyRound />}
            title="No API tokens"
            description="Create a token to let MCP clients and scripts talk to PolySIEM."
          />
        ) : (
          <MobileList>
            {tokens.map((t) => {
              const state = tokenState(t);
              return (
                <MobileListRow
                  key={t.id}
                  onClick={() => setTargetId(t.id)}
                  className={state ? "opacity-60" : undefined}
                  title={
                    <>
                      <span className="truncate">{t.name}</span>
                      {state === "revoked" && (
                        <Badge
                          variant="outline"
                          className="border-destructive/40 bg-destructive/10 text-destructive"
                        >
                          Revoked
                        </Badge>
                      )}
                      {state === "expired" && (
                        <Badge variant="outline" className="border-warning/40 bg-warning/10 text-warning">
                          Expired
                        </Badge>
                      )}
                    </>
                  }
                  subtitle={`${t.tokenPrefix}… · ${t.scopes.join(", ")}`}
                  trailing={t.lastUsedAt ? `used ${formatRelative(t.lastUsedAt)}` : "never used"}
                />
              );
            })}
          </MobileList>
        )}
        <p className="px-0.5 text-xs text-muted-foreground">
          Tokens authorize the MCP endpoint at <code className="font-mono">/api/mcp</code> and the
          REST API. Client setup snippets are available on the desktop view.
        </p>
      </MobilePage>

      <MobileFab aria-label="Create API token" onClick={() => setCreateOpen(true)}>
        <Plus />
      </MobileFab>

      <CreateTokenSheet
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(raw) => {
          setCreatedToken(raw);
          invalidate();
        }}
      />

      <BottomSheet
        open={createdToken !== null}
        onOpenChange={(open) => !open && setCreatedToken(null)}
        title="Token created"
        description="Copy it now — for security reasons it cannot be shown again."
      >
        <div className="flex flex-col gap-3 pt-1">
          <code className="overflow-x-auto rounded-md border bg-muted px-3 py-2 font-mono text-xs break-all">
            {createdToken}
          </code>
          <div className="flex items-center gap-2">
            <CopyButton value={createdToken ?? ""} label="Copy token" />
            <Button className="ml-auto" onClick={() => setCreatedToken(null)}>
              Done
            </Button>
          </div>
        </div>
      </BottomSheet>

      <TokenDetailSheet token={target} onClose={() => setTargetId(null)} onChanged={invalidate} />
    </>
  );
}

function CreateTokenSheet({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (rawToken: string) => void;
}) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [expiresInDays, setExpiresInDays] = useState("");

  const create = useMutation({
    mutationFn: () => {
      const days = Number.parseInt(expiresInDays, 10);
      return apiFetch<{ token: string }>("/api/admin/api-tokens", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresInDays: Number.isFinite(days) && days > 0 ? days : null,
        }),
      });
    },
    onSuccess: (data) => {
      toast.success(`Token "${name}" created`);
      onOpenChange(false);
      setName("");
      setScopes(["read"]);
      setExpiresInDays("");
      onCreated(data.token);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function toggleScope(scope: string, checked: boolean) {
    setScopes((prev) => (checked ? [...new Set([...prev, scope])] : prev.filter((s) => s !== scope)));
  }

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Create API token"
      description="The token value is shown exactly once after creation."
    >
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (scopes.length === 0) {
            toast.error("Select at least one scope");
            return;
          }
          create.mutate();
        }}
      >
        <div className="grid gap-2">
          <Label htmlFor="m-token-name">Name</Label>
          <Input
            id="m-token-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. claude-desktop"
            required
            maxLength={64}
          />
        </div>
        <div className="grid gap-2">
          <Label>Scopes</Label>
          {SCOPE_INFO.map((s) => (
            <label key={s.value} className="flex items-start gap-2 rounded-md border p-3 text-sm">
              <Checkbox
                checked={scopes.includes(s.value)}
                onCheckedChange={(v) => toggleScope(s.value, v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="font-mono font-medium">{s.label}</span>
                <span className="block text-muted-foreground">{s.description}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="m-token-expiry">Expires in days (optional)</Label>
          <Input
            id="m-token-expiry"
            type="number"
            min={1}
            max={3650}
            value={expiresInDays}
            onChange={(e) => setExpiresInDays(e.target.value)}
            placeholder="never"
          />
        </div>
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending && <Loader2 className="animate-spin" />}
          {create.isPending ? "Creating…" : "Create token"}
        </Button>
      </form>
    </BottomSheet>
  );
}

function TokenDetailSheet({
  token,
  onClose,
  onChanged,
}: {
  token: ApiTokenView | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState<"revoke" | "delete" | null>(null);

  const revoke = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/api-tokens/${token!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ revoke: true }),
      }),
    onSuccess: () => {
      toast.success(`Revoked "${token?.name}"`);
      setConfirm(null);
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/admin/api-tokens/${token!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted "${token?.name}"`);
      setConfirm(null);
      onClose();
      onChanged();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
      <BottomSheet
        open={token !== null}
        onOpenChange={(open) => !open && onClose()}
        title={token?.name ?? ""}
        description="Bearer token for the MCP endpoint and API automation."
      >
        {token && (
          <div className="flex flex-col gap-4 pt-1">
            <div className="divide-y divide-border/60 rounded-xl border bg-card">
              <MobileKeyRow label="Token" mono>
                {token.tokenPrefix}…
              </MobileKeyRow>
              <MobileKeyRow label="Scopes" mono>
                {token.scopes.join(", ")}
              </MobileKeyRow>
              <MobileKeyRow label="Owner">{token.username}</MobileKeyRow>
              <MobileKeyRow label="Created">{formatRelative(token.createdAt)}</MobileKeyRow>
              <MobileKeyRow label="Last used">
                {token.lastUsedAt ? formatRelative(token.lastUsedAt) : "never"}
              </MobileKeyRow>
              <MobileKeyRow label="Expires">
                {token.expiresAt ? formatRelative(token.expiresAt) : "never"}
              </MobileKeyRow>
              {token.revokedAt && (
                <MobileKeyRow label="Revoked">{formatRelative(token.revokedAt)}</MobileKeyRow>
              )}
            </div>
            <div className="flex flex-col gap-2">
              {!token.revokedAt && (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => setConfirm("revoke")}
                >
                  Revoke token
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirm("delete")}
              >
                Delete token
              </Button>
            </div>
          </div>
        )}
      </BottomSheet>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm === "revoke" ? "Revoke" : "Delete"} &quot;{token?.name}&quot;?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "revoke"
                ? "Clients using this token will stop working immediately. The row stays for auditing."
                : "Permanently removes the token record. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoke.isPending || remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (confirm === "revoke") revoke.mutate();
                else remove.mutate();
              }}
            >
              {(revoke.isPending || remove.isPending) && <Loader2 className="animate-spin" />}
              {confirm === "revoke" ? "Revoke token" : "Delete token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
