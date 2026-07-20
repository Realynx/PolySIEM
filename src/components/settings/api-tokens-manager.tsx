"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, Copy, KeyRound, Loader2, Plus, ShieldOff, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ListCard } from "@/components/inventory/list-card";
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
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/components/shared/api-client";

export interface ApiTokenView {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  username: string;
}

const SCOPE_INFO: { value: string; label: string; description: string }[] = [
  { value: "read", label: "read", description: "Read inventory, networks, docs, and search" },
  { value: "write_docs", label: "write_docs", description: "Create and update documentation pages" },
  { value: "trigger_sync", label: "trigger_sync", description: "Trigger integration syncs" },
  { value: "credentials", label: "credentials", description: "Read AI credential store secrets" },
];

const TOKENS_KEY = ["admin-api-tokens"];

export function ApiTokensManager({
  initialTokens,
  appUrl,
}: {
  initialTokens: ApiTokenView[];
  appUrl: string;
}) {
  const queryClient = useQueryClient();
  const { data: tokens = [] } = useQuery({
    queryKey: TOKENS_KEY,
    queryFn: () => apiFetch<ApiTokenView[]>("/api/admin/api-tokens"),
    initialData: initialTokens,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<ApiTokenView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiTokenView | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: TOKENS_KEY });
  }

  const revoke = useMutation({
    mutationFn: (t: ApiTokenView) =>
      apiFetch(`/api/admin/api-tokens/${t.id}`, {
        method: "PATCH",
        body: JSON.stringify({ revoke: true }),
      }),
    onSuccess: (_d, t) => {
      toast.success(`Revoked "${t.name}"`);
      setRevokeTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (t: ApiTokenView) => apiFetch(`/api/admin/api-tokens/${t.id}`, { method: "DELETE" }),
    onSuccess: (_d, t) => {
      toast.success(`Deleted "${t.name}"`);
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <div>
      <PageHeader
        title="API tokens"
        description="Bearer tokens for the MCP endpoint and API automation."
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" /> Create token
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="size-5" />
          </div>
          <div className="text-sm">
            <p className="font-medium">Connect an AI assistant via MCP</p>
            <p className="mt-1 text-muted-foreground">
              PolySIEM exposes a Model Context Protocol server at{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/mcp</code>. Point Claude
              Desktop, Claude Code, or any MCP-capable client at it with a token below and it can search your
              lab, read inventory, write documentation, and trigger syncs — scoped to exactly what the token
              allows.
            </p>
          </div>
        </CardContent>
      </Card>

      {tokens.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API tokens"
          description="Create a token to let MCP clients and scripts talk to PolySIEM."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="size-4" /> Create token
            </Button>
          }
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Token</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last used</TableHead>
                <TableHead>Expires</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tokens.map((t) => {
                const expired = t.expiresAt !== null && new Date(t.expiresAt).getTime() < Date.now();
                const dead = t.revokedAt !== null || expired;
                return (
                  <TableRow key={t.id} className={dead ? "opacity-60" : undefined}>
                    <TableCell className="font-medium">
                      {t.name}
                      {t.revokedAt && (
                        <Badge
                          variant="outline"
                          className="ml-2 border-destructive/40 bg-destructive/10 text-destructive"
                        >
                          Revoked
                        </Badge>
                      )}
                      {!t.revokedAt && expired && (
                        <Badge variant="outline" className="ml-2 border-warning/40 bg-warning/10 text-warning">
                          Expired
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{t.tokenPrefix}…</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {t.scopes.map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-xs">
                            {s}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{formatRelative(t.createdAt)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.lastUsedAt ? formatRelative(t.lastUsedAt) : "never"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t.expiresAt ? formatRelative(t.expiresAt) : "never"}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {!t.revokedAt && (
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Revoke ${t.name}`}
                            title="Revoke"
                            onClick={() => setRevokeTarget(t)}
                          >
                            <ShieldOff className="size-4" />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${t.name}`}
                          title="Delete"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(t)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </ListCard>
      )}

      <CreateTokenDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(raw) => {
          setCreatedToken(raw);
          invalidate();
        }}
      />
      <ShowTokenDialog token={createdToken} appUrl={appUrl} onClose={() => setCreatedToken(null)} />

      <AlertDialog open={revokeTarget !== null} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke &quot;{revokeTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Clients using this token will stop working immediately. The row stays for auditing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revoke.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (revokeTarget) revoke.mutate(revokeTarget);
              }}
            >
              {revoke.isPending && <Loader2 className="animate-spin" />}
              Revoke token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Permanently removes the token record. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) remove.mutate(deleteTarget);
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CreateTokenDialog({
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (scopes.length === 0) {
              toast.error("Select at least one scope");
              return;
            }
            create.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>Create API token</DialogTitle>
            <DialogDescription>The token value is shown exactly once after creation.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="token-name">Name</Label>
              <Input
                id="token-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. claude-desktop"
                required
                maxLength={64}
              />
            </div>
            <div className="grid gap-2">
              <Label>Scopes</Label>
              <div className="space-y-2">
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
            </div>
            <div className="grid gap-2">
              <Label htmlFor="token-expiry">Expires in days (optional)</Label>
              <Input
                id="token-expiry"
                type="number"
                min={1}
                max={3650}
                value={expiresInDays}
                onChange={(e) => setExpiresInDays(e.target.value)}
                placeholder="never"
                className="max-w-32"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? "Creating…" : "Create token"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          toast.error("Could not access the clipboard");
        }
      }}
    >
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? "Copied" : label}
    </Button>
  );
}

function ShowTokenDialog({
  token,
  appUrl,
  onClose,
}: {
  token: string | null;
  appUrl: string;
  onClose: () => void;
}) {
  const origin = appUrl || (typeof window !== "undefined" ? window.location.origin : "");
  const mcpConfig = token
    ? JSON.stringify(
        {
          mcpServers: {
            polysiem: {
              type: "http",
              url: `${origin}/api/mcp`,
              headers: { Authorization: `Bearer ${token}` },
            },
          },
        },
        null,
        2,
      )
    : "";
  const claudeCommand = token
    ? `claude mcp add --transport http polysiem ${origin}/api/mcp --header "Authorization: Bearer ${token}"`
    : "";

  return (
    <Dialog open={token !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Token created</DialogTitle>
          <DialogDescription>
            Copy it now — for security reasons it cannot be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-2">
            <Label>API token</Label>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md border bg-muted px-3 py-2 font-mono text-xs">
                {token}
              </code>
              <CopyButton text={token ?? ""} label="Copy" />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>MCP client configuration</Label>
              <CopyButton text={mcpConfig} label="Copy config" />
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">{mcpConfig}</pre>
            <p className="text-xs text-muted-foreground">
              Paste into your MCP client&apos;s configuration (e.g. Claude Desktop&apos;s{" "}
              <code className="font-mono">claude_desktop_config.json</code>).
            </p>
          </div>
          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label>Claude Code</Label>
              <CopyButton text={claudeCommand} label="Copy command" />
            </div>
            <pre className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs">{claudeCommand}</pre>
            <p className="text-xs text-muted-foreground">
              Run in a terminal to add PolySIEM as an MCP server for Claude Code in one step.
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
