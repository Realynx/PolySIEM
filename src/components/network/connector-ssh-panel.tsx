"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  Loader2,
  LockKeyhole,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Terminal,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { CopyButton } from "@/components/ssh/copy-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { ConfigSelect } from "./config-select";
import {
  connectorApplyUrl,
  connectorHandshakeAt,
  connectorHostKeyQueryKey,
  connectorHostKeyUrl,
  connectorLinkSummary,
  connectorSshPresentation,
  connectorSshUsername,
  connectorStatusQueryKey,
  connectorStatusUrl,
  connectorUrl,
  connectorWgStatePresentation,
  hostKeyAlgorithmLabel,
  isValidConnectorSshUsername,
  isValidSshHost,
  isValidSshPort,
  CONNECTOR_SSH_DEFAULT_PORT,
  CONNECTOR_SSH_DEFAULT_USERNAME,
  CONNECTOR_SSH_PORT_CHOICES,
  CONNECTOR_SSH_TRUST_FACTS,
  CONNECTOR_SSH_USERNAME_CHOICES,
  CONNECTORS_QUERY_PREFIX,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorApplyResult,
  type ConnectorDto,
  type ConnectorHostKeyEnrollResult,
  type ConnectorHostKeyScan,
  type ConnectorSshPresentation,
  type ConnectorSshStatus,
  type UpdateConnectorInput,
} from "./edge-networks-types";

/**
 * SSH management for one connector — "everything maintained and managed with
 * the SSH connection". It belongs to the CONNECTOR, not to any edge box: one
 * push sends the config for every edge the connector serves, so this panel
 * renders identically on the top-level Connectors tab and inside an edge card.
 *
 * Collapsed by default: expanding is what triggers a live STATUS read, and every
 * read opens a real SSH session to the machine.
 */
