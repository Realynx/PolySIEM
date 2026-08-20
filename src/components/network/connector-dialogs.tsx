"use client";

import { FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, KeyRound, Link2, Loader2, Plus, Server, TriangleAlert, Unlink } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/components/shared/api-client";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { EdgeTunnelSetupNote } from "./connector-tunnel-notes";
import {
  connectorKindLabel,
  connectorKindPresentation,
  connectorLinkEdgeName,
  connectorLinks,
  connectorLinksUrl,
  connectorLinkUrl,
  connectorRotateTokenUrl,
  connectorStatusPresentation,
  connectorTunnelProvisioned,
  connectorTunnelProvisionedCopy,
  connectorUrl,
  connectorsAllUrl,
  edgesAvailableForConnector,
  isManualConnector,
  isValidConnectorName,
  CONNECTOR_INDEPENDENCE_COPY,
  CONNECTOR_KIND_CHOICES,
  CONNECTORS_QUERY_PREFIX,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorInstallReveal,
  type ConnectorKind,
  type ConnectorLinkDto,
  type CreateConnectorResult,
  type EdgeNatServer,
  type LinkConnectorResult,
  type UpdateConnectorInput,
} from "./edge-networks-types";

/** Sentinel for "do not link it to an edge box yet". Radix refuses "". */
const NO_EDGE = "__none__";

/**
 * Everything that mutates a connector, shared by the top-level Connectors tab
 * and by an edge card's Connectors tab so both surfaces behave identically.
 *
 * The rule these dialogs encode: a connector is created once and then LINKED to
 * edge boxes. Creating from inside an edge card just pre-selects that edge.
 */

/** Invalidate every connector list plus the edge overview the links feed. */
function useConnectorRefresh() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
    void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
  };
}

