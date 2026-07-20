"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import type { AiCredentialView } from "@/components/credentials/ai-credentials-manager";
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
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileFab } from "@/components/mobile/ui/mobile-fab";

// Same key as the desktop AiCredentialsManager so the caches are shared.
const CREDENTIALS_KEY = ["admin-ai-credentials"];

/**
 * Phone admin AI-credential vault: list rows open the edit dialog, the FAB
 * creates. Secrets stay write-only — never displayed, blank on edit keeps the
 * stored value — exactly like the desktop manager.
 */
export function MobileAiCredentials({ initialCredentials }: { initialCredentials: AiCredentialView[] }) {
  const queryClient = useQueryClient();
  const { data: credentials = [] } = useQuery({
    queryKey: CREDENTIALS_KEY,
    queryFn: () => apiFetch<AiCredentialView[]>("/api/admin/ai-credentials"),
    initialData: initialCredentials,
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<AiCredentialView | null>(null);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: CREDENTIALS_KEY });
  }

  function openCreate() {
    setEditTarget(null);
    setDialogOpen(true);
  }

  return (
    <>
      <MobilePageHeader title="AI credentials" />
      <MobilePage>
        <p className="px-0.5 text-xs leading-relaxed text-muted-foreground">
          Credentials AI assistants may fetch over MCP. Secrets are stored encrypted and never shown
          again — only MCP tokens with the <code className="font-mono">credentials</code> scope can
          read them, and every read is audited.
        </p>

        {credentials.length === 0 ? (
          <MobileEmpty
            icon={<KeyRound />}
            title="No AI credentials"
            description="Add a credential to let MCP-connected AI assistants fetch it on demand."
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="size-4" /> Add credential
              </Button>
            }
          />
        ) : (
          <MobileSection title={`Credentials · ${credentials.length}`}>
            <MobileList>
              {credentials.map((c) => (
                <MobileListRow
                  key={c.id}
                  onClick={() => {
                    setEditTarget(c);
                    setDialogOpen(true);
                  }}
                  title={
                    <>
                      <span className="min-w-0 truncate font-mono">{c.name}</span>
                      <Badge variant="secondary" className="shrink-0 px-1 font-mono text-[0.6rem]">
                        {"•".repeat(Math.min(Math.max(c.secretLength, 1), 8))}
                      </Badge>
                    </>
                  }
                  subtitle={c.description ?? c.url ?? "—"}
                  trailing={<span>{formatRelative(c.updatedAt)}</span>}
                />
              ))}
            </MobileList>
          </MobileSection>
        )}
      </MobilePage>

      <MobileFab aria-label="Add credential" onClick={openCreate}>
        <Plus />
      </MobileFab>

      <MobileCredentialDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditTarget(null);
        }}
        credential={editTarget}
        onSaved={invalidate}
      />
    </>
  );
}

/**
 * Create/edit form — the desktop CredentialDialog's fields against the same
 * endpoints (it isn't exported, so the minimal presentation is mirrored here).
 * Editing adds a delete action so rows don't need a second touch target.
 */
function MobileCredentialDialog({
  open,
  onOpenChange,
  credential,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credential: AiCredentialView | null;
  onSaved: () => void;
}) {
  const isEdit = credential !== null;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [username, setUsername] = useState("");
  const [url, setUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Re-seed the form whenever the dialog opens for a different target.
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = credential?.id ?? "new";
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setName(credential?.name ?? "");
    setDescription(credential?.description ?? "");
    setUsername(credential?.username ?? "");
    setUrl(credential?.url ?? "");
    setSecret("");
  }
  if (!open && seededFor !== null) setSeededFor(null);

  const save = useMutation({
    mutationFn: () => {
      const base = {
        name: name.trim(),
        description: description.trim() || undefined,
        username: username.trim() || undefined,
        url: url.trim() || undefined,
      };
      if (isEdit) {
        return apiFetch(`/api/admin/ai-credentials/${credential.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            ...base,
            description: description.trim() || null,
            username: username.trim() || null,
            url: url.trim() || null,
            // Blank secret = keep the stored one.
            ...(secret.length > 0 ? { secret } : {}),
          }),
        });
      }
      return apiFetch("/api/admin/ai-credentials", {
        method: "POST",
        body: JSON.stringify({ ...base, secret }),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? `Updated "${name.trim()}"` : `Added "${name.trim()}"`);
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: () => apiFetch(`/api/admin/ai-credentials/${credential!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted "${credential?.name}"`);
      setConfirmDelete(false);
      onOpenChange(false);
      onSaved();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <>
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
            <div className="space-y-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="m-cred-name">Name</Label>
                <Input
                  id="m-cred-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. grafana-admin"
                  required
                  maxLength={64}
                  pattern="[a-z0-9][a-z0-9\-_.]*"
                  title="Lowercase slug: letters, digits, '-', '_' or '.'"
                  className="font-mono"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-cred-description">Description (optional)</Label>
                <Textarea
                  id="m-cred-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this credential is for"
                  maxLength={500}
                  rows={2}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-cred-username">Username (optional)</Label>
                <Input
                  id="m-cred-username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. admin"
                  maxLength={128}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-cred-url">URL (optional)</Label>
                <Input
                  id="m-cred-url"
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="e.g. https://grafana.lab.example"
                  maxLength={512}
                  autoComplete="off"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="m-cred-secret">{isEdit ? "New secret (optional)" : "Secret"}</Label>
                <Input
                  id="m-cred-secret"
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder={isEdit ? "Leave blank to keep the current secret" : "Password, API key, token…"}
                  maxLength={4096}
                  autoComplete="new-password"
                  required={!isEdit}
                />
                <p className="text-xs text-muted-foreground">
                  Stored encrypted, never shown again.
                  {isEdit ? " Leave blank to keep the existing secret." : ""}
                </p>
              </div>
            </div>
            <DialogFooter>
              {isEdit && (
                <Button
                  type="button"
                  variant="destructive"
                  className="sm:mr-auto"
                  onClick={() => setConfirmDelete(true)}
                >
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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{credential?.name}&quot;?</AlertDialogTitle>
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
                remove.mutate();
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Delete credential
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