export function ConnectorSshPanel({ connector }: { connector: ConnectorDto }) {
  const [open, setOpen] = useState(false);
  const ssh = connectorSshPresentation(connector);
  const username = connectorSshUsername(connector);
  const links = connectorLinkSummary(connector);

  const statusQuery = useQuery({
    queryKey: connectorStatusQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorSshStatus>(connectorStatusUrl(connector.id)),
    // Never on a timer: every fetch is an SSH round trip to the connector.
    enabled: open && ssh.canManage,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 15_000,
  });

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-3">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 rounded-lg border bg-muted/20 px-3 py-2 text-left transition-colors hover:bg-accent"
        >
          <Terminal className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="text-xs font-medium">SSH management</span>
          <Badge
            variant={ssh.tone === "success" ? "secondary" : "outline"}
            className={cn("font-normal", ssh.tone === "warning" && "text-warning")}
          >
            {ssh.tone === "success" && <span className="size-1.5 rounded-full bg-success" />}
            {ssh.label}
          </Badge>
          {ssh.endpoint && (
            <code className="min-w-0 flex-1 truncate font-mono text-[0.6875rem] text-muted-foreground">
              {username}@{ssh.endpoint}
            </code>
          )}
          <ChevronDown
            className={cn("ml-auto size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")}
            aria-hidden="true"
          />
        </button>
      </CollapsibleTrigger>

      <CollapsibleContent className="space-y-3 rounded-b-lg border border-t-0 p-3">
        <p className="text-xs text-muted-foreground">{ssh.detail}</p>

        <ConnectorSshEndpointForm connector={connector} />
        <p className="text-xs text-muted-foreground">
          Signs in as <code className="font-mono text-foreground">{username}</code> — the account the installer creates.
          Change it only for a host that must use a different service account. Leave the address blank to manage this
          connector by its poll alone.
        </p>

        <ConnectorSshHostKeySection connector={connector} />

        <ConnectorSshActions
          connector={connector}
          ssh={ssh}
          linkCount={links.enabled}
          statusFetching={statusQuery.isFetching}
          onRefreshStatus={() => void statusQuery.refetch()}
        />

        {ssh.canManage && <ConnectorSshStatusPanel statusQuery={statusQuery} />}

        <ul className="grid gap-1.5 border-t pt-3">
          {CONNECTOR_SSH_TRUST_FACTS.map((fact) => (
            <li key={fact.title} className="flex items-start gap-1.5 text-xs">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
              <span>
                <span className="font-medium">{fact.title}.</span>{" "}
                <span className="text-muted-foreground">{fact.detail}</span>
              </span>
            </li>
          ))}
        </ul>

        <ConnectorSshKeyLine connector={connector} username={username} />
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Address, port, and service account PolySIEM signs in with. */
function ConnectorSshEndpointForm({ connector }: { connector: ConnectorDto }) {
  const queryClient = useQueryClient();
  const [host, setHost] = useState(connector.sshHost ?? "");
  const [port, setPort] = useState(String(connector.sshPort || CONNECTOR_SSH_DEFAULT_PORT));
  const [account, setAccount] = useState(connectorSshUsername(connector));

  const trimmedHost = host.trim();
  const trimmedAccount = account.trim();
  const portNumber = Number(port);
  const hostValid = trimmedHost.length === 0 || isValidSshHost(trimmedHost);
  const dirty =
    trimmedHost !== (connector.sshHost ?? "") ||
    portNumber !== (connector.sshPort || CONNECTOR_SSH_DEFAULT_PORT) ||
    trimmedAccount !== connectorSshUsername(connector);

  const endpointMutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: (_result, input) => {
      toast.success(input.sshHost ? `SSH address saved for ${connector.name}` : `SSH address cleared for ${connector.name}`);
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
    },
    onError: (error: Error) => toast.error(`Could not save the SSH address: ${error.message}`),
  });

  const saveEndpoint = (event: FormEvent) => {
    event.preventDefault();
    if (!hostValid || !isValidSshPort(portNumber) || !isValidConnectorSshUsername(trimmedAccount)) {
      toast.error("Enter a reachable hostname or IP, a port from 1–65535, and a Linux service account name.");
      return;
    }
    endpointMutation.mutate({ sshHost: trimmedHost || null, sshPort: portNumber, sshUsername: trimmedAccount });
  };

  return (
    <form onSubmit={saveEndpoint} className="grid gap-2 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
      <div className="grid gap-1.5">
        <Label htmlFor={`ssh-host-${connector.id}`} className="text-xs">Address PolySIEM connects to</Label>
        <Input
          id={`ssh-host-${connector.id}`}
          value={host}
          onChange={(event) => setHost(event.target.value)}
          placeholder="10.0.3.12"
          autoComplete="off"
          spellCheck={false}
          className={cn("font-mono", !hostValid && "border-destructive")}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`ssh-port-${connector.id}`} className="text-xs">Port</Label>
        <ConfigSelect
          id={`ssh-port-${connector.id}`}
          value={port}
          onChange={setPort}
          choices={CONNECTOR_SSH_PORT_CHOICES}
          customLabel="Custom port…"
          customAriaLabel={`Custom SSH port for ${connector.name}`}
          inputPlaceholder="22"
          inputMode="numeric"
          invalid={!isValidSshPort(portNumber)}
        />
      </div>
      <Button type="submit" variant="outline" size="sm" disabled={!dirty || endpointMutation.isPending}>
        {endpointMutation.isPending ? <Loader2 className="animate-spin" /> : <Check />}
        Save
      </Button>
      <div className="grid gap-1.5 sm:col-span-3 sm:max-w-xs">
        <Label htmlFor={`ssh-user-${connector.id}`} className="text-xs">Service account</Label>
        <ConfigSelect
          id={`ssh-user-${connector.id}`}
          value={account}
          onChange={setAccount}
          choices={CONNECTOR_SSH_USERNAME_CHOICES}
          customLabel="Custom account…"
          customAriaLabel={`Custom SSH service account for ${connector.name}`}
          inputPlaceholder={CONNECTOR_SSH_DEFAULT_USERNAME}
          invalid={!isValidConnectorSshUsername(trimmedAccount)}
        />
      </div>
    </form>
  );
}

