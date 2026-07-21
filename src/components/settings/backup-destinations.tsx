"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cloud, CloudUpload, Loader2, Pencil, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/format";
import type { BackupDestinationDto, BackupRunDto, DestinationType } from "@/lib/backup/types";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { apiFetch } from "@/components/shared/api-client";
import { BACKUP_KEY, BACKUP_TYPE_META } from "./backup-shared";
import {
  buildDestinationConfig,
  destinationFormForEdit,
  destinationHasStoredSecret,
  emptyDestinationForm,
  type DestinationForm,
  type EditableDestination,
} from "./backup-destination-model";

/* ---------- section 2: destinations ---------- */

export function DestinationCard({
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
              {BACKUP_TYPE_META[destination.type].label}
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

export function DestinationDialog({
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
  const [form, setForm] = useState<DestinationForm>(() => emptyDestinationForm());

  // On edit, pull the non-secret config so the form can be pre-filled.
  const { data: editable } = useQuery({
    queryKey: ["admin-backup-destination", target?.id],
    queryFn: () => apiFetch<EditableDestination>(`/api/admin/backup/destinations/${target!.id}`),
    enabled: open && isEdit,
  });

  useEffect(() => {
    if (!open) return;
    if (!isEdit) {
      setForm(emptyDestinationForm());
      return;
    }
    if (editable) {
      setForm(destinationFormForEdit(editable));
    }
  }, [open, isEdit, editable]);

  function set<K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const save = useMutation({
    mutationFn: () => {
      const config = buildDestinationConfig(form, isEdit);
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

  const hasSecret = destinationHasStoredSecret(form, editable);

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

function S3Fields({
  form,
  set,
  isEdit,
  hasSecret,
}: {
  form: DestinationForm;
  set: <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => void;
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
  form: DestinationForm;
  set: <K extends keyof DestinationForm>(key: K, value: DestinationForm[K]) => void;
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

export function DeleteDestinationDialog({
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
