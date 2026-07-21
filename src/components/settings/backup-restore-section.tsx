"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2, ShieldAlert, Upload } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";
import type { RestoreSummary } from "@/lib/backup/types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BACKUP_KEY } from "./backup-shared";

/** Multipart POST that speaks the `{ data } / { error }` API shape. */
async function postFile<T>(url: string, form: FormData, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(url, { method: "POST", body: form, headers });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON error page
  }
  if (!res.ok) {
    const message =
      (json as { error?: { message?: string } } | null)?.error?.message ??
      `Request failed with status ${res.status}`;
    throw new Error(message);
  }
  return (json as { data: T }).data;
}

/* ---------- section 1: backup now / restore ---------- */

export function BackupRestoreSection() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestoreSummary | null>(null);
  const [backupPassword, setBackupPassword] = useState("");
  const [backupPasswordConfirm, setBackupPasswordConfirm] = useState("");
  const [restorePassword, setRestorePassword] = useState("");

  const download = useMutation({
    mutationFn: async () => {
      if (backupPassword && (backupPassword.length < 8 || backupPassword.length > 1024)) {
        throw new Error("Backup password must be between 8 and 1024 characters");
      }
      if (backupPassword && backupPassword !== backupPasswordConfirm) {
        throw new Error("Backup passwords do not match");
      }
      const res = await fetch("/api/admin/backup/export", backupPassword
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ password: backupPassword }),
          }
        : undefined);
      if (!res.ok) {
        const json = await res.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(json?.error?.message ?? `Backup failed with status ${res.status}`);
      }
      const disposition = res.headers.get("content-disposition") ?? "";
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "polysiem-backup";
      const url = URL.createObjectURL(await res.blob());
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    },
    onSuccess: () => toast.success(backupPassword ? "Encrypted backup downloaded" : "Backup downloaded"),
    onError: (err: Error) => toast.error(err.message),
  });

  const runPreview = useMutation({
    mutationFn: ({ file, password }: { file: File; password: string }) => {
      const form = new FormData();
      form.append("file", file);
      if (password) form.append("password", password);
      return postFile<RestoreSummary>("/api/admin/backup/import?preview=1", form);
    },
    onSuccess: (summary) => setPreview(summary),
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  function onFilePicked(file: File | null) {
    if (!file) return;
    setPreview(null);
    setPendingFile(file);
    runPreview.mutate({ file, password: restorePassword });
  }

  function closeRestore() {
    setPreview(null);
    setPendingFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Backup now</h2>
        <p className="text-sm text-muted-foreground">
          Download a full archive of this instance, or restore one over the top of it. Add a password for portability.
        </p>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Download className="size-5" />
              </div>
              <div className="text-sm">
                <p className="font-medium">Download backup</p>
                <p className="mt-0.5 text-muted-foreground">
                  Add a password to make credentials portable. They will be re-encrypted for the destination
                  instance when restored.
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0"
              disabled={download.isPending || Boolean(backupPassword && backupPassword !== backupPasswordConfirm)}
              onClick={() => download.mutate()}
            >
              {download.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              {download.isPending ? "Preparing…" : backupPassword ? "Download encrypted" : "Download"}
            </Button>
          </div>
          <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="backup-password">Backup password (optional)</Label>
              <Input
                id="backup-password"
                type="password"
                value={backupPassword}
                onChange={(e) => setBackupPassword(e.target.value)}
                autoComplete="new-password"
                maxLength={1024}
                placeholder="At least 8 characters"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="backup-password-confirm">Confirm password</Label>
              <Input
                id="backup-password-confirm"
                type="password"
                value={backupPasswordConfirm}
                onChange={(e) => setBackupPasswordConfirm(e.target.value)}
                autoComplete="new-password"
                maxLength={1024}
                disabled={!backupPassword}
              />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Without a password, stored credentials remain encrypted for this instance only. PolySIEM cannot
              recover a forgotten backup password.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                <Upload className="size-5" />
              </div>
              <div className="text-sm">
                <p className="font-medium">Upload &amp; restore</p>
                <p className="mt-0.5 text-muted-foreground">
                  Replaces <strong>all</strong> current data with the contents of a backup archive. You will
                  be shown a summary and asked to confirm first.
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".gz,.json,.psbackup,application/gzip,application/vnd.polysiem.backup"
              className="hidden"
              onChange={(e) => onFilePicked(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              className="shrink-0"
              disabled={runPreview.isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {runPreview.isPending ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              {runPreview.isPending ? "Reading…" : "Choose backup file"}
            </Button>
          </div>
          <div className="grid gap-2 border-t pt-4">
            <Label htmlFor="restore-password">Backup password (for encrypted backups)</Label>
            <Input
              id="restore-password"
              type="password"
              value={restorePassword}
              onChange={(e) => setRestorePassword(e.target.value)}
              autoComplete="current-password"
              maxLength={1024}
              placeholder="Leave blank for an unencrypted backup"
            />
            {pendingFile && !preview && !runPreview.isPending && (
              <Button
                type="button"
                variant="secondary"
                className="w-fit"
                onClick={() => runPreview.mutate({ file: pendingFile, password: restorePassword })}
              >
                Try password
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <RestoreConfirmDialog
        summary={preview}
        file={pendingFile}
        password={restorePassword}
        onClose={closeRestore}
        onRestored={() => {
          closeRestore();
          queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
        }}
      />
    </section>
  );
}

function RestoreConfirmDialog({
  summary,
  file,
  password,
  onClose,
  onRestored,
}: {
  summary: RestoreSummary | null;
  file: File | null;
  password: string;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [confirmText, setConfirmText] = useState("");

  useEffect(() => {
    if (summary) setConfirmText("");
  }, [summary]);

  const restore = useMutation({
    mutationFn: () => {
      if (!file) throw new Error("No file selected");
      const form = new FormData();
      form.append("file", file);
      // Both a header and a form field so the server can require an explicit,
      // deliberate confirmation before this destructive operation runs.
      form.append("confirm", "true");
      if (password) form.append("password", password);
      return postFile<RestoreSummary>("/api/admin/backup/import", form, {
        "x-confirm-restore": "true",
      });
    },
    onSuccess: (result) => {
      toast.success(`Restored ${result.totalRows} rows from backup`);
      onRestored();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const rows = summary
    ? Object.entries(summary.counts).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    : [];

  return (
    <AlertDialog open={summary !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldAlert className="size-5" /> Restore will erase current data
          </AlertDialogTitle>
          <AlertDialogDescription>
            Every model is wiped and replaced with the archive&apos;s contents. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {summary && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-medium">{formatDateTime(summary.createdAt)}</p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-xs text-muted-foreground">Source instance</p>
                <p className="truncate font-medium">{summary.instanceName}</p>
              </div>
            </div>

            <div
              className={
                summary.secretsRestorable
                  ? "rounded-md border border-success/40 bg-success/10 p-3"
                  : "rounded-md border border-warning/40 bg-warning/10 p-3"
              }
            >
              {summary.secretsRestorable ? (
                <div className="text-success">
                  <p className="font-medium">
                    {summary.passwordProtected ? "Credentials included and ready to restore ✓" : "Secrets match this instance ✓"}
                  </p>
                  {summary.passwordProtected && (
                    <p className="mt-1 text-xs">
                      Stored credentials will be re-encrypted for this instance during restore.
                    </p>
                  )}
                </div>
              ) : (
                <p className="flex items-start gap-2 text-warning">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    <span className="font-medium">Secrets will not decrypt.</span> This archive was made on
                    an instance with a different APP_SECRET — encrypted credentials, tokens and keys will be
                    unreadable after restore.
                  </span>
                </p>
              )}
            </div>

            <div>
              <p className="mb-1 text-xs text-muted-foreground">
                {summary.totalRows} rows across {rows.length} models
              </p>
              <div className="max-h-40 overflow-y-auto rounded-md border">
                <table className="w-full text-xs">
                  <tbody>
                    {rows.map(([model, count]) => (
                      <tr key={model} className="border-b last:border-0">
                        <td className="px-3 py-1.5 font-mono">{model}</td>
                        <td className="px-3 py-1.5 text-right text-muted-foreground">{count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="restore-confirm">
                Type <span className="font-mono font-semibold">RESTORE</span> to confirm
              </Label>
              <Input
                id="restore-confirm"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
                placeholder="RESTORE"
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={confirmText !== "RESTORE" || restore.isPending}
            onClick={(e) => {
              e.preventDefault();
              restore.mutate();
            }}
          >
            {restore.isPending && <Loader2 className="size-4 animate-spin" />}
            Restore and replace everything
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
