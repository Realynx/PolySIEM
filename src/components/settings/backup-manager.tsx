"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Cloud,
  CloudUpload,
  Download,
  Loader2,
  Pencil,
  Plus,
  PlugZap,
  ShieldAlert,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import type {
  BackupConfigDto,
  BackupDestinationDto,
  BackupRunDto,
  BackupStateDto,
  DestinationType,
  RestoreSummary,
} from "@/lib/backup/types";
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
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiFetch } from "@/components/shared/api-client";

const BACKUP_KEY = ["admin-backup"];

const TYPE_META: Record<DestinationType, { label: string }> = {
  s3: { label: "S3-compatible" },
  azure: { label: "Azure Blob" },
};

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

export function BackupManager({ initialState }: { initialState: BackupStateDto }) {
  const { data: state = initialState } = useQuery({
    queryKey: BACKUP_KEY,
    queryFn: () => apiFetch<BackupStateDto>("/api/admin/backup"),
    initialData: initialState,
  });

  const [addOpen, setAddOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<BackupDestinationDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BackupDestinationDto | null>(null);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Backup & restore"
        description="Export a full portable backup, push it to cloud storage, and schedule automatic backups."
      />

      <BackupRestoreSection />

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium">Cloud destinations</h2>
            <p className="text-sm text-muted-foreground">
              Where scheduled and manual backups are uploaded. Secrets are stored encrypted.
            </p>
          </div>
          <Button onClick={() => setAddOpen(true)}>
            <Plus className="size-4" /> Add destination
          </Button>
        </div>

        {state.destinations.length === 0 ? (
          <EmptyState
            icon={Cloud}
            title="No cloud destinations"
            description="Add an S3-compatible bucket or Azure Blob container to store backups off-box."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="size-4" /> Add destination
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            {state.destinations.map((d) => (
              <DestinationCard
                key={d.id}
                destination={d}
                onEdit={() => setEditTarget(d)}
                onDelete={() => setDeleteTarget(d)}
              />
            ))}
          </div>
        )}
      </section>

      <ScheduleSection config={state.config} destinations={state.destinations} />

      <HistorySection history={state.history} />

      <DestinationDialog open={addOpen} onOpenChange={setAddOpen} target={null} />
      <DestinationDialog
        open={editTarget !== null}
        onOpenChange={(open) => !open && setEditTarget(null)}
        target={editTarget}
      />
      <DeleteDestinationDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
    </div>
  );
}

/* ---------- section 1: backup now / restore ---------- */

