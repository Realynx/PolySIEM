"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SectionCard } from "@/components/inventory/detail-bits";
import { apiFetch } from "@/components/shared/api-client";

export interface DeploymentRow {
  id: string;
  entityType: string;
  username: string;
  method: string;
  notes: string | null;
  hostLabel: string | null;
  device: { id: string; name: string } | null;
  vm: { id: string; name: string } | null;
  container: { id: string; name: string } | null;
}

export interface EntityOptions {
  devices: { id: string; name: string }[];
  vms: { id: string; name: string }[];
  containers: { id: string; name: string }[];
}

const METHOD_LABELS: Record<string, string> = {
  manual: "manual",
  "proxmox-cloudinit": "Proxmox cloud-init",
  script: "script",
};

const ENTITY_HREF: Record<string, string> = {
  device: "/inventory/hosts",
  vm: "/inventory/vms",
  container: "/inventory/containers",
};

function targetOf(d: DeploymentRow): { name: string; href: string | null } {
  const entity = d.device ?? d.vm ?? d.container;
  if (entity) {
    return { name: entity.name, href: `${ENTITY_HREF[d.entityType] ?? "/inventory/hosts"}/${entity.id}` };
  }
  return { name: d.hostLabel ?? "unknown host", href: null };
}

/** Where-is-this-key-authorized card: deployment rows + add/remove. */
export function DeploymentsCard({
  keyId,
  deployments,
  options,
}: {
  keyId: string;
  deployments: DeploymentRow[];
  options: EntityOptions;
}) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DeploymentRow | null>(null);

  const [entityType, setEntityType] = useState<"device" | "vm" | "container" | "other">("device");
  const [entityId, setEntityId] = useState("");
  const [hostLabel, setHostLabel] = useState("");
  const [username, setUsername] = useState("root");
  const [method, setMethod] = useState<"manual" | "script" | "proxmox-cloudinit">("manual");
  const [notes, setNotes] = useState("");

  const entityLists: Record<string, { id: string; name: string }[]> = {
    device: options.devices,
    vm: options.vms,
    container: options.containers,
  };

  const add = useMutation({
    mutationFn: () =>
      apiFetch(`/api/keys/${keyId}/deployments`, {
        method: "POST",
        body: JSON.stringify({
          entityType,
          ...(entityType === "device" ? { deviceId: entityId } : {}),
          ...(entityType === "vm" ? { vmId: entityId } : {}),
          ...(entityType === "container" ? { containerId: entityId } : {}),
          ...(entityType === "other" ? { hostLabel: hostLabel.trim() } : {}),
          username: username.trim() || "root",
          method,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        }),
      }),
    onSuccess: () => {
      toast.success("Deployment recorded");
      setAddOpen(false);
      setEntityId("");
      setHostLabel("");
      setNotes("");
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (deploymentId: string) =>
      apiFetch(`/api/keys/${keyId}/deployments/${deploymentId}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Deployment record removed");
      setRemoveTarget(null);
      router.refresh();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const canAdd = entityType === "other" ? hostLabel.trim().length > 0 : entityId.length > 0;

  return (
    <SectionCard
      title="Deployments"
      count={deployments.length}
      flush
      action={
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="size-3.5" /> Add
        </Button>
      }
    >
      {deployments.length === 0 ? (
        <p className="px-6 py-6 text-sm text-muted-foreground">
          Not recorded on any machine yet. Add a deployment for each machine and account whose{" "}
          <span className="font-mono text-xs">authorized_keys</span> contains this key.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Machine</TableHead>
              <TableHead>User</TableHead>
              <TableHead className="hidden sm:table-cell">Method</TableHead>
              <TableHead className="hidden md:table-cell">Notes</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {deployments.map((d) => {
              const target = targetOf(d);
              return (
                <TableRow key={d.id}>
                  <TableCell>
                    {target.href ? (
                      <Link
                        href={target.href}
                        className="font-medium underline-offset-4 hover:text-primary hover:underline"
                      >
                        {target.name}
                      </Link>
                    ) : (
                      <span className="font-medium">{target.name}</span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{d.username}</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <Badge variant="secondary">{METHOD_LABELS[d.method] ?? d.method}</Badge>
                  </TableCell>
                  <TableCell className="hidden max-w-56 truncate text-muted-foreground md:table-cell">
                    {d.notes ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8 text-muted-foreground hover:text-destructive"
                      aria-label="Remove deployment record"
                      onClick={() => setRemoveTarget(d)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <Dialog open={addOpen} onOpenChange={(v) => !add.isPending && setAddOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record a deployment</DialogTitle>
            <DialogDescription>
              Document that this key is authorized on a machine. This only updates PolySIEM — use the
              Install section to actually add the key.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (canAdd) add.mutate();
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Machine type</Label>
                <Select
                  value={entityType}
                  onValueChange={(v) => {
                    setEntityType(v as typeof entityType);
                    setEntityId("");
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="device">Host / device</SelectItem>
                    <SelectItem value="vm">Virtual machine</SelectItem>
                    <SelectItem value="container">Container</SelectItem>
                    <SelectItem value="other">Not in inventory</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                {entityType === "other" ? (
                  <>
                    <Label htmlFor="dep-host">Host</Label>
                    <Input
                      id="dep-host"
                      placeholder="e.g. github.com, router"
                      value={hostLabel}
                      onChange={(e) => setHostLabel(e.target.value)}
                    />
                  </>
                ) : (
                  <>
                    <Label>Machine</Label>
                    <Select value={entityId} onValueChange={setEntityId}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Pick a machine" />
                      </SelectTrigger>
                      <SelectContent>
                        {(entityLists[entityType] ?? []).map((e) => (
                          <SelectItem key={e.id} value={e.id}>
                            {e.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="dep-user">Account</Label>
                <Input
                  id="dep-user"
                  placeholder="root"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Method</Label>
                <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="script">Install script</SelectItem>
                    <SelectItem value="proxmox-cloudinit">Proxmox cloud-init</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep-notes">Notes (optional)</Label>
              <Input id="dep-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" disabled={add.isPending} onClick={() => setAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={add.isPending || !canAdd}>
                {add.isPending && <Loader2 className="animate-spin" />}
                Record deployment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={removeTarget !== null} onOpenChange={(v) => !v && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deployment record?</AlertDialogTitle>
            <AlertDialogDescription>
              Only the PolySIEM record is removed —{" "}
              {removeTarget ? `${removeTarget.username}@${targetOf(removeTarget).name}` : "the machine"}
              &apos;s authorized_keys file is untouched. Remove the key there yourself if you mean to
              revoke access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (removeTarget) remove.mutate(removeTarget.id);
              }}
            >
              {remove.isPending && <Loader2 className="animate-spin" />}
              Remove record
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SectionCard>
  );
}