/** The pinned host key, and the scan dialog that pins one. */
function ConnectorSshHostKeySection({ connector }: { connector: ConnectorDto }) {
  const [hostKeyOpen, setHostKeyOpen] = useState(false);
  return (
    <div className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_auto] sm:items-center">
      <div className="min-w-0">
        <p className="text-xs font-medium">Host key</p>
        {connector.sshHostKeyFingerprint ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5">
            <ShieldCheck className="size-3.5 shrink-0 text-success" aria-hidden="true" />
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{connector.sshHostKeyFingerprint}</code>
            <CopyButton value={connector.sshHostKeyFingerprint} label={`Copy the host key fingerprint for ${connector.name}`} />
          </p>
        ) : (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Not pinned yet. PolySIEM refuses to connect until you confirm the fingerprint.
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={!connector.sshHost} onClick={() => setHostKeyOpen(true)}>
        <ScanLine /> {connector.sshHostKeyFingerprint ? "Re-scan" : "Scan and trust"}
      </Button>
      {hostKeyOpen && (
        <ConnectorHostKeyDialog connector={connector} onOpenChange={(next) => !next && setHostKeyOpen(false)} />
      )}
    </div>
  );
}

/** Push config / refresh status, and why they may be unavailable. */
function ConnectorSshActions({
  connector,
  ssh,
  linkCount,
  statusFetching,
  onRefreshStatus,
}: {
  connector: ConnectorDto;
  ssh: ConnectorSshPresentation;
  /** How many edge boxes this one push covers. */
  linkCount: number;
  statusFetching: boolean;
  onRefreshStatus: () => void;
}) {
  const queryClient = useQueryClient();
  const applyMutation = useMutation({
    mutationFn: () => apiFetch<ConnectorApplyResult>(connectorApplyUrl(connector.id), { method: "POST" }),
    onSuccess: (result) => {
      const routes = result?.routeCount;
      toast.success(
        typeof routes === "number"
          ? `Pushed ${routes} route${routes === 1 ? "" : "s"} to ${connector.name}`
          : `Config pushed to ${connector.name}`,
      );
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
      void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
      onRefreshStatus();
    },
    onError: (error: Error) => toast.error(`Could not push the config: ${error.message}`),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" size="sm" disabled={!ssh.canManage || applyMutation.isPending} onClick={() => applyMutation.mutate()}>
        {applyMutation.isPending ? <Loader2 className="animate-spin" /> : <Upload />}
        Push config now
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={!ssh.canManage || statusFetching} onClick={onRefreshStatus}>
        <RefreshCw className={cn(statusFetching && "animate-spin")} /> Refresh status
      </Button>
      {ssh.canManage && linkCount > 1 && (
        <span className="text-xs text-muted-foreground">
          One push covers all {linkCount} edge boxes this connector serves.
        </span>
      )}
      {!ssh.canManage && (
        <span className="text-xs text-muted-foreground">
          {ssh.readiness === "untrusted" ? "Trust the host key to enable these." : "Add an address to enable these."}
        </span>
      )}
    </div>
  );
}

/** Live STATUS read from the agent, once the panel is open. */
function ConnectorSshStatusPanel({ statusQuery }: { statusQuery: UseQueryResult<ConnectorSshStatus> }) {
  const status = statusQuery.data;
  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      {statusQuery.isLoading && <Skeleton className="h-16 w-full rounded" />}
      {statusQuery.isError && (
        <p className="flex items-start gap-1.5 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          Could not read status: {(statusQuery.error as Error).message}
        </p>
      )}
      {status && (
        <>
          <ConnectorSshStatusFacts status={status} />
          <p className="mt-2 truncate text-xs text-muted-foreground">{connectorStatusSummaryLine(status)}</p>
          {status.drift && (
            <Alert variant="destructive" className="mt-3">
              <TriangleAlert />
              <AlertTitle>Live rules drifted from what PolySIEM applied</AlertTitle>
              <AlertDescription>
                Something changed the connector&apos;s firewall outside PolySIEM. Push the config again to restore
                the intended ruleset.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
      {!status && !statusQuery.isLoading && !statusQuery.isError && (
        <p className="text-xs text-muted-foreground">Refresh to read live status from the agent.</p>
      )}
    </div>
  );
}

function ConnectorSshStatusFacts({ status }: { status: ConnectorSshStatus }) {
  const wg = connectorWgStatePresentation(status.wgState);
  const handshakeAt = connectorHandshakeAt(status);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <SshFact label="Agent version" value={status.agentVersion ?? "Not reported"} />
      <SshFact label="WireGuard" value={wg.label} tone={wg.tone} hint={status.wgAddress ?? undefined} />
      <SshFact
        label="Latest handshake"
        value={handshakeAt ? formatRelative(handshakeAt) : "No handshake yet"}
        // One peer per linked edge box, on a single interface.
        hint={countLabel(status.peers, "edge peer")}
      />
      <SshFact
        label="Applied revision"
        value={revisionLabel(status.appliedRevision)}
        hint={status.appliedHash ? shortHash(status.appliedHash) : undefined}
      />
    </div>
  );
}

function countLabel(count: number | null | undefined, noun: string): string | undefined {
  if (typeof count !== "number") return undefined;
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function revisionLabel(revision: string | number | null | undefined): string {
  return revision === null || revision === undefined ? "None" : String(revision);
}

function forwardingLabel(ipForward: boolean | null | undefined): string | null {
  if (ipForward === null || ipForward === undefined) return null;
  return ipForward ? "forwarding on" : "forwarding off";
}

function connectorStatusSummaryLine(status: ConnectorSshStatus): string {
  return [
    status.hostname,
    status.kernel,
    countLabel(status.routeCount, "route"),
    forwardingLabel(status.ipForward),
  ].filter(Boolean).join(" · ");
}

/** PolySIEM's own key line for this connector, for a machine installed earlier. */
function ConnectorSshKeyLine({ connector, username }: { connector: ConnectorDto; username: string }) {
  const line = connector.sshAuthorizedKey ?? connector.sshPublicKey;
  if (!line) return null;
  return (
    <div className="grid gap-1">
      <p className="text-xs text-muted-foreground">
        {connector.sshAuthorizedKey
          ? <>PolySIEM&apos;s <code className="font-mono">authorized_keys</code> line for this connector — the installer writes it for you; paste it into <code className="font-mono">~{username}/.ssh/authorized_keys</code> only if you are adding SSH to a machine installed before this.</>
          : <>PolySIEM&apos;s public key for this connector.</>}
      </p>
      <div className="flex items-center gap-1">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[0.6875rem]">{line}</code>
        <CopyButton value={line} label={`Copy the SSH key line for ${connector.name}`} />
      </div>
    </div>
  );
}

function SshFact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "success" | "warning" | "muted";
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-0.5 truncate font-medium",
          tone === "success" && "text-success",
          tone === "warning" && "text-warning",
        )}
      >
        {value}
      </p>
      {hint && <p className="truncate font-mono text-[0.6875rem] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function shortHash(value: string): string {
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

/** The fingerprint the dialog offers to pin, given what has been chosen or is known. */
function preferredHostKey(connector: ConnectorDto, scan: ConnectorHostKeyScan | undefined, chosen: string): string {
  const keys = scan?.keys ?? [];
  return chosen ||
    connector.sshHostKeyFingerprint ||
    scan?.enrolledFingerprint ||
    (keys.length === 1 ? keys[0].fingerprint : "");
}

/**
 * Host-key trust for a connector, mirroring the edge server's enrollment UX:
 * scan what the host presents, compare a fingerprint out of band, pin one. The
 * service path then uses `StrictHostKeyChecking=yes` against that key only.
 */
function ConnectorHostKeyDialog({
  connector,
  onOpenChange,
}: {
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [selectedFingerprint, setSelectedFingerprint] = useState("");
  const scanQuery = useQuery({
    queryKey: connectorHostKeyQueryKey(connector.id),
    queryFn: () => apiFetch<ConnectorHostKeyScan>(connectorHostKeyUrl(connector.id)),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const selected = preferredHostKey(connector, scanQuery.data, selectedFingerprint);

  const enrollMutation = useMutation({
    mutationFn: (fingerprint: string) =>
      apiFetch<ConnectorHostKeyEnrollResult>(connectorHostKeyUrl(connector.id), {
        method: "POST",
        body: JSON.stringify({ fingerprint }),
      }),
    onSuccess: (result) => {
      toast.success(result?.detail || `${connector.name} host key pinned`);
      void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
      void queryClient.invalidateQueries({ queryKey: connectorStatusQueryKey(connector.id) });
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not trust the host key: ${error.message}`),
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Trust {connector.name}&apos;s SSH host key</DialogTitle>
          <DialogDescription>
            Compare a fingerprint against the machine&apos;s console before pinning it. PolySIEM only ever connects to the
            key you pin here — a changed or impersonated host is refused, never silently accepted.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <HostKeyScanResults scanQuery={scanQuery} selected={selected} onSelect={setSelectedFingerprint} />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={scanQuery.isFetching}
            onClick={() => void scanQuery.refetch()}
          >
            <RefreshCw className={cn(scanQuery.isFetching && "animate-spin")} /> Scan again
          </Button>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!selected || enrollMutation.isPending}
            onClick={() => selected && enrollMutation.mutate(selected)}
          >
            {enrollMutation.isPending ? <Loader2 className="animate-spin" /> : <LockKeyhole />}
            Trust this host key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HostKeyScanResults({
  scanQuery,
  selected,
  onSelect,
}: {
  scanQuery: UseQueryResult<ConnectorHostKeyScan>;
  selected: string;
  onSelect: (fingerprint: string) => void;
}) {
  const scan = scanQuery.data;
  const keys = scan?.keys ?? [];
  return (
    <>
      {scanQuery.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {scanQuery.isError && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>Could not scan the connector</AlertTitle>
          <AlertDescription>{(scanQuery.error as Error).message}</AlertDescription>
        </Alert>
      )}
      {scan && (
        <>
          <p className="text-xs text-muted-foreground">
            Observed at <code className="font-mono">{scan.host}:{scan.port}</code>
          </p>
          {keys.length === 0 ? (
            <p className="text-sm text-warning">No host keys were returned.</p>
          ) : (
            keys.map((key) => (
              <HostKeyOption
                key={`${hostKeyAlgorithmLabel(key)}:${key.fingerprint}`}
                algorithm={hostKeyAlgorithmLabel(key)}
                fingerprint={key.fingerprint}
                active={selected === key.fingerprint}
                onSelect={() => onSelect(key.fingerprint)}
              />
            ))
          )}
          {scan.warning && <p className="text-xs text-muted-foreground">{scan.warning}</p>}
        </>
      )}
    </>
  );
}

function HostKeyOption({
  algorithm,
  fingerprint,
  active,
  onSelect,
}: {
  algorithm: string;
  fingerprint: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
        active && "border-primary bg-primary/5",
      )}
    >
      <span
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border",
          active && "border-primary bg-primary text-primary-foreground",
        )}
      >
        {active && <Check className="size-3" />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-muted-foreground uppercase">{algorithm}</span>
        <code className="block break-all text-xs">{fingerprint}</code>
      </span>
    </button>
  );
}
