"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable, Link2, Plus, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorKindOf,
  connectorLinks,
  connectorSshPresentation,
  connectorSummary,
  connectorTunnelAddressFor,
  connectorsListUrl,
  connectorsQueryKey,
  isManualConnector,
  type ConnectorDto,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { ConnectorKindBadge, ConnectorStatusBadge, connectorKindIcon, contactLabel } from "./mobile-connector-atoms";
import { EdgeConnectorPickerSheet, connectorPendingPoll, useAllConnectorsQuery } from "./mobile-connector-links";
import { ConnectorSheetHost } from "./mobile-connector-sheets";

/**
 * The connectors LINKED to one edge box.
 *
 * A connector is a standalone thing: installed once, linked to as many edge
 * boxes as it should serve, and holding a different tunnel address on each. So
 * this block offers two verbs — link an existing connector to this edge, or add
 * (install) a new one and link it in the same step.
 *
 * Shares the desktop query key, DTOs and derivations (presentation forks, data
 * does not); only the surface is phone-native. Declared here rather than
 * imported from the desktop card so the phone bundle never pulls the desktop
 * tree in.
 */
export function useConnectorsQuery(integrationId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: connectorsQueryKey(integrationId),
    queryFn: () => apiFetch<ConnectorDto[]>(connectorsListUrl(integrationId)),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => connectorPendingPoll(query.state.data),
  });
}

/** One connector on THIS edge: identity on top, this edge's address below. */
function ConnectorRow({
  connector,
  integrationId,
  onSelect,
}: {
  connector: ConnectorDto;
  integrationId: string;
  onSelect: () => void;
}) {
  const kind = connectorKindOf(connector);
  const manual = isManualConnector(connector);
  const address = connectorTunnelAddressFor(connector, integrationId);
  const elsewhere = connectorLinks(connector).filter((link) => link.integrationId !== integrationId).length;
  return (
    <MobileListRow
      onClick={onSelect}
      leading={connectorKindIcon(kind)}
      title={
        <>
          <span className="truncate">{connector.name}</span>
          <ConnectorStatusBadge connector={connector} />
          <ConnectorKindBadge kind={kind} />
          {elsewhere > 0 && (
            <Badge variant="outline" className="text-[10px] font-normal">
              +{elsewhere} edge{elsewhere === 1 ? "" : "s"}
            </Badge>
          )}
          {!manual && connectorSshPresentation(connector).readiness === "ready" && (
            <Badge variant="outline" className="text-[10px] font-normal">
              ssh
            </Badge>
          )}
        </>
      }
      subtitle={
        <span className="font-mono">
          {connector.connectorId} · {address ?? "no address here"}
        </span>
      }
      trailing={<span className="max-w-24 truncate">{trailingLabel(connector, manual)}</span>}
    />
  );
}

function trailingLabel(connector: ConnectorDto, manual: boolean): string {
  if (!manual) return contactLabel(connector);
  return connector.publicKey ? "Key registered" : "No key yet";
}

/** Loading, failed, empty or listed — the four states of the connector list. */
function ConnectorsListBody({
  connectors,
  integrationId,
  isLoading,
  error,
  onSelect,
}: {
  connectors: readonly ConnectorDto[];
  integrationId: string;
  isLoading: boolean;
  error: Error | null;
  onSelect: (id: string) => void;
}) {
  if (isLoading) return <Skeleton className="h-24 rounded-xl" />;
  return (
    <>
      {error && (
        <p className="flex items-start gap-1.5 rounded-xl border border-dashed px-3 py-2 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Connectors unavailable: {error.message}
        </p>
      )}
      {!error && connectors.length === 0 && (
        <MobileEmpty
          icon={<Cable />}
          title="No connector linked"
          description="A connector is the far end of a tunnel — PolySIEM's agent, an OPNsense box, or another WireGuard peer. It is installed once and can serve several edge boxes, so link one you already have or add a new one."
        />
      )}
      {connectors.length > 0 && (
        <MobileList>
          {connectors.map((connector) => (
            <ConnectorRow
              key={connector.id}
              connector={connector}
              integrationId={integrationId}
              onSelect={() => onSelect(connector.id)}
            />
          ))}
        </MobileList>
      )}
    </>
  );
}

/**
 * Phone connector block for one edge server: every connector linked to it,
 * whatever kind it is. Managed kinds get the two-ended installer; manual kinds
 * get the paste-ready peer block instead. Details and every action live in
 * bottom sheets.
 */
export function MobileConnectorsBlock({
  server,
  servers,
  isAdmin,
}: {
  server: EdgeNatServer;
  /** Every edge box, so a connector can be linked onward from its detail sheet. */
  servers?: readonly EdgeNatServer[];
  isAdmin: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);

  const connectorsQuery = useConnectorsQuery(server.id, { enabled: server.enabled });
  const connectors = connectorsQuery.data ?? [];
  // Only fetched while the picker is open: linking is the one action that needs
  // to see connectors this edge does not have.
  const allConnectors = useAllConnectorsQuery({ enabled: linkOpen });
  const edges = servers && servers.length > 0 ? servers : [server];

  return (
    <div className="flex flex-col gap-1.5">
      <ConnectorsListBody
        connectors={connectors}
        integrationId={server.id}
        isLoading={connectorsQuery.isLoading}
        error={connectorsQuery.error as Error | null}
        onSelect={setSelectedId}
      />

      {isAdmin && server.enabled && (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="sm" onClick={() => setLinkOpen(true)}>
            <Link2 /> Link a connector
          </Button>
          <Button variant="outline" size="sm" onClick={() => setCreateOpen(true)}>
            <Plus /> Add connector
          </Button>
        </div>
      )}
      <p className="px-0.5 text-[11px] text-muted-foreground">
        One connector can serve several edge boxes; each link gets its own tunnel address here.
      </p>

      <ConnectorSheetHost
        connectors={connectors}
        edges={edges}
        scope={server}
        isAdmin={isAdmin}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
        createOpen={createOpen}
        onCreateOpenChange={setCreateOpen}
      />

      {linkOpen && (
        <EdgeConnectorPickerSheet
          server={server}
          connectors={allConnectors.data ?? []}
          isLoading={allConnectors.isLoading}
          onOpenChange={setLinkOpen}
        />
      )}
    </div>
  );
}

/** Connector readiness for the segmented control: "2/3" ready, or nothing yet. */
export function connectorsTabBadge(connectors: readonly ConnectorDto[]): { badge: string; ready: boolean } {
  const summary = connectorSummary(connectors);
  if (summary.total === 0) return { badge: "none", ready: false };
  return { badge: `${summary.ready}/${summary.total} ready`, ready: summary.ready === summary.total };
}
