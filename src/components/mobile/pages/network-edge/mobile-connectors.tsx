"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Cable, Plus, TriangleAlert } from "lucide-react";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MobileEmpty, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorInstallReveal,
  connectorKindOf,
  connectorSshPresentation,
  connectorSummary,
  connectorsListUrl,
  connectorsQueryKey,
  isManualConnector,
  type ConnectorDto,
  type ConnectorInstallReveal,
  type ConnectorInstallReason,
  type ConnectorPeerConfigDto,
  type CreateConnectorResult,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import {
  ConnectorKindBadge,
  ConnectorStatusBadge,
  connectorKindIcon,
  contactLabel,
} from "./mobile-connector-atoms";
import { ConnectorDetailSheet, ConnectorHostKeySheet, ConnectorSshEndpointSheet } from "./mobile-connector-detail";
import { ConnectorCreateSheet, ConnectorDeleteDialog, ConnectorEditSheet } from "./mobile-connector-forms";
import {
  ConnectorInstallSheet,
  ConnectorPeerSetupSheet,
  type InstallReveal,
  type ManualSetup,
} from "./mobile-connector-setup";

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

/** One connector as a two-line row: identity on top, its last contact trailing. */
function ConnectorRow({ connector, onSelect }: { connector: ConnectorDto; onSelect: () => void }) {
  const kind = connectorKindOf(connector);
  const manual = isManualConnector(connector);
  return (
    <MobileListRow
      onClick={onSelect}
      leading={connectorKindIcon(kind)}
      title={
        <>
          <span className="truncate">{connector.name}</span>
          <ConnectorStatusBadge connector={connector} />
          <ConnectorKindBadge kind={kind} />
          {!manual && connectorSshPresentation(connector).readiness === "ready" && (
            <Badge variant="outline" className="text-[10px] font-normal">
              ssh
            </Badge>
          )}
        </>
      }
      subtitle={<span className="font-mono">{connector.connectorId}</span>}
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
  isLoading,
  error,
  onSelect,
}: {
  connectors: readonly ConnectorDto[];
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
          title="No connectors"
          description="A connector is the far end of this edge's tunnel — PolySIEM's agent, an OPNsense box, or another WireGuard peer. It dials out, so ports can be published without a public IP at home."
        />
      )}
      {connectors.length > 0 && (
        <MobileList>
          {connectors.map((connector) => (
            <ConnectorRow key={connector.id} connector={connector} onSelect={() => onSelect(connector.id)} />
          ))}
        </MobileList>
      )}
    </>
  );
}

/** Everything that opens over the list: create, rename, SSH, host key, install, peer setup. */
function ConnectorSheets({
  server,
  connectors,
  sheets,
  onCreateOpenChange,
  onCreated,
  onCloseEditing,
  onCloseSshEditing,
  onCloseHostKey,
  onCloseReveal,
  onClosePeerSetup,
}: {
  server: EdgeNatServer;
  connectors: readonly ConnectorDto[];
  sheets: {
    createOpen: boolean;
    editing: ConnectorDto | null;
    sshEditing: ConnectorDto | null;
    hostKeyFor: ConnectorDto | null;
    reveal: InstallReveal | null;
    peerSetup: ManualSetup | null;
  };
  onCreateOpenChange: (open: boolean) => void;
  onCreated: (result: CreateConnectorResult) => void;
  onCloseEditing: () => void;
  onCloseSshEditing: (connector: ConnectorDto) => void;
  onCloseHostKey: (connector: ConnectorDto) => void;
  onCloseReveal: () => void;
  onClosePeerSetup: () => void;
}) {
  const { createOpen, editing, sshEditing, hostKeyFor, reveal, peerSetup } = sheets;
  const live = (id: string) => connectors.find((entry) => entry.id === id);
  return (
    <>
      {createOpen && <ConnectorCreateSheet server={server} onOpenChange={onCreateOpenChange} onCreated={onCreated} />}
      {editing && (
        <ConnectorEditSheet
          server={server}
          connector={editing}
          onOpenChange={(open) => !open && onCloseEditing()}
        />
      )}
      {sshEditing && (
        <ConnectorSshEndpointSheet
          server={server}
          connector={sshEditing}
          onOpenChange={(open) => !open && onCloseSshEditing(sshEditing)}
        />
      )}
      {hostKeyFor && (
        <ConnectorHostKeySheet
          server={server}
          connector={hostKeyFor}
          onOpenChange={(open) => !open && onCloseHostKey(hostKeyFor)}
        />
      )}
      {reveal && (
        <ConnectorInstallSheet
          server={server}
          reveal={reveal}
          live={live(reveal.connector.id)}
          onOpenChange={(open) => !open && onCloseReveal()}
        />
      )}
      {peerSetup && (
        <ConnectorPeerSetupSheet
          server={server}
          setup={peerSetup}
          live={live(peerSetup.connector.id)}
          onOpenChange={(open) => !open && onClosePeerSetup()}
        />
      )}
    </>
  );
}

