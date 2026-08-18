"use client";

import { type FormEvent, type ReactNode, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Loader2, Pencil, Plus, Power, Terminal, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { copyText } from "@/components/shared/clipboard";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileEmpty, MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorAgentSummary,
  connectorContactFallback,
  connectorInstallProgress,
  connectorLastContactAt,
  connectorRotateTokenUrl,
  connectorStatusPresentation,
  connectorSummary,
  connectorUrl,
  connectorsListUrl,
  connectorsQueryKey,
  isValidConnectorName,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReason,
  type ConnectorInstallReveal,
  type CreateConnectorResult,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "@/components/network/edge-networks-types";

/**
 * Connector list for one edge integration. Shares the desktop query key, DTOs
 * and derivations (presentation forks, data does not) — only the surface is
 * phone-native. Declared here rather than imported from the desktop card so the
 * phone bundle never pulls the desktop tree in.
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

/** The one-time reveal plus the context the install sheet needs to track progress. */
interface InstallReveal extends ConnectorInstallReveal {
  connector: ConnectorDto;
  reason: ConnectorInstallReason;
  /** `lastSeenAt` when the sheet opened, so a rotate only claims success on a re-check-in. */
  baselineLastSeenAt: string | null;
}

function ConnectorStatusBadge({ connector }: { connector: Pick<ConnectorDto, "status"> }) {
  const view = connectorStatusPresentation(connector);
  return (
    <Badge
      variant={view.variant}
      className={cn("text-[10px] font-normal", view.tone === "warning" && "text-warning")}
    >
      {view.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
      {view.label}
    </Badge>
  );
}

/** Relative handshake/heartbeat line for a row or detail sheet. */
function contactLabel(connector: ConnectorDto): string {
  const at = connectorLastContactAt(connector);
  return at ? formatRelative(at) : connectorContactFallback(connector);
}

/**
 * Phone connector block for an edge server: the reverse-tunnel agents that let
 * the edge publish home services with no public IP. Details and every action
 * live in bottom sheets.
 */
export function MobileConnectorsBlock({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorDto | null>(null);
  const [reveal, setReveal] = useState<InstallReveal | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectorDto | null>(null);

  // While the install sheet is open the operator is watching for the connector
  // to check in, so poll hard; otherwise the list rides the page refresh.
  const connectorsQuery = useConnectorsQuery(server.id, {
    enabled: server.enabled,
    refetchInterval: reveal ? 5_000 : false,
  });
  const connectors = connectorsQuery.data ?? [];
  const summary = connectorSummary(connectors);
  const selected = connectors.find((connector) => connector.id === selectedId) ?? null;

  const openReveal = (connector: ConnectorDto, minted: ConnectorInstallReveal, reason: ConnectorInstallReason) => {
    setSelectedId(null);
    setReveal({ ...minted, connector, reason, baselineLastSeenAt: connector.lastSeenAt });
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className="flex items-center gap-1.5 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
          <Cable className="size-3.5" /> Connectors
        </span>
        {summary.total > 0 && (
          <Badge variant={summary.connected > 0 ? "secondary" : "outline"} className="text-[10px] font-normal">
            {summary.connected > 0 && <span className="size-1.5 rounded-full bg-success" />}
            {summary.connected}/{summary.total} connected
          </Badge>
        )}
      </div>

      {connectorsQuery.isLoading && <Skeleton className="h-24 rounded-xl" />}
      {connectorsQuery.isError && (
        <p className="flex items-start gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Connectors unavailable: {(connectorsQuery.error as Error).message}
        </p>
      )}

      {!connectorsQuery.isLoading && !connectorsQuery.isError && summary.total === 0 && (
        <MobileEmpty
          icon={<Cable />}
          title="No connectors"
          description="A connector runs on an internal machine and dials out to the edge, so ports can be published without a public IP at home."
        />
      )}

      {summary.total > 0 && (
        <MobileList>
          {connectors.map((connector) => (
            <MobileListRow
              key={connector.id}
              onClick={() => setSelectedId(connector.id)}
              title={
                <>
                  <span className="truncate">{connector.name}</span>
                  <ConnectorStatusBadge connector={connector} />
                </>
              }
              subtitle={<span className="font-mono">{connector.connectorId}</span>}
              trailing={<span className="max-w-24 truncate">{contactLabel(connector)}</span>}
            />
          ))}
        </MobileList>
      )}

      {isAdmin && server.enabled && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
          <Plus /> Add connector
        </Button>
      )}
      <p className="px-0.5 text-[11px] text-muted-foreground">
        Each connector dials out over WireGuard and keeps the tunnel open. Its tunnel address is assigned
        automatically — you never type one.
      </p>

      <ConnectorDetailSheet
        server={server}
        connector={selected}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onEdit={(connector) => {
          setEditing(connector);
          setSelectedId(null);
        }}
        onDelete={(connector) => setConfirmDelete(connector)}
        onRotated={(connector, minted) => openReveal(connector, minted, "rotated")}
      />

      {createOpen && (
        <ConnectorCreateSheet
          server={server}
          onOpenChange={setCreateOpen}
          onCreated={(result) => {
            setCreateOpen(false);
            openReveal(result.connector, result, "created");
          }}
        />
      )}

      {editing && (
        <ConnectorEditSheet
          server={server}
          connector={editing}
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}

      {reveal && (
        <ConnectorInstallSheet
          reveal={reveal}
          live={connectors.find((entry) => entry.id === reveal.connector.id)}
          onOpenChange={(open) => !open && setReveal(null)}
        />
      )}

      <ConnectorDeleteDialog
        server={server}
        connector={confirmDelete}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        onDeleted={() => {
          setConfirmDelete(null);
          setSelectedId(null);
        }}
      />
    </div>
  );
}

/** Full-width tap-to-copy value row — phones have no hover affordance. */
function ConnectorCopyRow({ label, value }: { label: string; value: string }) {
  const copy = async () => {
    try {
      await copyText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="flex min-h-13 w-full items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left transition-colors active:bg-muted/70"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[10px] tracking-wide text-muted-foreground uppercase">{label}</span>
        <span className="block truncate font-mono text-xs">{value}</span>
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">Tap to copy</span>
    </button>
  );
}

function ConnectorDetailSheet({
  server,
  connector,
  isAdmin,
  onOpenChange,
  onEdit,
  onDelete,
  onRotated,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto | null;
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (connector: ConnectorDto) => void;
  onDelete: (connector: ConnectorDto) => void;
  onRotated: (connector: ConnectorDto, minted: ConnectorInstallReveal) => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
    void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
  };

  const rotateMutation = useMutation({
    mutationFn: (id: string) =>
      apiFetch<ConnectorInstallReveal>(connectorRotateTokenUrl(id), { method: "POST" }),
    onSuccess: (minted) => {
      if (!connector) return;
      toast.success("New install command ready — it is shown only once.");
      onRotated(connector, minted);
      invalidate();
    },
    onError: (error: Error) => toast.error(`Could not rotate the token: ${error.message}`),
  });

  const disableMutation = useMutation({
    mutationFn: ({ id, disabled }: { id: string; disabled: boolean }) =>
      apiFetch<ConnectorDto>(connectorUrl(id), {
        method: "PATCH",
        body: JSON.stringify({ disabled } satisfies UpdateConnectorInput),
      }),
    onSuccess: (_result, variables) => {
      toast.success(variables.disabled ? "Connector disabled. Apply to drop its edge peer." : "Connector enabled.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const status = connector ? connectorStatusPresentation(connector) : null;
  const pending = connector?.status === "pending";
  const disabled = connector?.status === "disabled";

  return (
    <BottomSheet
      open={connector !== null}
      onOpenChange={onOpenChange}
      title={connector?.name ?? "Connector"}
      description={`Reverse tunnel into ${server.name}`}
    >
      {connector && (
        <div className="flex flex-col gap-3 pb-2">
          <ConnectorCopyRow label="Connector ID" value={connector.connectorId} />

          <MobileList>
            <MobileKeyRow label="Status">
              <ConnectorStatusBadge connector={connector} />
            </MobileKeyRow>
            <MobileKeyRow label="Tunnel address" mono>
              {connector.tunnelAddress}
            </MobileKeyRow>
            <MobileKeyRow label="Tunnel key">
              {connector.publicKey ? "Registered by the connector" : "Not enrolled yet"}
            </MobileKeyRow>
            <MobileKeyRow label="Last handshake">{contactLabel(connector)}</MobileKeyRow>
            <MobileKeyRow label="Enrolled">
              {connector.enrolledAt ? formatRelative(connector.enrolledAt) : "Not enrolled"}
            </MobileKeyRow>
            <MobileKeyRow label="Agent">{connectorAgentSummary(connector) ?? "Not reported"}</MobileKeyRow>
            {connector.notes && <MobileKeyRow label="Notes">{connector.notes}</MobileKeyRow>}
          </MobileList>

          {status && <p className="px-0.5 text-[11px] text-muted-foreground">{status.hint}</p>}
          <p className="px-0.5 text-[11px] text-muted-foreground">
            The tunnel address is assigned automatically by PolySIEM and cannot be edited. The connector holds
            its own private key — it never leaves that machine.
          </p>

          {isAdmin && (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => onEdit(connector)}>
                  <Pencil /> Rename
                </Button>
                <Button
                  variant="outline"
                  disabled={rotateMutation.isPending}
                  onClick={() => rotateMutation.mutate(connector.id)}
                >
                  {rotateMutation.isPending ? <Loader2 className="animate-spin" /> : <Terminal />}
                  {pending ? "Install command" : "Rotate token"}
                </Button>
                <Button
                  variant="outline"
                  disabled={disableMutation.isPending}
                  onClick={() => disableMutation.mutate({ id: connector.id, disabled: !disabled })}
                >
                  {disableMutation.isPending ? <Loader2 className="animate-spin" /> : <Power />}
                  {disabled ? "Enable" : "Disable"}
                </Button>
                <Button variant="destructive" onClick={() => onDelete(connector)}>
                  <Trash2 /> Delete
                </Button>
              </div>
              <p className="px-0.5 text-[11px] text-muted-foreground">
                Rotating issues a fresh one-time token and a new install command; the old one stops working.
              </p>
            </>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

function ConnectorCreateSheet({
  server,
  onOpenChange,
  onCreated,
}: {
  server: EdgeNatServer;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateConnectorResult) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const nameValid = isValidConnectorName(name);

  const mutation = useMutation({
    // The integration is named twice on purpose — as the query parameter the
    // list endpoint already uses, and in the body — so either binding satisfies
    // the API. This matches the desktop card exactly.
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
      toast.success("Connector created — run the install command on the machine.");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onCreated(result);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("Use a short descriptive name — letters, numbers, spaces, dot, dash or underscore.");
      return;
    }
    mutation.mutate();
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title="Add connector"
      description="Name the internal machine that will dial out to the edge. PolySIEM assigns its tunnel address."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-name">Connector name</Label>
          <Input
            id="m-cx-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="EdgeNetworkVm"
            autoComplete="off"
            spellCheck={false}
            className={cn(name && !nameValid && "border-destructive")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-notes">
            Notes <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Textarea
            id="m-cx-notes"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Proxmox LXC on the home lab bridge"
            rows={2}
          />
        </div>
        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          The next screen shows a one-time install command. Nothing inbound is opened at home — the connector
          dials out to the edge.
        </p>
        <Button type="submit" className="w-full" disabled={mutation.isPending || !nameValid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Create connector
        </Button>
      </form>
    </BottomSheet>
  );
}

function ConnectorEditSheet({
  server,
  connector,
  onOpenChange,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(connector.name);
  const [notes, setNotes] = useState(connector.notes ?? "");
  const nameValid = isValidConnectorName(name);

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success("Connector updated");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!nameValid) {
      toast.error("A connector needs a short descriptive name.");
      return;
    }
    mutation.mutate({ name: name.trim(), notes: notes.trim() || null });
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Rename ${connector.name}`}
      description="Only the label and notes change — the connector ID and tunnel address stay fixed."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-edit-name">Connector name</Label>
          <Input
            id="m-cx-edit-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn(name && !nameValid && "border-destructive")}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-edit-notes">Notes</Label>
          <Textarea id="m-cx-edit-notes" value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} />
        </div>
        <MobileList>
          <MobileKeyRow label="Connector ID" mono>
            {connector.connectorId}
          </MobileKeyRow>
          <MobileKeyRow label="Tunnel address" mono>
            {connector.tunnelAddress}
          </MobileKeyRow>
        </MobileList>
        <Button type="submit" className="w-full" disabled={mutation.isPending || !nameValid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Pencil />} Save connector
        </Button>
      </form>
    </BottomSheet>
  );
}

/**
 * The centerpiece: the copy-paste installer. The token inside `installCommand`
 * is minted once and is never retrievable again, so the warning is loud and the
 * list polls behind the sheet until the connector checks in.
 */
function ConnectorInstallSheet({
  reveal,
  live,
  onOpenChange,
}: {
  reveal: InstallReveal;
  live: ConnectorDto | undefined;
  onOpenChange: (open: boolean) => void;
}) {
  const progress = connectorInstallProgress({
    connector: live ?? reveal.connector,
    reason: reveal.reason,
    baselineLastSeenAt: reveal.baselineLastSeenAt,
  });
  const connected = progress.state === "connected";
  const copyCommand = async () => {
    try {
      await copyText(reveal.installCommand);
      toast.success("Install command copied");
    } catch {
      toast.error("Clipboard unavailable — copy manually");
    }
  };

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Install ${reveal.connector.name}`}
      description="Run this once on the internal machine that can reach your lab targets."
    >
      <div className="flex flex-col gap-3 pb-2">
        <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          This command carries a one-time install token and is shown only once. Copy it now — if you lose it,
          rotate the token for a new command.
        </p>

        <div className="rounded-xl border border-primary/40 bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-mono text-[11px] tracking-wider text-muted-foreground uppercase">Install command</p>
            <CopyButton value={reveal.installCommand} label="Copy install command" />
          </div>
          <p className="mt-1 max-h-40 overflow-y-auto break-all font-mono text-xs select-all">
            {reveal.installCommand}
          </p>
        </div>
        <Button type="button" className="w-full" onClick={copyCommand}>
          <Terminal /> Copy install command
        </Button>

        <ol className="flex flex-col gap-2 rounded-xl border bg-card p-3 text-xs">
          <InstallStep index={1}>
            Open a root shell on the internal machine — the one that can reach the services you want to publish.
          </InstallStep>
          <InstallStep index={2}>Paste the command and run it. It installs WireGuard tools plus the agent.</InstallStep>
          <InstallStep index={3}>
            The agent generates its own key locally, dials out to the edge, and enrolls. Nothing inbound is
            opened at home.
          </InstallStep>
          <InstallStep index={4}>
            This screen updates by itself once the connector checks in.
          </InstallStep>
        </ol>

        <ConnectorCopyRow label="Connector ID" value={reveal.connector.connectorId} />

        <MobileList>
          <MobileKeyRow label="Status">
            <Badge variant={connected ? "secondary" : "outline"} className="text-[10px] font-normal">
              {connected && <span className="size-1.5 rounded-full bg-success" />}
              {progress.label}
            </Badge>
          </MobileKeyRow>
          <MobileKeyRow label="Tunnel address" mono>
            {(live ?? reveal.connector).tunnelAddress}
          </MobileKeyRow>
        </MobileList>

        <p
          className={cn(
            "rounded-xl border px-3 py-2 text-xs",
            connected ? "border-success/30 bg-success/5 text-success" : "border-info/30 bg-info/5 text-info",
          )}
        >
          {progress.detail}
          {!connected && " The machine needs outbound UDP access to the edge WireGuard port."}
        </p>

        <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
          {connected ? "Done" : "Close — I copied the command"}
        </Button>
      </div>
    </BottomSheet>
  );
}

function InstallStep({ index, children }: { index: number; children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[10px] font-medium">
        {index}
      </span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

function ConnectorDeleteDialog({
  server,
  connector,
  onOpenChange,
  onDeleted,
}: {
  server: EdgeNatServer;
  connector: ConnectorDto | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const routeCount = connector ? server.rules.filter((rule) => rule.connectorId === connector.id).length : 0;
  const mutation = useMutation({
    mutationFn: (id: string) => apiFetch(connectorUrl(id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Connector removed. Apply changes to drop its edge peer.");
      void queryClient.invalidateQueries({ queryKey: connectorsQueryKey(server.id) });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onDeleted();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <AlertDialog open={connector !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {connector?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            {routeCount > 0
              ? `${routeCount} published ${routeCount === 1 ? "route" : "routes"} go through this connector and are removed with it. `
              : ""}
            Its WireGuard peer drops off the edge on the next apply, and the agent on that machine stops enrolling.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              if (connector) mutation.mutate(connector.id);
            }}
          >
            {mutation.isPending && <Loader2 className="animate-spin" />}
            Delete connector
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
