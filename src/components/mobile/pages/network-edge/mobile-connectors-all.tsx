"use client";

import { useState } from "react";
import { Cable, Plus, Router } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorKindOf,
  connectorLinks,
  connectorSshPresentation,
  connectorSummary,
  isManualConnector,
  CONNECTOR_INDEPENDENCE_COPY,
  type ConnectorDto,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { ConnectorKindBadge, ConnectorStatusBadge, connectorKindIcon, contactLabel } from "./mobile-connector-atoms";
import { ConnectorLinkKeyRows, linkCountLabel, useAllConnectorsQuery } from "./mobile-connector-links";
import { ConnectorSheetHost } from "./mobile-connector-sheets";
import { MobileSummaryLine, type MobileSummaryItem } from "./mobile-edge-tabs";

/**
 * The instance-wide Connectors section — a peer of the edge-box list, not a
 * child of one edge.
 *
 * Connectors and edge boxes are separate concepts in the same feature: a
 * connector is installed ONCE and serves however many edge boxes it is linked
 * to, and any edge routes through any connector linked to it. So each card here
 * names the connector, its kind and status, then the edges it serves with the
 * tunnel address it holds on each — the whole model in one card.
 */
export function MobileAllConnectorsPanel({
  servers,
  isAdmin,
  createOpen,
  onCreateOpenChange,
}: {
  servers: readonly EdgeNatServer[];
  isAdmin: boolean;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const connectorsQuery = useAllConnectorsQuery();
  const connectors = connectorsQuery.data ?? [];

  return (
    <>
      <MobileSummaryLine items={connectorOverviewItems(connectors)} />
      <AllConnectorsBody
        connectors={connectors}
        servers={servers}
        isLoading={connectorsQuery.isLoading}
        error={connectorsQuery.error as Error | null}
        onSelect={setSelectedId}
      />

      <div className="flex flex-col gap-1.5">
        {isAdmin && (
          <Button variant="outline" size="sm" className="w-full" onClick={() => onCreateOpenChange(true)}>
            <Plus /> Add connector
          </Button>
        )}
        <p className="px-0.5 text-[11px] text-muted-foreground">
          {CONNECTOR_INDEPENDENCE_COPY} Each link gets its own address from that edge&apos;s tunnel subnet, all carried
          on the connector&apos;s single WireGuard interface.
        </p>
      </div>

      <ConnectorSheetHost
        connectors={connectors}
        edges={servers}
        scope={null}
        isAdmin={isAdmin}
        selectedId={selectedId}
        onSelectedIdChange={setSelectedId}
        createOpen={createOpen}
        onCreateOpenChange={onCreateOpenChange}
      />
    </>
  );
}

/**
 * How many connectors exist, how many are ready, and how many edge boxes they
 * serve between them — on one line. A connector that serves no edge yet is a
 * fact, not a fault, so it is stated rather than coloured.
 */
function connectorOverviewItems(connectors: readonly ConnectorDto[]): MobileSummaryItem[] {
  const summary = connectorSummary(connectors);
  const linkCount = connectors.reduce((total, connector) => total + connectorLinks(connector).length, 0);
  const unlinked = connectors.filter((connector) => connectorLinks(connector).length === 0).length;
  const items: MobileSummaryItem[] = [
    { label: `${summary.ready}/${summary.total} ready` },
    { label: `${linkCount} edge link${linkCount === 1 ? "" : "s"}` },
  ];
  if (unlinked > 0) items.push({ label: `${unlinked} not linked yet` });
  return items;
}

/** Loading, failed, empty, or one card per connector. */
function AllConnectorsBody({
  connectors,
  servers,
  isLoading,
  error,
  onSelect,
}: {
  connectors: readonly ConnectorDto[];
  servers: readonly EdgeNatServer[];
  isLoading: boolean;
  error: Error | null;
  onSelect: (id: string) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
    );
  }
  if (error) {
    return (
      <EmptyState
        icon={Router}
        title="Could not load connectors"
        description={error.message || "The connector inventory is unavailable."}
      />
    );
  }
  if (connectors.length === 0) {
    return (
      <EmptyState
        icon={Cable}
        title="No connectors yet"
        description="A connector is the far end of a tunnel: PolySIEM's agent on a Linux host, an OPNsense box, or another WireGuard peer. It dials out, so nothing at home needs a public IP — and one install can serve every edge box you link it to."
      />
    );
  }
  return (
    <>
      {connectors.map((connector) => (
        <ConnectorCard
          key={connector.id}
          connector={connector}
          servers={servers}
          onSelect={() => onSelect(connector.id)}
        />
      ))}
    </>
  );
}

/** One connector: what it is, then every edge it serves and its address there. */
function ConnectorCard({
  connector,
  servers,
  onSelect,
}: {
  connector: ConnectorDto;
  servers: readonly EdgeNatServer[];
  onSelect: () => void;
}) {
  const kind = connectorKindOf(connector);
  const manual = isManualConnector(connector);
  return (
    <MobileList>
      <MobileListRow
        onClick={onSelect}
        leading={connectorKindIcon(kind)}
        title={
          <>
            <span className="truncate">{connector.name}</span>
            <ConnectorStatusBadge connector={connector} />
            <ConnectorKindBadge kind={kind} />
          </>
        }
        subtitle={<span className="font-mono">{connector.connectorId}</span>}
        trailing={<span className="max-w-24 truncate">{linkCountLabel(connector)}</span>}
      />
      <ConnectorLinkKeyRows connector={connector} edges={servers} />
      <MobileKeyRow label={manual ? "Peer key" : "Last contact"}>
        {manual ? manualKeyLabel(connector) : contactLabel(connector)}
      </MobileKeyRow>
      {!manual && <MobileKeyRow label="SSH management">{connectorSshPresentation(connector).label}</MobileKeyRow>}
    </MobileList>
  );
}

function manualKeyLabel(connector: ConnectorDto): string {
  return connector.publicKey ? "Registered" : "Not pasted in yet";
}
