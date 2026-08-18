"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  KeyRound,
  Loader2,
  Pencil,
  PlugZap,
  Plus,
  Trash2,
  TriangleAlert,
  Waypoints,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";
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
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ConnectorInstallDialog } from "./connector-install-dialog";
import {
  connectorAgentSummary,
  connectorContactFallback,
  connectorLastContactAt,
  connectorRotateTokenUrl,
  connectorStatusPresentation,
  connectorSummary,
  connectorUrl,
  connectorsListUrl,
  connectorsQueryKey,
  edgeTunnelEndpoint,
  isValidConnectorName,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type CreateConnectorResult,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "./edge-networks-types";

/**
 * Connectors list for one edge server. Shared with the NAT-rule dialog (same
 * query key), so a single fetch backs both the list and the route picker.
 */
export function useConnectorsQuery(
  integrationId: string,
  options?: { enabled?: boolean; refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: connectorsQueryKey(integrationId),
    queryFn: () => apiFetch<ConnectorDto[]>(connectorsListUrl(integrationId)),
    enabled: options?.enabled ?? true,
    refetchInterval: options?.refetchInterval ?? false,
  });
}

interface InstallRevealState {
  reveal: ConnectorInstallReveal;
  reason: ConnectorInstallReason;
  connector: ConnectorDto;
}

/**
 * Connectors sub-panel on an Edge server card. A connector is a reverse-tunnel
 * agent installed inside the private network: it dials OUT to this edge, so no
 * public IP or inbound port is needed at home. Its tunnel address is allocated
 * by PolySIEM and is presented read-only everywhere.
 */
