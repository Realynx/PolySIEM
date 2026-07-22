"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, ChevronDown, KeyRound, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/components/shared/api-client";

export interface AiCredentialView {
  id: string;
  name: string;
  description: string | null;
  username: string | null;
  url: string | null;
  secretLength: number;
  createdAt: string;
  updatedAt: string;
}

function CredentialFields({
  isEdit, name, setName, description, setDescription, username, setUsername,
  url, setUrl, secret, setSecret,
}: {
  isEdit: boolean;
  name: string; setName: (value: string) => void;
  description: string; setDescription: (value: string) => void;
  username: string; setUsername: (value: string) => void;
  url: string; setUrl: (value: string) => void;
  secret: string; setSecret: (value: string) => void;
}) {
  return <div className="space-y-4 py-4">
    <div className="grid gap-2"><Label htmlFor="cred-name">Name</Label><Input id="cred-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. grafana-admin" required maxLength={64} pattern="[a-z0-9][a-z0-9\-_.]*" title="Lowercase slug: letters, digits, '-', '_' or '.'" className="font-mono" /><p className="text-xs text-muted-foreground">Lowercase slug — this is the name the AI passes to get_ai_credential.</p></div>
    <div className="grid gap-2"><Label htmlFor="cred-description">Description (optional)</Label><Textarea id="cred-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this credential is for — shown to the AI so it can pick the right one" maxLength={500} rows={2} /></div>
    <div className="grid gap-2"><Label htmlFor="cred-username">Username (optional)</Label><Input id="cred-username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="e.g. admin" maxLength={128} autoComplete="off" /></div>
    <div className="grid gap-2"><Label htmlFor="cred-url">URL (optional)</Label><Input id="cred-url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="e.g. https://grafana.lab.example" maxLength={512} autoComplete="off" /></div>
    <div className="grid gap-2"><Label htmlFor="cred-secret">{isEdit ? "New secret (optional)" : "Secret"}</Label><Input id="cred-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={isEdit ? "Leave blank to keep the current secret" : "Password, API key, token…"} maxLength={4096} autoComplete="new-password" required={!isEdit} /><p className="text-xs text-muted-foreground">Stored encrypted, never shown again.{isEdit ? " Leave blank to keep the existing secret." : ""}</p></div>
  </div>;
}

