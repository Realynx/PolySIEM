"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { CredentialDialog, type AiCredentialView } from "@/components/credentials/ai-credentials-manager";
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
  const [confirmDelete, setConfirmDelete] = useState(false);

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
      <CredentialDialog
        open={open}
        onOpenChange={onOpenChange}
        credential={credential}
        onSaved={onSaved}
        onDelete={() => setConfirmDelete(true)}
      />

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