export function ConnectorsCard({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [createOpen, setCreateOpen] = useState(false);
  const [install, setInstall] = useState<InstallRevealState | null>(null);
  const [editing, setEditing] = useState<ConnectorDto | null>(null);
  const [rotating, setRotating] = useState<ConnectorDto | null>(null);
  const [deleting, setDeleting] = useState<ConnectorDto | null>(null);

  const connectorsQuery = useConnectorsQuery(server.id, {
    enabled: server.enabled,
    // While the install dialog is open, watch the connector flip to "connected".
    refetchInterval: install ? 5_000 : false,
  });
  const connectors = connectorsQuery.data ?? [];
  const summary = connectorSummary(connectors);
  const endpoint = edgeTunnelEndpoint(server);

  return (
    <section className="overflow-hidden rounded-lg border" aria-labelledby={`connectors-${server.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <PlugZap className="size-4 text-primary" aria-hidden="true" />
          <h4 id={`connectors-${server.id}`} className="text-sm font-semibold">Connectors</h4>
          {summary.total > 0 && (
            <Badge variant={summary.connected > 0 ? "secondary" : "outline"} className="font-normal">
              {summary.connected > 0 && <span className="size-1.5 rounded-full bg-success" />}
              {summary.connected}/{summary.total} connected
            </Badge>
          )}
        </div>
        {isAdmin && (summary.total > 0 || connectorsQuery.isError) && (
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Add connector
          </Button>
        )}
      </div>

      <div className="space-y-3 p-3">
        <p className="text-xs text-muted-foreground">
          A connector <span className="font-medium text-foreground">dials out</span> from inside your network and holds
          the tunnel open. Routes set to <span className="font-medium text-foreground">Via connector</span> hand the last
          hop to it, so the target only has to be reachable from the connector — not from the edge.
        </p>

        {connectorsQuery.isLoading && <Skeleton className="h-24 w-full rounded-lg" />}
        {connectorsQuery.isError && (
          <p className="flex items-start gap-1.5 rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Connectors are unavailable: {(connectorsQuery.error as Error).message}
          </p>
        )}

        {!connectorsQuery.isLoading && !connectorsQuery.isError && connectors.length === 0 && (
          <ConnectorsEmptyState isAdmin={isAdmin} onAdd={() => setCreateOpen(true)} />
        )}

        {connectors.length > 0 && (
          <>
            <ul className="divide-y overflow-hidden rounded-lg border">
              {connectors.map((connector) => (
                <ConnectorRow
                  key={connector.id}
                  connector={connector}
                  isAdmin={isAdmin}
                  onEdit={() => setEditing(connector)}
                  onRotate={() => setRotating(connector)}
                  onDelete={() => setDeleting(connector)}
                />
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              Tunnel addresses are allocated by PolySIEM — you never assign one. Adding, disabling, or removing a
              connector takes effect on the edge after <span className="font-medium">Apply</span>.
            </p>
          </>
        )}
      </div>

      {isAdmin && (
        <CreateConnectorDialog
          server={server}
          open={createOpen}
          onOpenChange={setCreateOpen}
          onCreated={(result) => {
            setCreateOpen(false);
            setInstall({
              reveal: { installToken: result.installToken, installCommand: result.installCommand },
              reason: "created",
              connector: result.connector,
            });
          }}
        />
      )}

      {isAdmin && editing && (
        <EditConnectorDialog
          key={editing.id}
          server={server}
          connector={editing}
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}

      {isAdmin && rotating && (
        <RotateTokenDialog
          key={rotating.id}
          server={server}
          connector={rotating}
          onOpenChange={(open) => !open && setRotating(null)}
          onRotated={(connector, reveal) => {
            setRotating(null);
            setInstall({ reveal, reason: "rotated", connector });
          }}
        />
      )}

      {isAdmin && deleting && (
        <DeleteConnectorDialog
          key={deleting.id}
          server={server}
          connector={deleting}
          onOpenChange={(open) => !open && setDeleting(null)}
        />
      )}

      {install && (
        <ConnectorInstallDialog
          key={install.reveal.installToken}
          open
          onOpenChange={(open) => !open && setInstall(null)}
          reveal={install.reveal}
          reason={install.reason}
          connector={install.connector}
          liveConnector={connectors.find((entry) => entry.id === install.connector.id)}
          serverName={server.name}
          edgeEndpointLabel={endpoint.label}
        />
      )}
    </section>
  );
}

function ConnectorsEmptyState({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PlugZap className="size-5" aria-hidden="true" />
      </div>
      <p className="mt-3 font-medium">No connectors yet</p>
      <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
        A connector dials out from inside your network, so nothing needs a public IP or an inbound port — like a
        Cloudflare tunnel connector. Install one on a machine that can already reach the service you want to publish.
      </p>
      {isAdmin && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAdd}>
          <Plus /> Add connector
        </Button>
      )}
    </div>
  );
}

function ConnectorRow({
  connector,
  isAdmin,
  onEdit,
  onRotate,
  onDelete,
}: {
  connector: ConnectorDto;
  isAdmin: boolean;
  onEdit: () => void;
  onRotate: () => void;
  onDelete: () => void;
}) {
  const status = connectorStatusPresentation(connector);
  const contactAt = connectorLastContactAt(connector);
  const agent = connectorAgentSummary(connector);

  return (
    <li className={cn("p-3", connector.status === "disabled" && "bg-muted/20")}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-medium">{connector.name}</p>
            <Badge variant={status.variant} className={cn("font-normal", status.tone === "warning" && "text-warning")}>
              {status.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
              {status.label}
            </Badge>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">{status.hint}</p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon-sm" aria-label={`Edit ${connector.name}`} onClick={onEdit}>
              <Pencil />
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label={`Rotate install token for ${connector.name}`} onClick={onRotate}>
              <KeyRound />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              aria-label={`Delete ${connector.name}`}
              onClick={onDelete}
            >
              <Trash2 />
            </Button>
          </div>
        )}
      </div>

      <div className="mt-2.5 grid gap-3 sm:grid-cols-3">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Connector ID</p>
          <div className="flex items-center gap-1">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.connectorId}</code>
            <CopyButton value={connector.connectorId} label={`Copy the connector ID for ${connector.name}`} />
          </div>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Tunnel address</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <code className="truncate font-mono text-xs">{connector.tunnelAddress}</code>
            <span
              className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground"
              title="PolySIEM allocates this address — operators never assign it"
            >
              <Waypoints className="size-3" aria-hidden="true" /> assigned automatically
            </span>
          </p>
        </div>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Latest handshake</p>
          <p className="mt-0.5 truncate font-medium">
            {contactAt ? formatRelative(contactAt) : connectorContactFallback(connector)}
          </p>
        </div>
      </div>

      {(agent || connector.notes) && (
        <p className="mt-2 truncate text-xs text-muted-foreground">
          {agent}
          {agent && connector.notes ? " · " : ""}
          {connector.notes}
        </p>
      )}
    </li>
  );
}

function CreateConnectorDialog({
  server,
  open,
  onOpenChange,
  onCreated,
}: {
  server: EdgeNatServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateConnectorResult) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;

  const mutation = useMutation({
    // The integration is named twice on purpose: as the query parameter the list
    // endpoint already uses, and in the body, so either binding satisfies the API.
    mutationFn: () =>
      apiFetch<CreateConnectorResult>(connectorsListUrl(server.id), {
        method: "POST",
        body: JSON.stringify({
          integrationId: server.id,
          name: name.trim(),
          notes: notes.trim() || undefined,
        }),
      }),
    onSuccess: (result) => {
      toast.success(`${result.connector.name} created. Run the install command to bring it online.`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onCreated(result);
    },
    onError: (error: Error) => toast.error(`Could not create the connector: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("Give the connector a short descriptive name.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setName("");
          setNotes("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add connector</DialogTitle>
            <DialogDescription>
              Name the machine that will dial out to {server.name}. PolySIEM allocates its tunnel address and issues a
              one-time install token on the next screen.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor={`connector-name-${server.id}`}>Connector name</Label>
              <Input
                id={`connector-name-${server.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="EdgeNetworkVm"
                maxLength={64}
                autoFocus
                className={cn(nameError && "border-destructive")}
              />
              <p className={cn("text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
                {nameError
                  ? "Start with a letter or number; letters, numbers, spaces, dots, dashes and underscores only."
                  : "Use the hostname you will recognize later, e.g. the container or VM name."}
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`connector-notes-${server.id}`}>
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id={`connector-notes-${server.id}`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Proxmox LXC on the lab VLAN; reaches 10.0.3.0/24"
                maxLength={1000}
                rows={3}
              />
            </div>
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
              Nothing is installed yet. Creating the connector only reserves its identity and tunnel address — the
              machine enrolls itself when you run the install command.
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !nameValid}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              Create and show install command
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditConnectorDialog({
  server,
  connector,
  open,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connector.name);
  const [notes, setNotes] = useState(connector.notes ?? "");
  const [enabled, setEnabled] = useState(connector.status !== "disabled");
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success(`${name.trim()} updated. Apply changes to push it to the edge.`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not update the connector: ${error.message}`),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("Give the connector a short descriptive name.");
      return;
    }
    mutation.mutate({ name: name.trim(), notes: notes.trim() || null, disabled: !enabled });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Edit {connector.name}</DialogTitle>
            <DialogDescription>
              Rename the connector or record what it reaches. Its connector ID and tunnel address are fixed.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-connector-name-${connector.id}`}>Connector name</Label>
              <Input
                id={`edit-connector-name-${connector.id}`}
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={64}
                autoFocus
                className={cn(nameError && "border-destructive")}
              />
              {nameError && (
                <p className="text-xs text-destructive">
                  Start with a letter or number; letters, numbers, spaces, dots, dashes and underscores only.
                </p>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`edit-connector-notes-${connector.id}`}>
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id={`edit-connector-notes-${connector.id}`}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                maxLength={1000}
                rows={3}
              />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor={`edit-connector-enabled-${connector.id}`}>Connector enabled</Label>
                <p className="text-xs text-muted-foreground">
                  Disabling keeps the record but drops its tunnel peer from the edge on the next apply.
                </p>
              </div>
              <Switch
                id={`edit-connector-enabled-${connector.id}`}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <div className="grid gap-1 rounded-lg border bg-muted/20 p-3 text-xs">
              <p className="text-muted-foreground">
                Connector ID <code className="ml-1 font-mono text-foreground">{connector.connectorId}</code>
              </p>
              <p className="text-muted-foreground">
                Tunnel address <code className="ml-1 font-mono text-foreground">{connector.tunnelAddress}</code>
                <span className="ml-1">· assigned automatically</span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !nameValid}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Save connector
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RotateTokenDialog({
  server,
  connector,
  onOpenChange,
  onRotated,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
  onRotated: (connector: ConnectorDto, reveal: ConnectorInstallReveal) => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<ConnectorInstallReveal>(connectorRotateTokenUrl(connector.id), { method: "POST" }),
    onSuccess: (reveal) => {
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onRotated(connector, reveal);
    },
    onError: (error: Error) => toast.error(`Could not rotate the token: ${error.message}`),
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Issue a new install token for {connector.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            The token this connector is using stops working immediately, so it goes quiet until you re-run the install
            command on the machine. The new token is shown once, on the next screen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <KeyRound />}
            Rotate token
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function DeleteConnectorDialog({
  server,
  connector,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const routeCount = server.rules.filter((rule) => rule.connectorId === connector.id).length;
  const mutation = useMutation({
    mutationFn: () => apiFetch(connectorUrl(connector.id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${connector.name} removed. Apply changes to drop it from the edge.`);
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not remove the connector: ${error.message}`),
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {connector.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {routeCount > 0
              ? `${routeCount} route${routeCount === 1 ? "" : "s"} published through this connector will be removed with it. `
              : ""}
            The machine keeps running its agent until you uninstall it there, but the edge drops its tunnel peer after
            the next apply.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Remove connector
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
