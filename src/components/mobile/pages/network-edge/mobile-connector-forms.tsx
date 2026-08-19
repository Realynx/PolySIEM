"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Textarea } from "@/components/ui/textarea";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileKeyRow, MobileList } from "@/components/mobile/ui/mobile-list";
import {
  connectorUrl,
  connectorsListUrl,
  connectorsQueryKey,
  isManualConnector,
  isValidConnectorName,
  CONNECTOR_KIND_CHOICES,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorKind,
  type CreateConnectorResult,
  type EdgeNatServer,
  type UpdateConnectorInput,
} from "@/components/network/edge-networks-types";
import { connectorKindIcon } from "./mobile-connector-atoms";
import { MobileOptionCard } from "./mobile-form-controls";

/** Placeholder name per kind, so the field shows a realistic example. */
function namePlaceholder(kind: ConnectorKind): string {
  if (kind === "opnsense") return "HomeOpnsense";
  return kind === "peer" ? "GarageRouter" : "EdgeNetworkVm";
}

export function ConnectorCreateSheet({
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
  const [kind, setKind] = useState<ConnectorKind>("agent");
  const nameValid = isValidConnectorName(name);
  const manual = isManualConnector({ kind });

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
          kind,
        }),
      }),
    onSuccess: (result) => {
      toast.success(
        manual
          ? "Connector created — copy the peer settings into the far side."
          : "Connector created — run the install command on the machine.",
      );
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
      description="Pick what sits at the far end of the tunnel, then name it. PolySIEM assigns its tunnel address."
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

export function ConnectorEditSheet({
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

/** What deleting costs: the routes that ride this connector, and what the far side keeps. */
function deleteConsequence(connector: ConnectorDto | null, routeCount: number): string {
  const routes =
    routeCount > 0
      ? `${routeCount} published ${routeCount === 1 ? "route" : "routes"} go through this connector and are removed with it. `
      : "";
  const far =
    connector && isManualConnector(connector)
      ? "Its WireGuard peer drops off the edge on the next apply. The far side keeps its own configuration until you remove it there."
      : "Its WireGuard peer drops off the edge on the next apply, the agent on that machine stops enrolling, and the SSH key PolySIEM held for it is destroyed.";
  return `${routes}${far}`;
}

export function ConnectorDeleteDialog({
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
          <AlertDialogDescription>{deleteConsequence(connector, routeCount)}</AlertDialogDescription>
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