export function CreateConnectorDialog({
  open,
  onOpenChange,
  servers,
  defaultIntegrationId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every edge box, so the new connector can be pointed at one immediately. */
  servers: EdgeNatServer[];
  /** Pre-selected when the dialog is opened from inside one edge's card. */
  defaultIntegrationId?: string | null;
  onCreated: (result: CreateConnectorResult) => void;
}) {
  const refresh = useConnectorRefresh();
  const [kind, setKind] = useState<ConnectorKind>("agent");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [edgeId, setEdgeId] = useState(defaultIntegrationId ?? NO_EDGE);
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;
  const manual = kind !== "agent";
  const kindCopy = connectorKindPresentation(kind);

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<CreateConnectorResult>(connectorsAllUrl(), {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          notes: notes.trim() || undefined,
          kind,
          ...(edgeId !== NO_EDGE ? { integrationId: edgeId } : {}),
        }),
      }),
    onSuccess: (result) => {
      const tunnel = connectorTunnelProvisioned(result);
      toast.success(
        isManualConnector(result.connector)
          ? `${result.connector.name} created. Paste its settings into ${kindCopy.farSide}.`
          : `${result.connector.name} created. Run the install command to bring it online.`,
        tunnel ? { description: connectorTunnelProvisionedCopy(tunnel).toast } : undefined,
      );
      refresh();
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

  const reopen = (next: boolean) => {
    if (next) {
      setKind("agent");
      setName("");
      setNotes("");
      setEdgeId(defaultIntegrationId ?? NO_EDGE);
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={reopen}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Add connector</DialogTitle>
            <DialogDescription>
              Anything that dials out to an edge box over WireGuard is a connector. {CONNECTOR_INDEPENDENCE_COPY}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-1">
            <ConnectorKindField kind={kind} onSelect={setKind} />

            <div className="grid gap-1.5">
              <Label htmlFor="connector-name">Connector name</Label>
              <Input
                id="connector-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={connectorNamePlaceholder(kind)}
                maxLength={64}
                autoFocus
                className={cn(nameError && "border-destructive")}
              />
              <p className={cn("text-xs", nameError ? "text-destructive" : "text-muted-foreground")}>
                {nameError
                  ? "Start with a letter or number; letters, numbers, spaces, dots, dashes and underscores only."
                  : "Names are unique across PolySIEM — use the container, VM, or firewall name you will recognize later."}
              </p>
            </div>

            <CreateConnectorEdgeField servers={servers} value={edgeId} onChange={setEdgeId} />

            <div className="grid gap-1.5">
              <Label htmlFor="connector-notes">
                Notes <span className="font-normal text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="connector-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Proxmox LXC on the lab VLAN; reaches 10.0.3.0/24"
                maxLength={1000}
                rows={3}
              />
            </div>
            <p className="rounded-lg border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
              {manual
                ? <>Nothing is installed and no token is issued. PolySIEM reserves an identity, allocates a tunnel address on each edge box you link, and shows the exact settings to enter on {kindCopy.farSide}.</>
                : <>Nothing is installed yet. Creating the connector only reserves its identity — the machine enrolls itself when you run the install command, and it gets one tunnel address per edge box you link it to.</>}
            </p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={mutation.isPending || !nameValid}>
              {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />}
              {manual ? "Create and show peer settings" : "Create and show install command"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ConnectorKindField({ kind, onSelect }: { kind: ConnectorKind; onSelect: (kind: ConnectorKind) => void }) {
  return (
    <div className="grid gap-1.5">
      <Label id="connector-kind-label">What is on the far side?</Label>
      <div role="radiogroup" aria-labelledby="connector-kind-label" className="grid gap-2">
        {CONNECTOR_KIND_CHOICES.map((choice) => (
          <ConnectorChoiceOption
            key={choice.value}
            title={choice.title}
            detail={choice.detail}
            active={kind === choice.value}
            onSelect={() => onSelect(choice.value)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Optional first link. A connector with no link is valid — just not routing yet.
 *
 * An edge with no WireGuard tunnel is still a perfectly good choice: PolySIEM
 * stands the tunnel up as part of the link. That used to be refused, so the
 * ordering is stated here rather than left for the operator to discover.
 */
function CreateConnectorEdgeField({
  servers,
  value,
  onChange,
}: {
  servers: EdgeNatServer[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (servers.length === 0) return null;
  const selected = servers.find((server) => server.id === value) ?? null;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor="connector-edge">Start serving an edge box</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="connector-edge" className="w-full">
          <SelectValue placeholder="Choose an edge box" />
        </SelectTrigger>
        <SelectContent>
          {servers.map((server) => (
            <SelectItem key={server.id} value={server.id}>
              <span>{server.name}</span>
            </SelectItem>
          ))}
          <SelectItem value={NO_EDGE}>Not yet — link it later</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        You can link the same connector to more edge boxes at any time; each one gives it its own tunnel address.
      </p>
      <EdgeTunnelSetupNote server={selected} servers={servers} />
    </div>
  );
}

function connectorNamePlaceholder(kind: ConnectorKind): string {
  if (kind === "agent") return "EdgeNetworkVm";
  return kind === "opnsense" ? "Home OPNsense" : "Branch router";
}

export function ConnectorChoiceOption({
  title,
  detail,
  active,
  onSelect,
}: {
  title: string;
  detail: string;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-lg border p-3 text-left transition-colors hover:bg-accent",
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
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{detail}</span>
      </span>
    </button>
  );
}

export function EditConnectorDialog({
  connector,
  servers,
  open,
  onOpenChange,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useConnectorRefresh();
  const [name, setName] = useState(connector.name);
  const [notes, setNotes] = useState(connector.notes ?? "");
  const [enabled, setEnabled] = useState(connector.status !== "disabled");
  const nameValid = isValidConnectorName(name);
  const nameError = name.trim().length > 0 && !nameValid;

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success(`${name.trim()} updated. Apply changes on each edge box to push it.`);
      refresh();
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
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>Edit {connector.name}</DialogTitle>
            <DialogDescription>
              Rename the connector or record what it reaches. Its connector ID, kind, and per-edge tunnel addresses are
              fixed — link and unlink edge boxes from the connector row instead.
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
                  Disabling keeps the record but drops its tunnel peer from every linked edge box on the next apply.
                </p>
              </div>
              <Switch
                id={`edit-connector-enabled-${connector.id}`}
                checked={enabled}
                onCheckedChange={setEnabled}
              />
            </div>
            <EditConnectorFacts connector={connector} servers={servers} />
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

/** The immutable identity, plus one address line per edge box it serves. */
function EditConnectorFacts({ connector, servers }: { connector: ConnectorDto; servers: EdgeNatServer[] }) {
  const links = connectorLinks(connector);
  return (
    <div className="grid gap-1 rounded-lg border bg-muted/20 p-3 text-xs">
      <p className="text-muted-foreground">
        Kind <span className="ml-1 font-medium text-foreground">{connectorKindLabel(connector)}</span>
        <span className="ml-1">· fixed once created</span>
      </p>
      <p className="text-muted-foreground">
        Connector ID <code className="ml-1 font-mono text-foreground">{connector.connectorId}</code>
      </p>
      {links.length === 0 ? (
        <p className="text-muted-foreground">Not linked to an edge box yet — no tunnel address is allocated.</p>
      ) : (
        links.map((link) => (
          <p key={link.id} className="text-muted-foreground">
            {connectorLinkEdgeName(link, servers)}{" "}
            <code className="ml-1 font-mono text-foreground">{link.tunnelAddress}</code>
            <span className="ml-1">· assigned automatically</span>
          </p>
        ))
      )}
    </div>
  );
}

export function RotateTokenDialog({
  connector,
  onOpenChange,
  onRotated,
}: {
  connector: ConnectorDto;
  onOpenChange: (open: boolean) => void;
  onRotated: (connector: ConnectorDto, reveal: ConnectorInstallReveal) => void;
}) {
  const refresh = useConnectorRefresh();
  const mutation = useMutation({
    mutationFn: () => apiFetch<ConnectorInstallReveal>(connectorRotateTokenUrl(connector.id), { method: "POST" }),
    onSuccess: (reveal) => {
      refresh();
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

export function DeleteConnectorDialog({
  connector,
  servers,
  onOpenChange,
}: {
  connector: ConnectorDto;
  /** Every edge box, so the warning counts routes across all of them. */
  servers: EdgeNatServer[];
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useConnectorRefresh();
  const routeCount = servers
    .flatMap((server) => server.rules)
    .filter((rule) => rule.connectorId === connector.id).length;
  const linkCount = connectorLinks(connector).length;
  const mutation = useMutation({
    mutationFn: () => apiFetch(connectorUrl(connector.id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${connector.name} removed. Apply changes on each edge box to drop it.`);
      refresh();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(`Could not remove the connector: ${error.message}`),
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {connector.name} everywhere?</AlertDialogTitle>
          <AlertDialogDescription>
            {linkCount > 1
              ? `This connector serves ${linkCount} edge boxes — deleting it removes it from all of them. To stop using it on just one, unlink it there instead. `
              : ""}
            {routeCount > 0
              ? `${routeCount} route${routeCount === 1 ? "" : "s"} published through this connector will be removed with it. `
              : ""}
            {isManualConnector(connector)
              ? "The far side keeps its WireGuard config until you remove it there, but every linked edge drops its tunnel peer after the next apply."
              : "The machine keeps running its agent until you uninstall it there, but every linked edge drops its tunnel peer after the next apply."}
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

/**
 * POST a link and report it in the words of whichever side started it.
 *
 * A link may stand the edge's WireGuard tunnel up on the way through. When it
 * does, the response says so and the operator hears about it here — that tunnel
 * still needs an Apply, and nobody should have to go looking for it.
 */
function useLinkMutation(onDone: () => void) {
  const refresh = useConnectorRefresh();
  return useMutation({
    mutationFn: (input: { connectorId: string; integrationId: string; message: string }) =>
      apiFetch<LinkConnectorResult>(connectorLinksUrl(input.connectorId), {
        method: "POST",
        body: JSON.stringify({ integrationId: input.integrationId }),
      }),
    onSuccess: (result, input) => {
      const tunnel = connectorTunnelProvisioned(result);
      toast.success(input.message, tunnel ? { description: connectorTunnelProvisionedCopy(tunnel).toast } : undefined);
      refresh();
      onDone();
    },
    onError: (error: Error) => toast.error(`Could not link the connector: ${error.message}`),
  });
}

/**
 * "Link a connector" from an EDGE box: pick one of the connectors already
 * installed elsewhere. This is the flow that makes one connector serve many
 * edges without installing anything again.
 */
export function LinkConnectorToEdgeDialog({
  server,
  servers,
  connectors,
  open,
  onOpenChange,
}: {
  server: EdgeNatServer;
  /** Every edge box, so a tunnel PolySIEM has yet to create is described honestly. */
  servers?: EdgeNatServer[];
  /** Connectors that do NOT serve this edge yet. */
  connectors: ConnectorDto[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [connectorId, setConnectorId] = useState("");
  const mutation = useLinkMutation(() => onOpenChange(false));
  const selected = connectors.find((connector) => connector.id === connectorId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setConnectorId(""); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link a connector to {server.name}</DialogTitle>
          <DialogDescription>
            Reuse a connector that is already installed. Nothing is installed again — PolySIEM allocates it an address
            on this edge&apos;s tunnel subnet and adds it as a peer on the next apply.
          </DialogDescription>
        </DialogHeader>

        {connectors.length === 0 ? (
          <Alert>
            <Link2 />
            <AlertTitle>Every connector already serves this edge box</AlertTitle>
            <AlertDescription>
              There is nothing left to link here. Use <span className="font-medium">Add connector</span> to install a
              new one.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="link-connector">Connector</Label>
            <Select value={connectorId} onValueChange={setConnectorId}>
              <SelectTrigger id="link-connector" className="w-full">
                <SelectValue placeholder="Choose an installed connector" />
              </SelectTrigger>
              <SelectContent>
                {connectors.map((connector) => (
                  <SelectItem key={connector.id} value={connector.id}>
                    <span>{connector.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {connectorKindLabel(connector)} · {connectorStatusPresentation(connector).label.toLowerCase()}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {selected
                ? `${selected.name} keeps its identity and its own WireGuard key — it simply adds ${server.name} as one more peer on its single tunnel interface.`
                : CONNECTOR_INDEPENDENCE_COPY}
            </p>
            <EdgeTunnelSetupNote server={server} servers={servers} />
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!connectorId || mutation.isPending}
            onClick={() => selected && mutation.mutate({
              connectorId: selected.id,
              integrationId: server.id,
              message: `${selected.name} now serves ${server.name}. Apply changes to add its tunnel peer.`,
            })}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
            Link connector
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "Link to an edge box" from a CONNECTOR: pick which edge it should also serve. */
export function LinkEdgeToConnectorDialog({
  connector,
  servers,
  open,
  onOpenChange,
}: {
  connector: ConnectorDto;
  /** Every edge box; the ones already linked are filtered out here. */
  servers: EdgeNatServer[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [integrationId, setIntegrationId] = useState("");
  const mutation = useLinkMutation(() => onOpenChange(false));
  const available = edgesAvailableForConnector(connector, servers);
  const selected = available.find((server) => server.id === integrationId) ?? null;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (next) setIntegrationId(""); onOpenChange(next); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Link {connector.name} to an edge box</DialogTitle>
          <DialogDescription>
            One installed connector can serve any number of edge boxes. Each link gives it another tunnel address —
            allocated from that edge&apos;s own subnet — on the same WireGuard interface.
          </DialogDescription>
        </DialogHeader>

        {available.length === 0 ? (
          <Alert>
            <Server />
            <AlertTitle>Already serving every edge box</AlertTitle>
            <AlertDescription>
              {connector.name} is linked to all {servers.length} edge box{servers.length === 1 ? "" : "es"} PolySIEM
              manages.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor={`link-edge-${connector.id}`}>Edge box</Label>
            <Select value={integrationId} onValueChange={setIntegrationId}>
              <SelectTrigger id={`link-edge-${connector.id}`} className="w-full">
                <SelectValue placeholder="Choose an edge box" />
              </SelectTrigger>
              <SelectContent>
                {available.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    <span>{server.name}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              After linking, that edge box can publish routes through {connector.name}. Apply changes there to bring the
              peer up.
            </p>
            <EdgeTunnelSetupNote server={selected} servers={servers} />
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!integrationId || mutation.isPending}
            onClick={() => selected && mutation.mutate({
              connectorId: connector.id,
              integrationId: selected.id,
              message: `${connector.name} now serves ${selected.name}. Apply changes there to add its tunnel peer.`,
            })}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Link2 />}
            Link edge box
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Unlink one connector from one edge box.
 *
 * The server refuses with 409 while routes on that edge still point at this
 * connector, and it names them. That refusal is shown VERBATIM — it is the list
 * of routes to fix, and paraphrasing it would lose them.
 */
export function UnlinkConnectorDialog({
  connector,
  link,
  edgeName,
  onOpenChange,
}: {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
  edgeName: string;
  onOpenChange: (open: boolean) => void;
}) {
  const refresh = useConnectorRefresh();
  const [blocked, setBlocked] = useState<string | null>(null);
  const remaining = connectorLinks(connector).length - 1;
  const mutation = useMutation({
    mutationFn: () => apiFetch(connectorLinkUrl(connector.id, link.id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success(`${connector.name} no longer serves ${edgeName}. Apply changes there to drop its peer.`);
      refresh();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      setBlocked(error.message);
      toast.error(error.message);
    },
  });

  return (
    <AlertDialog open onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop {connector.name} serving {edgeName}?</AlertDialogTitle>
          <AlertDialogDescription>
            The connector itself stays installed{remaining > 0
              ? ` and keeps serving ${remaining} other edge box${remaining === 1 ? "" : "es"}`
              : ""}. It loses its {link.tunnelAddress} address on {edgeName}, and that edge drops its tunnel peer after
            the next apply.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {blocked && (
          <Alert variant="destructive">
            <TriangleAlert />
            <AlertTitle>Routes still depend on this connector</AlertTitle>
            {/* The server's own message, unedited: it names the blocking routes. */}
            <AlertDescription>{blocked}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={mutation.isPending}
            onClick={(event) => {
              event.preventDefault();
              setBlocked(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? <Loader2 className="animate-spin" /> : <Unlink />}
            {blocked ? "Try again" : "Unlink"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
