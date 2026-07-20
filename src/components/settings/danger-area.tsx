"use client";

import { useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  DatabaseBackup,
  Download,
  Loader2,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
  INSTANCE_ACTION_CONFIRMATIONS,
  type InstanceActionInput,
} from "@/lib/validators/instance";

type InstanceAction = InstanceActionInput["action"];

const ACTION_COPY: Record<
  InstanceAction,
  {
    title: string;
    description: string;
    button: string;
    pending: string;
    consequences: string[];
  }
> = {
  reset: {
    title: "Reset instance data",
    description:
      "Erase inventory, integrations, documentation, logs, tickets, settings, and other users while keeping your administrator account and this login.",
    button: "Reset instance",
    pending: "Resetting instance…",
    consequences: [
      "Your current administrator username, password, profile, and session are preserved.",
      "All other users, API tokens, integrations, inventory, docs, workflows, and settings are removed.",
      "PolySIEM remains installed and the first-run installer stays locked.",
    ],
  },
  reinstall: {
    title: "Reinstall PolySIEM",
    description:
      "Erase the entire instance, including every administrator account, then return to the first-run installer.",
    button: "Erase and reinstall",
    pending: "Preparing reinstall…",
    consequences: [
      "Every user account, session, setting, integration, and inventory record is removed.",
      "You are signed out immediately after the wipe.",
      "The installer reopens so a new root administrator can be created.",
    ],
  },
};

interface ApiErrorEnvelope {
  error?: { message?: string };
}

export function DangerArea({
  instanceName,
  adminUsername,
}: {
  instanceName: string;
  adminUsername: string;
}) {
  const [action, setAction] = useState<InstanceAction | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [backupPending, setBackupPending] = useState(false);
  const [backupDownloaded, setBackupDownloaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openAction(next: InstanceAction) {
    setAction(next);
    setPassword("");
    setConfirmation("");
    setError(null);
  }

  function closeAction() {
    if (submitting) return;
    setAction(null);
    setPassword("");
    setConfirmation("");
    setError(null);
  }

  async function downloadBackup() {
    setBackupPending(true);
    try {
      const response = await fetch("/api/admin/backup/export", { cache: "no-store" });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as ApiErrorEnvelope | null;
        throw new Error(body?.error?.message ?? "Could not create the backup");
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] ?? "polysiem-backup.json.gz";
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setBackupDownloaded(true);
      toast.success("Backup downloaded", { description: "Keep it somewhere safe before continuing." });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the backup");
    } finally {
      setBackupPending(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!action) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/instance/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, password, confirmation }),
      });
      const body = (await response.json().catch(() => null)) as
        | { data?: { redirectTo?: string }; error?: { message?: string } }
        | null;
      if (!response.ok) {
        throw new Error(body?.error?.message ?? "The instance could not be cleared");
      }
      // A full document navigation drops all client caches that may still hold
      // records from before the destructive operation.
      window.location.replace(body?.data?.redirectTo ?? (action === "reinstall" ? "/setup" : "/"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The instance could not be cleared");
      setSubmitting(false);
    }
  }

  const selected = action ? ACTION_COPY[action] : null;
  const expected = action ? INSTANCE_ACTION_CONFIRMATIONS[action] : "";
  const canSubmit = Boolean(password) && confirmation === expected && !submitting;

  return (
    <div className="space-y-6">
      <Card className="border-amber-500/35 bg-amber-500/5 ring-amber-500/25">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="size-4 text-amber-600 dark:text-amber-400" />
            Save a backup first
          </CardTitle>
          <CardDescription>
            Both actions permanently remove data. Download a complete backup now so this instance can be restored later.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" onClick={downloadBackup} disabled={backupPending}>
            {backupPending ? <Loader2 className="animate-spin" /> : <Download />}
            {backupPending ? "Creating backup…" : "Download current backup"}
          </Button>
          {backupDownloaded && (
            <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="size-3.5" /> Backup downloaded in this browser
            </span>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-destructive/25 ring-destructive/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <RotateCcw className="size-4" /> Reset instance data
            </CardTitle>
            <CardDescription>{ACTION_COPY.reset.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Preserved administrator: <span className="font-medium text-foreground">{adminUsername}</span>
            </p>
          </CardContent>
          <CardFooter className="mt-auto">
            <Button type="button" variant="destructive" onClick={() => openAction("reset")}>
              Reset instance…
            </Button>
          </CardFooter>
        </Card>

        <Card className="border-destructive/40 bg-destructive/3 ring-destructive/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="size-4" /> Reinstall PolySIEM
            </CardTitle>
            <CardDescription>{ACTION_COPY.reinstall.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Instance <span className="font-medium text-foreground">{instanceName}</span> returns to a completely uninstalled state.
            </p>
          </CardContent>
          <CardFooter className="mt-auto">
            <Button type="button" variant="destructive" onClick={() => openAction("reinstall")}>
              Reinstall PolySIEM…
            </Button>
          </CardFooter>
        </Card>
      </div>

      <Dialog open={action !== null} onOpenChange={(open) => !open && closeAction()}>
        <DialogContent className="sm:max-w-lg" showCloseButton={!submitting}>
          {selected && action && (
            <form onSubmit={submit} className="contents">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="size-4" /> {selected.title}?
                </DialogTitle>
                <DialogDescription>
                  This operation cannot be undone without a backup. Review exactly what will happen before confirming.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                  <ul className="list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
                    {selected.consequences.map((item) => <li key={item}>{item}</li>)}
                  </ul>
                </div>

                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                  <p className="mb-2 text-xs font-medium">Recommended: save a backup before continuing.</p>
                  <Button type="button" size="sm" variant="outline" onClick={downloadBackup} disabled={backupPending}>
                    {backupPending ? <Loader2 className="animate-spin" /> : backupDownloaded ? <CheckCircle2 /> : <Download />}
                    {backupPending ? "Creating backup…" : backupDownloaded ? "Download another backup" : "Download backup now"}
                  </Button>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="danger-password">Administrator password</Label>
                  <Input
                    id="danger-password"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="danger-confirmation">
                    Type <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{expected}</span> to confirm
                  </Label>
                  <Input
                    id="danger-confirmation"
                    value={confirmation}
                    onChange={(e) => setConfirmation(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={submitting}
                    required
                  />
                </div>

                {error && <p role="alert" className="text-sm font-medium text-destructive">{error}</p>}
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={closeAction} disabled={submitting}>Cancel</Button>
                <Button type="submit" variant="destructive" disabled={!canSubmit}>
                  {submitting && <Loader2 className="animate-spin" />}
                  {submitting ? selected.pending : selected.button}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