/**
 * Phone connector block for an edge server: every far end of its tunnel,
 * whatever kind it is — PolySIEM's own agent, an OPNsense box, or another
 * WireGuard peer. Managed kinds get the two-ended installer; manual kinds get
 * the paste-ready peer block instead. Details and every action live in bottom
 * sheets.
 */
export function MobileConnectorsBlock({ server, isAdmin }: { server: EdgeNatServer; isAdmin: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ConnectorDto | null>(null);
  const [sshEditing, setSshEditing] = useState<ConnectorDto | null>(null);
  const [hostKeyFor, setHostKeyFor] = useState<ConnectorDto | null>(null);
  const [reveal, setReveal] = useState<InstallReveal | null>(null);
  const [peerSetup, setPeerSetup] = useState<ManualSetup | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectorDto | null>(null);

  // While an install/setup sheet is open the operator is watching for the far
  // end to come up, so poll hard; otherwise the list rides the page refresh.
  const connectorsQuery = useConnectorsQuery(server.id, {
    enabled: server.enabled,
    refetchInterval: reveal || peerSetup ? 5_000 : false,
  });
  const connectors = connectorsQuery.data ?? [];
  const selected = connectors.find((connector) => connector.id === selectedId) ?? null;

  const openReveal = (connector: ConnectorDto, minted: ConnectorInstallReveal, reason: ConnectorInstallReason) => {
    setSelectedId(null);
    setReveal({ ...minted, connector, reason, baselineLastSeenAt: connector.lastSeenAt });
  };
  // Manual kinds get no token and no install command — they get the paste-ready
  // peer block instead, so a create lands on a different sheet entirely.
  const openPeerSetup = (connector: ConnectorDto, apiPeerConfig?: ConnectorPeerConfigDto | null) => {
    setSelectedId(null);
    setPeerSetup({ connector, apiPeerConfig });
  };
  // A sub-sheet replaces the detail sheet (two stacked sheets fight for the
  // scroll lock on a phone), then hands the operator back to it on close.
  const openSubSheet = (connector: ConnectorDto, open: (connector: ConnectorDto) => void) => {
    setSelectedId(null);
    open(connector);
  };
  const closeSubSheet = (connector: ConnectorDto, close: () => void) => {
    close();
    setSelectedId(connector.id);
  };
  // Manual kinds come back without a token or command; anything else that
  // arrives without one is treated the same way rather than rendering an empty
  // command block.
  const onCreated = (result: CreateConnectorResult) => {
    setCreateOpen(false);
    const minted = connectorInstallReveal(result);
    if (isManualConnector(result.connector) || !minted) {
      openPeerSetup(result.connector, result.peerConfig);
      return;
    }
    openReveal(result.connector, minted, "created");
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ConnectorsListBody
        connectors={connectors}
        isLoading={connectorsQuery.isLoading}
        error={connectorsQuery.error as Error | null}
        onSelect={setSelectedId}
      />

      {isAdmin && server.enabled && (
        <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateOpen(true)}>
          <Plus /> Add connector
        </Button>
      )}
      <p className="px-0.5 text-[11px] text-muted-foreground">
        A connector is any far end of this edge&apos;s tunnel — a PolySIEM agent, your OPNsense box, or another
        WireGuard peer. Its tunnel address is assigned automatically; you never type one.
      </p>

      <ConnectorDetailSheet
        server={server}
        connector={selected}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setSelectedId(null)}
        onEdit={(connector) => openSubSheet(connector, setEditing)}
        onEditSsh={(connector) => openSubSheet(connector, setSshEditing)}
        onScanHostKey={(connector) => openSubSheet(connector, setHostKeyFor)}
        onPeerSetup={(connector) => openPeerSetup(connector)}
        onDelete={(connector) => setConfirmDelete(connector)}
        onRotated={(connector, minted) => openReveal(connector, minted, "rotated")}
      />

      <ConnectorSheets
        server={server}
        connectors={connectors}
        sheets={{ createOpen, editing, sshEditing, hostKeyFor, reveal, peerSetup }}
        onCreateOpenChange={setCreateOpen}
        onCreated={onCreated}
        onCloseEditing={() => setEditing(null)}
        onCloseSshEditing={(connector) => closeSubSheet(connector, () => setSshEditing(null))}
        onCloseHostKey={(connector) => closeSubSheet(connector, () => setHostKeyFor(null))}
        onCloseReveal={() => setReveal(null)}
        onClosePeerSetup={() => setPeerSetup(null)}
      />

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

/** Connector readiness for the segmented control: "2/3" ready, or nothing yet. */
export function connectorsTabBadge(connectors: readonly ConnectorDto[]): { badge: string; ready: boolean } {
  const summary = connectorSummary(connectors);
  if (summary.total === 0) return { badge: "none", ready: false };
  return { badge: `${summary.ready}/${summary.total} ready`, ready: summary.ready === summary.total };
}