function useCredentialSave({
  credential, name, description, username, url, secret, onOpenChange, onSaved,
}: {
  credential: AiCredentialView | null;
  name: string;
  description: string;
  username: string;
  url: string;
  secret: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const isEdit = credential !== null;
  return useMutation({
    mutationFn: () => {
      const base = { name: name.trim(), description: description.trim() || undefined, username: username.trim() || undefined, url: url.trim() || undefined };
      if (!credential) return apiFetch("/api/admin/ai-credentials", { method: "POST", body: JSON.stringify({ ...base, secret }) });
      return apiFetch(`/api/admin/ai-credentials/${credential.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ...base, description: description.trim() || null, username: username.trim() || null, url: url.trim() || null, ...(secret.length > 0 ? { secret } : {}) }),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? `Updated "${name.trim()}"` : `Added "${name.trim()}"`);
      onOpenChange(false);
      onSaved();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

function useCredentialFields(open: boolean, credential: AiCredentialView | null) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(credential?.name ?? "");
    setDescription(credential?.description ?? "");
    setUsername(credential?.username ?? "");
    setUrl(credential?.url ?? "");
    setSecret("");
  }, [open, credential]);
  return { name, setName, description, setDescription, username, setUsername, url, setUrl, secret, setSecret };
}

const CREDENTIALS_KEY = ["admin-ai-credentials"];

export function AiCredentialsManager({
  initialCredentials,
}: {
  initialCredentials: AiCredentialView[];
}) {
  const queryClient = useQueryClient();
  const { data: credentials = [] } = useQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: () => apiFetch<AiCredentialView[]>("/api/admin/ai-credentials"),
    initialData: initialCredentials,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiCredentialView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AiCredentialView | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
  }

  const remove = useMutation({
    mutationFn: (c: AiCredentialView) =>
      apiFetch(`/api/admin/ai-credentials/${c.id}`, { method: "DELETE" }),
    onSuccess: (_d, c) => {
      toast.success(`Deleted "${c.name}"`);
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  function openCreate() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="AI credentials"
        description="Credentials AI assistants may fetch over MCP — exactly as secure as the MCP API token itself."
        actions={
          <Button onClick={openCreate}>
            <Plus className="size-4" /> Add credential
          </Button>
        }
      />

      <Card className="mb-6">
        <CardContent className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Bot className="size-5" />
          </div>
          <div className="min-w-0 text-sm">
            <p className="font-medium">A vault your AI assistants can read — nothing else can</p>
            <p className="mt-1 text-muted-foreground">
              Secrets are stored encrypted and are never shown again in this UI or returned by the
              REST API. Only MCP clients holding an API token with the{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">credentials</code> scope
              can fetch the decrypted value, and every read is written to the audit log. Only put
              credentials here that you are comfortable handing to an AI assistant.
            </p>
            <Collapsible className="mt-3">
              <CollapsibleTrigger className="group flex items-center gap-1 text-sm font-medium text-primary">
                How AI uses this
                <ChevronDown className="size-4 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>
                    Mint an <code className="font-mono text-xs">ps_</code> API token with the{" "}
                    <code className="font-mono text-xs">credentials</code> scope under Settings → API
                    tokens.
                  </li>
                  <li>
                    Connect your MCP client (Claude Desktop, Claude Code, …) to{" "}
                    <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">/api/mcp</code>{" "}
                    with that token.
                  </li>
                  <li>
                    The AI discovers what is available with{" "}
                    <code className="font-mono text-xs">list_ai_credentials</code> (names and
                    metadata only) and fetches a decrypted secret on demand with{" "}
                    <code className="font-mono text-xs">get_ai_credential</code>.
                  </li>
                </ol>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </CardContent>
      </Card>

      {credentials.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No AI credentials"
          description="Add a credential to let MCP-connected AI assistants fetch it on demand."
          action={
            <Button onClick={openCreate}>
              <Plus className="size-4" /> Add credential
            </Button>
          }
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>URL</TableHead>
                <TableHead>Secret</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {credentials.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono font-medium">{c.name}</TableCell>
                  <TableCell className="max-w-64 truncate text-muted-foreground">
                    {c.description ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.username ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-48 truncate font-mono text-xs text-muted-foreground">
                    {c.url ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {"•".repeat(Math.min(c.secretLength, 12))}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatRelative(c.updatedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Edit ${c.name}`}
                        title="Edit"
                        onClick={() => {
                          setEditTarget(c);
                          setDialogOpen(true);
                        }}
                      >
                        <Pencil className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete ${c.name}`}
                        title="Delete"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteTarget(c)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}

      <CredentialDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
        credential={editTarget}
        onSaved={invalidate}
      />

      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              AI assistants will no longer be able to fetch this credential. The encrypted secret is
              permanently removed and cannot be recovered.
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
              Delete credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CredentialDialog({
  open,
  onOpenChange,
  credential,
  onSaved,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: AiCredentialView | null;
  onSaved: () => void;
  onDelete?: () => void;
}) {
  const isEdit = credential !== null;
  const { name, setName, description, setDescription, username, setUsername, url, setUrl, secret, setSecret } = useCredentialFields(open, credential);

  const save = useCredentialSave({ credential, name, description, username, url, secret, onOpenChange, onSaved });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!isEdit && secret.length === 0) {
              toast.error("A secret value is required");
              return;
            }
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? "Edit AI credential" : "Add AI credential"}</DialogTitle>
            <DialogDescription>
              The secret is stored encrypted and never shown again — it is only readable by MCP
              tokens with the credentials scope.
            </DialogDescription>
          </DialogHeader>
          <CredentialFields {...{ isEdit, name, setName, description, setDescription, username, setUsername, url, setUrl, secret, setSecret }} />
          <DialogFooter>
            {isEdit && onDelete && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={onDelete}>
                <Trash2 className="size-4" /> Delete
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add credential"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