function BackupRestoreSection() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<RestoreSummary | null>(null);

  const runPreview = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return postFile<RestoreSummary>("/api/admin/backup/import?preview=1", form);
    },
    onSuccess: (summary) => setPreview(summary),
    onError: (err: Error) => {
      toast.error(err.message);
      setPendingFile(null);
    },
  });

  function onFilePicked(file: File | null) {
    if (!file) return;
    setPendingFile(file);
    runPreview.mutate(file);
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
          Download a complete, portable archive of this instance, or restore one over the top of it.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Download className="size-5" />
            </div>
            <div className="text-sm">
              <p className="font-medium">Download backup</p>
              <p className="mt-0.5 text-muted-foreground">
                A single <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">.json.gz</code>{" "}
                archive of every model. Encrypted secrets are included as stored.
              </p>
            </div>
          </div>
          <Button asChild variant="outline" className="shrink-0">
            <a href="/api/admin/backup/export">
              <Download className="size-4" /> Download
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
            accept=".gz,.json,application/gzip"
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
        </CardContent>
      </Card>

      <RestoreConfirmDialog
        summary={preview}
        file={pendingFile}
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
  onClose,
  onRestored,
}: {
  summary: RestoreSummary | null;
  file: File | null;
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
                summary.secretMatches
                  ? "rounded-md border border-success/40 bg-success/10 p-3"
                  : "rounded-md border border-warning/40 bg-warning/10 p-3"
              }
            >
              {summary.secretMatches ? (
                <p className="flex items-center gap-2 font-medium text-success">
                  Secrets match this instance ✓
                </p>
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

/* ---------- section 2: destinations ---------- */

function DestinationCard({
  destination,
  onEdit,
  onDelete,
}: {
  destination: BackupDestinationDto;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const queryClient = useQueryClient();

  const test = useMutation({
    mutationFn: () =>
      apiFetch<{ ok: boolean; detail: string }>(
        `/api/admin/backup/destinations/${destination.id}/test`,
        { method: "POST" },
      ),
    onSuccess: (result) => {
      if (result.ok) toast.success(result.detail || "Connection successful");
      else toast.error(result.detail || "Connection failed");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const backupNow = useMutation({
    mutationFn: () =>
      apiFetch<BackupRunDto>(`/api/admin/backup/destinations/${destination.id}/upload`, {
        method: "POST",
      }),
    onSuccess: (run) => {
      if (run.ok) toast.success(`Backed up ${formatBytes(run.sizeBytes)} → ${run.objectKey}`);
      else toast.error(run.error ?? "Backup failed");
      queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-start gap-3 space-y-0">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Cloud className="size-5" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate font-medium">{destination.name}</p>
            <Badge variant="outline" className="shrink-0 text-xs">
              {TYPE_META[destination.type].label}
            </Badge>
          </div>
          <p className="truncate font-mono text-xs text-muted-foreground">{destination.location}</p>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" disabled={test.isPending} onClick={() => test.mutate()}>
            <PlugZap className="size-4" />
            {test.isPending ? "Testing…" : "Test"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={backupNow.isPending}
            onClick={() => backupNow.mutate()}
          >
            {backupNow.isPending ? <Loader2 className="size-4 animate-spin" /> : <CloudUpload className="size-4" />}
            {backupNow.isPending ? "Backing up…" : "Back up now"}
          </Button>
          <Button variant="outline" size="sm" onClick={onEdit}>
            <Pencil className="size-4" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="ml-auto text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface DestForm {
  type: DestinationType;
  name: string;
  // s3
  endpoint: string;
  region: string;
  bucket: string;
  s3Prefix: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  // azure
  azureMode: "sas" | "sharedKey";
  sasUrl: string;
  accountName: string;
  accountKey: string;
  container: string;
  azurePrefix: string;
}

function emptyForm(type: DestinationType = "s3"): DestForm {
  return {
    type,
    name: "",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    s3Prefix: "polysiem/backups/",
    accessKeyId: "",
    secretAccessKey: "",
    forcePathStyle: false,
    azureMode: "sas",
    sasUrl: "",
    accountName: "",
    accountKey: "",
    container: "",
    azurePrefix: "polysiem/backups/",
  };
}

interface EditableDestination {
  id: string;
  name: string;
  type: DestinationType;
  config: Record<string, unknown>;
}

function DestinationDialog({
  open,
  onOpenChange,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: BackupDestinationDto | null;
}) {
  const queryClient = useQueryClient();
  const isEdit = target !== null;
  const [form, setForm] = useState<DestForm>(() => emptyForm());

  // On edit, pull the non-secret config so the form can be pre-filled.
  const { data: editable } = useQuery({
    queryKey: ["admin-backup-destination", target?.id],
    queryFn: () => apiFetch<EditableDestination>(`/api/admin/backup/destinations/${target!.id}`),
    enabled: open && isEdit,
  });

  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      setForm(emptyForm());
      return;
    }
    if (editable) {
      const c = editable.config;
      setForm({
        ...emptyForm(editable.type),
        type: editable.type,
        name: editable.name,
        endpoint: (c.endpoint as string) ?? "",
        region: (c.region as string) ?? "us-east-1",
        bucket: (c.bucket as string) ?? "",
        s3Prefix: (c.prefix as string) ?? "",
        accessKeyId: (c.accessKeyId as string) ?? "",
        forcePathStyle: Boolean(c.forcePathStyle),
        azureMode: (c.mode as "sas" | "sharedKey") ?? "sas",
        accountName: (c.accountName as string) ?? "",
        container: (c.container as string) ?? "",
        azurePrefix: (c.prefix as string) ?? "",
      });
    }
  }, [open, isEdit, editable]);

  function set<K extends keyof DestForm>(key: K, value: DestForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: () => {
      const config = buildConfig(form, isEdit);
      if (isEdit) {
        return apiFetch(`/api/admin/backup/destinations/${target!.id}`, {
          method: "PATCH",
          body: JSON.stringify({ name: form.name.trim(), config }),
        });
      }
      return apiFetch("/api/admin/backup/destinations", {
        method: "POST",
        body: JSON.stringify({ type: form.type, name: form.name.trim(), config }),
      });
    },
    onSuccess: () => {
      toast.success(isEdit ? `Updated ${form.name}` : `Added ${form.name}`);
      onOpenChange(false);
      queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
      if (target) queryClient.invalidateQueries({ queryKey: ["admin-backup-destination", target.id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const hasSecret =
    form.type === "s3"
      ? Boolean(editable?.config.hasSecretAccessKey)
      : form.azureMode === "sas"
        ? Boolean(editable?.config.hasSasUrl)
        : Boolean(editable?.config.hasAccountKey);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? `Edit ${target.name}` : "Add cloud destination"}</DialogTitle>
            <DialogDescription>
              Secrets are stored encrypted and never returned. {isEdit && "Leave a secret blank to keep it."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {!isEdit && (
              <div className="grid gap-2">
                <Label htmlFor="dest-type">Type</Label>
                <Select value={form.type} onValueChange={(v) => set("type", v as DestinationType)}>
                  <SelectTrigger id="dest-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="s3">S3-compatible (AWS S3, Backblaze B2, MinIO, Wasabi)</SelectItem>
                    <SelectItem value="azure">Azure Blob Storage</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="dest-name">Name</Label>
              <Input
                id="dest-name"
                value={form.name}
                onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. b2-offsite"
                required
                maxLength={64}
              />
            </div>

            {form.type === "s3" ? (
              <S3Fields form={form} set={set} isEdit={isEdit} hasSecret={hasSecret} />
            ) : (
              <AzureFields form={form} set={set} isEdit={isEdit} hasSecret={hasSecret} />
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : isEdit ? "Save changes" : "Add destination"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function buildConfig(form: DestForm, isEdit: boolean): Record<string, unknown> {
  if (form.type === "s3") {
    const config: Record<string, unknown> = {
      endpoint: form.endpoint.trim(),
      region: form.region.trim(),
      bucket: form.bucket.trim(),
      prefix: form.s3Prefix.trim(),
      accessKeyId: form.accessKeyId.trim(),
      forcePathStyle: form.forcePathStyle,
    };
    // Write-only secret: only send it when the user typed one (blank = keep).
    if (!isEdit || form.secretAccessKey.trim()) config.secretAccessKey = form.secretAccessKey.trim();
    return config;
  }
  if (form.azureMode === "sas") {
    const config: Record<string, unknown> = { mode: "sas" };
    if (!isEdit || form.sasUrl.trim()) config.sasUrl = form.sasUrl.trim();
    return config;
  }
  const config: Record<string, unknown> = {
    mode: "sharedKey",
    accountName: form.accountName.trim(),
    container: form.container.trim(),
    prefix: form.azurePrefix.trim(),
  };
  if (!isEdit || form.accountKey.trim()) config.accountKey = form.accountKey.trim();
  return config;
}

function S3Fields({
  form,
  set,
  isEdit,
  hasSecret,
}: {
  form: DestForm;
  set: <K extends keyof DestForm>(key: K, value: DestForm[K]) => void;
  isEdit: boolean;
  hasSecret: boolean;
}) {
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="grid gap-2">
        <Label htmlFor="s3-endpoint">Endpoint</Label>
        <Input
          id="s3-endpoint"
          value={form.endpoint}
          onChange={(e) => set("endpoint", e.target.value)}
          placeholder="https://s3.us-east-1.amazonaws.com"
          required
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <Label htmlFor="s3-region">Region</Label>
          <Input
            id="s3-region"
            value={form.region}
            onChange={(e) => set("region", e.target.value)}
            placeholder="us-east-1"
            required
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="s3-bucket">Bucket</Label>
          <Input
            id="s3-bucket"
            value={form.bucket}
            onChange={(e) => set("bucket", e.target.value)}
            placeholder="my-backups"
            required
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s3-prefix">Key prefix</Label>
        <Input
          id="s3-prefix"
          value={form.s3Prefix}
          onChange={(e) => set("s3Prefix", e.target.value)}
          placeholder="polysiem/backups/"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s3-access-key">Access key ID</Label>
        <Input
          id="s3-access-key"
          value={form.accessKeyId}
          onChange={(e) => set("accessKeyId", e.target.value)}
          required
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="s3-secret">
          Secret access key
          {isEdit && hasSecret && <span className="ml-2 text-xs text-muted-foreground">stored ✓</span>}
        </Label>
        <Input
          id="s3-secret"
          type="password"
          value={form.secretAccessKey}
          onChange={(e) => set("secretAccessKey", e.target.value)}
          placeholder={isEdit && hasSecret ? "•••••••• (unchanged)" : ""}
          required={!isEdit}
          autoComplete="off"
        />
      </div>
      <div className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div className="space-y-0.5">
          <Label htmlFor="s3-path-style">Force path-style addressing</Label>
          <p className="text-xs text-muted-foreground">Required by Backblaze B2, MinIO and some others.</p>
        </div>
        <Switch
          id="s3-path-style"
          checked={form.forcePathStyle}
          onCheckedChange={(v) => set("forcePathStyle", v)}
        />
      </div>
    </div>
  );
}

function AzureFields({
  form,
  set,
  isEdit,
  hasSecret,
}: {
  form: DestForm;
  set: <K extends keyof DestForm>(key: K, value: DestForm[K]) => void;
  isEdit: boolean;
  hasSecret: boolean;
}) {
  return (
    <div className="space-y-4 rounded-md border p-3">
      <div className="grid gap-2">
        <Label htmlFor="azure-mode">Authentication</Label>
        <Select value={form.azureMode} onValueChange={(v) => set("azureMode", v as "sas" | "sharedKey")}>
          <SelectTrigger id="azure-mode">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="sas">Container SAS URL (simplest)</SelectItem>
            <SelectItem value="sharedKey">Account name &amp; key</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {form.azureMode === "sas" ? (
        <div className="grid gap-2">
          <Label htmlFor="azure-sas">
            Container SAS URL
            {isEdit && hasSecret && <span className="ml-2 text-xs text-muted-foreground">stored ✓</span>}
          </Label>
          <Input
            id="azure-sas"
            type="password"
            value={form.sasUrl}
            onChange={(e) => set("sasUrl", e.target.value)}
            placeholder={
              isEdit && hasSecret
                ? "•••••••• (unchanged)"
                : "https://acct.blob.core.windows.net/container?sv=…&sig=…"
            }
            required={!isEdit}
            autoComplete="off"
          />
          <p className="text-xs text-muted-foreground">
            The full SAS URL — including its token — is the whole credential and is stored encrypted.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-2">
              <Label htmlFor="azure-account">Account name</Label>
              <Input
                id="azure-account"
                value={form.accountName}
                onChange={(e) => set("accountName", e.target.value)}
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="azure-container">Container</Label>
              <Input
                id="azure-container"
                value={form.container}
                onChange={(e) => set("container", e.target.value)}
                required
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="azure-key">
              Account key
              {isEdit && hasSecret && <span className="ml-2 text-xs text-muted-foreground">stored ✓</span>}
            </Label>
            <Input
              id="azure-key"
              type="password"
              value={form.accountKey}
              onChange={(e) => set("accountKey", e.target.value)}
              placeholder={isEdit && hasSecret ? "•••••••• (unchanged)" : ""}
              required={!isEdit}
              autoComplete="off"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="azure-prefix">Blob prefix</Label>
            <Input
              id="azure-prefix"
              value={form.azurePrefix}
              onChange={(e) => set("azurePrefix", e.target.value)}
              placeholder="polysiem/backups/"
            />
          </div>
        </>
      )}
    </div>
  );
}

function DeleteDestinationDialog({
  target,
  onClose,
}: {
  target: BackupDestinationDto | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: string) => apiFetch(`/api/admin/backup/destinations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`Deleted ${target?.name}`);
      onClose();
      queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return (
    <AlertDialog open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete &quot;{target?.name}&quot;?</AlertDialogTitle>
          <AlertDialogDescription>
            PolySIEM forgets this destination and its credentials. Backups already uploaded to it are not
            touched. If a schedule points here it becomes download-only.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={(e) => {
              e.preventDefault();
              if (target) remove.mutate(target.id);
            }}
          >
            {remove.isPending && <Loader2 className="size-4 animate-spin" />}
            Delete destination
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* ---------- section 3: schedule ---------- */

function ScheduleSection({
  config,
  destinations,
}: {
  config: BackupConfigDto;
  destinations: BackupDestinationDto[];
}) {
  const queryClient = useQueryClient();
  const [schedule, setSchedule] = useState(config.schedule);
  const [destinationId, setDestinationId] = useState(config.destinationId);
  const [retention, setRetention] = useState(String(config.retention));

  // Re-seed from server whenever the query refreshes the config.
  useEffect(() => {
    setSchedule(config.schedule);
    setDestinationId(config.destinationId);
    setRetention(String(config.retention));
  }, [config.schedule, config.destinationId, config.retention]);

  const save = useMutation({
    mutationFn: () => {
      const parsed = Number.parseInt(retention, 10);
      return apiFetch<BackupConfigDto>("/api/admin/backup/config", {
        method: "PUT",
        body: JSON.stringify({
          schedule,
          destinationId,
          retention: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Schedule saved");
      queryClient.invalidateQueries({ queryKey: BACKUP_KEY });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const noDestinations = destinations.length === 0;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Automatic backups</h2>
        <p className="text-sm text-muted-foreground">
          Run a backup on a schedule and push it to a destination. The scheduler checks roughly every five
          minutes.
        </p>
      </div>
      <Card>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="grid gap-2">
              <Label htmlFor="sched-freq">Frequency</Label>
              <Select value={schedule} onValueChange={(v) => setSchedule(v as BackupConfigDto["schedule"])}>
                <SelectTrigger id="sched-freq">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="off">Off</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-dest">Destination</Label>
              <Select
                value={destinationId || "none"}
                onValueChange={(v) => setDestinationId(v === "none" ? "" : v)}
                disabled={noDestinations}
              >
                <SelectTrigger id="sched-dest">
                  <SelectValue placeholder="Select a destination" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None (download only)</SelectItem>
                  {destinations.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sched-retention">Keep last (0 = all)</Label>
              <Input
                id="sched-retention"
                type="number"
                min={0}
                max={365}
                value={retention}
                onChange={(e) => setRetention(e.target.value)}
              />
            </div>
          </div>
          {schedule !== "off" && !destinationId && (
            <p className="text-sm text-warning">
              Pick a destination — a schedule with no destination never uploads anything.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={() => save.mutate()} disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save schedule"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/* ---------- section 4: history ---------- */

function HistorySection({ history }: { history: BackupRunDto[] }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-medium">Recent backups</h2>
        <p className="text-sm text-muted-foreground">The last {history.length || "few"} backup runs.</p>
      </div>
      {history.length === 0 ? (
        <EmptyState
          icon={CloudUpload}
          title="No backups yet"
          description="Manual and scheduled backup runs will appear here."
        />
      ) : (
        <ListCard>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Destination</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Result</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-muted-foreground" title={formatDateTime(run.at)}>
                    {formatRelative(run.at)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {run.trigger}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{run.destinationName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {run.ok ? formatBytes(run.sizeBytes) : "—"}
                  </TableCell>
                  <TableCell>
                    {run.ok ? (
                      <Badge variant="outline" className="border-success/40 bg-success/10 text-success">
                        OK
                      </Badge>
                    ) : (
                      <span
                        className="inline-flex max-w-xs items-center gap-1 truncate text-destructive"
                        title={run.error ?? "Failed"}
                      >
                        <AlertTriangle className="size-3.5 shrink-0" />
                        <span className="truncate">{run.error ?? "Failed"}</span>
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </ListCard>
      )}
    </section>
  );
}
