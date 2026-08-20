"use client";

import { type FormEvent, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Pencil, Plus } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import {
  connectorLinks,
  connectorUrl,
  isManualConnector,
  isValidConnectorName,
  CONNECTORS_ENDPOINT,
  CONNECTOR_KIND_CHOICES,
  type ConnectorDto,
  type ConnectorKind,
  type CreateConnectorResult,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "@/components/network/edge-networks-types";
import { EdgeTunnelSetupNote, connectorKindIcon } from "./mobile-connector-atoms";
import { ConnectorLinkKeyRows, useConnectorInvalidator } from "./mobile-connector-links";
import { MobileOptionCard } from "./mobile-form-controls";

/** Sentinel for "create it standalone"; no edge id can collide with it. */
const NO_EDGE = "__none__";

/** Placeholder name per kind, so the field shows a realistic example. */
function namePlaceholder(kind: ConnectorKind): string {
  if (kind === "opnsense") return "HomeOpnsense";
  return kind === "peer" ? "GarageRouter" : "EdgeNetworkVm";
}

/** Which edge to link the new connector to, or none — it can be linked later. */
function ConnectorEdgeField({
  edges,
  value,
  onChange,
}: {
  edges: readonly EdgeNatServer[];
  value: string;
  onChange: (value: string) => void;
}) {
  if (edges.length === 0) return null;
  // Linking is what brings an edge's WireGuard tunnel up, so if this one has no
  // tunnel yet the operator hears it here rather than after the fact.
  const selected = edges.find((edge) => edge.id === value) ?? null;
  return (
    <div className="grid gap-1.5">
      <Label>Link it to an edge box</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {edges.map((edge) => (
            <SelectItem key={edge.id} value={edge.id}>
              {edge.name}
            </SelectItem>
          ))}
          <SelectItem value={NO_EDGE}>Link later</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">
        A connector is not owned by one edge. This just creates its first link — you can link it to more edge boxes
        afterwards, and it holds a separate tunnel address on each.
      </p>
      <EdgeTunnelSetupNote server={selected} servers={edges} />
    </div>
  );
}

export function ConnectorCreateSheet({
  edges,
  defaultEdgeId,
  onOpenChange,
  onCreated,
}: {
  edges: readonly EdgeNatServer[];
  /** Preselected when the sheet was opened from one edge's Connectors tab. */
  defaultEdgeId: string | null;
  onOpenChange: (open: boolean) => void;
  /** The chosen edge travels with the result, so the next sheet knows the context. */
  onCreated: (result: CreateConnectorResult, integrationId: string | null) => void;
}) {
  const invalidate = useConnectorInvalidator();
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<ConnectorKind>("agent");
  const [edgeId, setEdgeId] = useState(defaultEdgeId ?? NO_EDGE);
  const nameValid = isValidConnectorName(name);
  const manual = isManualConnector({ kind });

  const mutation = useMutation({
    mutationFn: () =>
      apiFetch<CreateConnectorResult>(CONNECTORS_ENDPOINT, {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          notes: notes.trim() || undefined,
          kind,
          // Optional: a connector is standalone, and this only creates its first link.
          integrationId: edgeId === NO_EDGE ? undefined : edgeId,
        }),
      }),
    onSuccess: (result) => {
      toast.success(createdMessage(manual, edgeId !== NO_EDGE));
      invalidate();
      onCreated(result, edgeId === NO_EDGE ? null : edgeId);
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
      description="Pick what sits at the far end of the tunnel, then name it. PolySIEM assigns its address on every edge you link it to."
    >
      <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
        <div className="grid gap-1.5">
          <Label>Connector kind</Label>
          <div className="grid gap-2">
            {CONNECTOR_KIND_CHOICES.map((choice) => (
              <MobileOptionCard
                key={choice.value}
                icon={connectorKindIcon(choice.value)}
                title={choice.title}
                detail={choice.detail}
                selected={kind === choice.value}
                onSelect={() => setKind(choice.value)}
              />
            ))}
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="m-cx-name">Connector name</Label>
          <Input
            id="m-cx-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={namePlaceholder(kind)}
            autoComplete="off"
            spellCheck={false}
            className={cn(name && !nameValid && "border-destructive")}
          />
          <p className="text-xs text-muted-foreground">Names are unique across PolySIEM, not per edge box.</p>
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

        <ConnectorEdgeField edges={edges} value={edgeId} onChange={setEdgeId} />

        <p className="rounded-xl border border-info/30 bg-info/5 px-3 py-2 text-xs text-info">
          {manual
            ? "The next screen shows the tunnel settings to paste into the far side, and takes its public key back. No install token and no SSH key are issued for this kind."
            : "The next screen shows what to run on the edge server and on this machine. Nothing inbound is opened at home — the connector dials out to the edge."}
        </p>
        <Button type="submit" className="w-full" disabled={mutation.isPending || !nameValid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Create connector
        </Button>
      </form>
    </BottomSheet>
  );
}

function createdMessage(manual: boolean, linked: boolean): string {
  if (!linked) return "Connector created. Link it to an edge box when you are ready.";
  return manual
    ? "Connector created — copy the peer settings into the far side."
    : "Connector created — run the install command on the machine.";
}

export function ConnectorEditSheet({
  connector,
  edges,
  onOpenChange,
}: {
  connector: ConnectorDto;
  edges: readonly EdgeNatServer[];
  onOpenChange: (open: boolean) => void;
}) {
  const invalidate = useConnectorInvalidator();
  const [name, setName] = useState(connector.name);
  const [notes, setNotes] = useState(connector.notes ?? "");
  const nameValid = isValidConnectorName(name);

  const mutation = useMutation({
    mutationFn: (input: UpdateConnectorInput) =>
      apiFetch<ConnectorDto>(connectorUrl(connector.id), { method: "PATCH", body: JSON.stringify(input) }),
    onSuccess: () => {
      toast.success("Connector updated");
      invalidate();
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
      description="Only the label and notes change — the connector ID and its per-edge addresses stay fixed."
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
          <ConnectorLinkKeyRows connector={connector} edges={edges} />
        </MobileList>
        <Button type="submit" className="w-full" disabled={mutation.isPending || !nameValid}>
          {mutation.isPending ? <Loader2 className="animate-spin" /> : <Pencil />} Save connector
        </Button>
      </form>
    </BottomSheet>
  );
}

/** What deleting costs: every edge it serves, its routes, and what the far side keeps. */
function deleteConsequence(connector: ConnectorDto | null, routeCount: number, edgeCount: number): string {
  const edges =
    edgeCount > 0
      ? `It serves ${edgeCount} edge ${edgeCount === 1 ? "box" : "boxes"} and is unlinked from all of them. `
      : "";
  const routes =
    routeCount > 0
      ? `${routeCount} published ${routeCount === 1 ? "route" : "routes"} go through this connector and are removed with it. `
      : "";
  const far =
    connector && isManualConnector(connector)
      ? "Its WireGuard peer drops off each edge on the next apply. The far side keeps its own configuration until you remove it there."
      : "Its WireGuard peer drops off each edge on the next apply, the agent on that machine stops enrolling, and the SSH key PolySIEM held for it is destroyed.";
  return `${edges}${routes}${far}`;
}

export function ConnectorDeleteDialog({
  connector,
  edges,
  onOpenChange,
  onDeleted,
}: {
  connector: ConnectorDto | null;
  edges: readonly EdgeNatServer[];
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const invalidate = useConnectorInvalidator();
  // Rules live on the edges, so the cost of deleting is counted across every
  // edge this connector serves — not just the one being looked at.
  const routeCount = connector
    ? edges.reduce(
        (total, edge) => total + edge.rules.filter((rule) => rule.connectorId === connector.id).length,
        0,
      )
    : 0;
  const mutation = useMutation({
    mutationFn: (id: string) => apiFetch(connectorUrl(id), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Connector removed. Apply each edge it served to drop its peer.");
      invalidate();
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
            {deleteConsequence(connector, routeCount, connector ? connectorLinks(connector).length : 0)}
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
