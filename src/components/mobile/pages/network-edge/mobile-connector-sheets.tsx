"use client";

import { useState } from "react";
import {
  connectorInstallReveal,
  connectorLinkFor,
  connectorLinks,
  connectorTunnelProvisioned,
  edgeServerForLink,
  isManualConnector,
  type ConnectorDto,
  type ConnectorInstallReveal,
  type ConnectorLinkDto,
  type CreateConnectorResult,
  type EdgeNatServer,
} from "@/components/network/edge-networks-types";
import { ConnectorDetailSheet, ConnectorHostKeySheet, ConnectorSshEndpointSheet } from "./mobile-connector-detail";
import { ConnectorCreateSheet, ConnectorDeleteDialog, ConnectorEditSheet } from "./mobile-connector-forms";
import { ConnectorEdgePickerSheet, ConnectorLinkSheet } from "./mobile-connector-links";
import {
  ConnectorInstallSheet,
  ConnectorPeerSetupSheet,
  type InstallReveal,
  type ManualSetup,
} from "./mobile-connector-setup";

/**
 * Every sheet that opens over a connector list, in one place.
 *
 * Two surfaces show connectors — the instance-wide Connectors section and one
 * edge box's Connectors tab — and both need the same detail, install, peer,
 * link and delete sheets. The list presentations differ; the sheets do not, so
 * they live here and each list keeps only its own rows.
 *
 * The selected connector and the create sheet are controlled by the list (a row
 * tap, the FAB); everything a sheet opens from there is internal state. A
 * sub-sheet REPLACES the detail sheet and reopens it on close — two stacked
 * bottom sheets fight over the scroll lock on a phone.
 */
interface ConnectorLinkTarget {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
}

export function ConnectorSheetHost({
  connectors,
  edges,
  scope,
  isAdmin,
  selectedId,
  onSelectedIdChange,
  createOpen,
  onCreateOpenChange,
}: {
  /** The live list this surface renders, so a sheet always shows fresh data. */
  connectors: readonly ConnectorDto[];
  /** Every edge box PolySIEM knows about — connectors are linked to these. */
  edges: readonly EdgeNatServer[];
  /** The edge this surface is about, or null for the instance-wide list. */
  scope: EdgeNatServer | null;
  isAdmin: boolean;
  selectedId: string | null;
  onSelectedIdChange: (id: string | null) => void;
  createOpen: boolean;
  onCreateOpenChange: (open: boolean) => void;
}) {
  const [editing, setEditing] = useState<ConnectorDto | null>(null);
  const [sshEditing, setSshEditing] = useState<ConnectorDto | null>(null);
  const [hostKeyFor, setHostKeyFor] = useState<ConnectorDto | null>(null);
  const [reveal, setReveal] = useState<InstallReveal | null>(null);
  const [peerSetup, setPeerSetup] = useState<ManualSetup | null>(null);
  const [linkPickerFor, setLinkPickerFor] = useState<ConnectorDto | null>(null);
  const [linkTarget, setLinkTarget] = useState<ConnectorLinkTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectorDto | null>(null);

  const live = (id: string) => connectors.find((entry) => entry.id === id);
  const selected = (selectedId ? live(selectedId) : null) ?? null;
  // A sub-sheet replaces the detail sheet, then hands the operator back to it.
  const openSubSheet = (connector: ConnectorDto, open: (connector: ConnectorDto) => void) => {
    onSelectedIdChange(null);
    open(connector);
  };
  const closeSubSheet = (connector: ConnectorDto, close: () => void) => {
    close();
    onSelectedIdChange(connector.id);
  };
  const openReveal = (connector: ConnectorDto, minted: ConnectorInstallReveal, server: EdgeNatServer | null) => {
    onSelectedIdChange(null);
    setReveal({
      // `minted` is the rotate response verbatim, so the TLS variants ride along
      // with it; an older API simply omits them and the plain command is used.
      ...minted,
      connector,
      reason: "rotated",
      baselineLastSeenAt: connector.lastSeenAt,
      server: server ?? firstLinkedEdge(connector, edges),
    });
  };
  const openPeerSetup = (server: EdgeNatServer, connector: ConnectorDto, link: ConnectorLinkDto | null) => {
    onSelectedIdChange(null);
    setLinkTarget(null);
    setPeerSetup({ connector, server, link });
  };

  return (
    <>
      <ConnectorDetailSheet
        connector={selected}
        edges={edges}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && onSelectedIdChange(null)}
        onEdit={(connector) => openSubSheet(connector, setEditing)}
        onEditSsh={(connector) => openSubSheet(connector, setSshEditing)}
        onScanHostKey={(connector) => openSubSheet(connector, setHostKeyFor)}
        onLinkEdge={(connector) => openSubSheet(connector, setLinkPickerFor)}
        onOpenLink={(connector, link) => {
          onSelectedIdChange(null);
          setLinkTarget({ connector, link });
        }}
        onDelete={setConfirmDelete}
        onRotated={(connector, minted) => openReveal(connector, minted, scope)}
      />

      <ConnectorEditSheets
        edges={edges}
        editing={editing}
        sshEditing={sshEditing}
        hostKeyFor={hostKeyFor}
        onCloseEditing={(connector) => closeSubSheet(connector, () => setEditing(null))}
        onCloseSsh={(connector) => closeSubSheet(connector, () => setSshEditing(null))}
        onCloseHostKey={(connector) => closeSubSheet(connector, () => setHostKeyFor(null))}
      />

      <ConnectorLinkSheets
        connectors={connectors}
        edges={edges}
        isAdmin={isAdmin}
        linkPickerFor={linkPickerFor}
        linkTarget={linkTarget}
        onClosePicker={(connector) => closeSubSheet(connector, () => setLinkPickerFor(null))}
        onCloseLink={(connector) => closeSubSheet(connector, () => setLinkTarget(null))}
        onPeerSetup={openPeerSetup}
      />

      <ConnectorSetupSheets
        connectors={connectors}
        edges={edges}
        reveal={reveal}
        peerSetup={peerSetup}
        onCloseReveal={() => setReveal(null)}
        onClosePeerSetup={() => setPeerSetup(null)}
      />

      {createOpen && (
        <ConnectorCreateSheet
          edges={edges}
          defaultEdgeId={scope?.id ?? null}
          onOpenChange={onCreateOpenChange}
          onCreated={(result, integrationId) =>
            handleCreated(result, {
              edges,
              scope: scope ?? edges.find((edge) => edge.id === integrationId) ?? null,
              onCreateOpenChange,
              onSelectedIdChange,
              setReveal,
              setPeerSetup,
            })
          }
        />
      )}

      <ConnectorDeleteDialog
        connector={confirmDelete}
        edges={edges}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        onDeleted={() => {
          setConfirmDelete(null);
          onSelectedIdChange(null);
        }}
      />
    </>
  );
}

/** The edge a sheet should talk about when the surface itself names none. */
function firstLinkedEdge(connector: ConnectorDto, edges: readonly EdgeNatServer[]): EdgeNatServer | null {
  for (const link of connectorLinks(connector)) {
    const edge = edgeServerForLink(edges, link);
    if (edge) return edge;
  }
  return null;
}

/** Rename, SSH endpoint and host key — the three edits of one connector. */
function ConnectorEditSheets({
  edges,
  editing,
  sshEditing,
  hostKeyFor,
  onCloseEditing,
  onCloseSsh,
  onCloseHostKey,
}: {
  edges: readonly EdgeNatServer[];
  editing: ConnectorDto | null;
  sshEditing: ConnectorDto | null;
  hostKeyFor: ConnectorDto | null;
  onCloseEditing: (connector: ConnectorDto) => void;
  onCloseSsh: (connector: ConnectorDto) => void;
  onCloseHostKey: (connector: ConnectorDto) => void;
}) {
  return (
    <>
      {editing && (
        <ConnectorEditSheet
          connector={editing}
          edges={edges}
          onOpenChange={(open) => !open && onCloseEditing(editing)}
        />
      )}
      {sshEditing && (
        <ConnectorSshEndpointSheet connector={sshEditing} onOpenChange={(open) => !open && onCloseSsh(sshEditing)} />
      )}
      {hostKeyFor && (
        <ConnectorHostKeySheet connector={hostKeyFor} onOpenChange={(open) => !open && onCloseHostKey(hostKeyFor)} />
      )}
    </>
  );
}

/** Linking to another edge, and what one link is on the edge it belongs to. */
function ConnectorLinkSheets({
  connectors,
  edges,
  isAdmin,
  linkPickerFor,
  linkTarget,
  onClosePicker,
  onCloseLink,
  onPeerSetup,
}: {
  connectors: readonly ConnectorDto[];
  edges: readonly EdgeNatServer[];
  isAdmin: boolean;
  linkPickerFor: ConnectorDto | null;
  linkTarget: ConnectorLinkTarget | null;
  onClosePicker: (connector: ConnectorDto) => void;
  onCloseLink: (connector: ConnectorDto) => void;
  onPeerSetup: (server: EdgeNatServer, connector: ConnectorDto, link: ConnectorLinkDto) => void;
}) {
  // Re-resolve against the live list so a link sheet reflects the latest
  // allocation rather than the row the operator happened to tap.
  const liveConnector = (connector: ConnectorDto) =>
    connectors.find((entry) => entry.id === connector.id) ?? connector;
  return (
    <>
      {linkPickerFor && (
        <ConnectorEdgePickerSheet
          connector={liveConnector(linkPickerFor)}
          edges={edges}
          onOpenChange={(open) => !open && onClosePicker(linkPickerFor)}
        />
      )}
      {linkTarget && (
        <ConnectorLinkSheet
          connector={liveConnector(linkTarget.connector)}
          link={linkTarget.link}
          edges={edges}
          isAdmin={isAdmin}
          onOpenChange={(open) => !open && onCloseLink(linkTarget.connector)}
          onPeerSetup={(server, link) => onPeerSetup(server, liveConnector(linkTarget.connector), link)}
        />
      )}
    </>
  );
}

/** The two one-time flows: the agent installer and the manual peer block. */
function ConnectorSetupSheets({
  connectors,
  edges,
  reveal,
  peerSetup,
  onCloseReveal,
  onClosePeerSetup,
}: {
  connectors: readonly ConnectorDto[];
  edges: readonly EdgeNatServer[];
  reveal: InstallReveal | null;
  peerSetup: ManualSetup | null;
  onCloseReveal: () => void;
  onClosePeerSetup: () => void;
}) {
  const live = (id: string) => connectors.find((entry) => entry.id === id);
  return (
    <>
      {reveal && (
        <ConnectorInstallSheet
          reveal={reveal}
          edges={edges}
          live={live(reveal.connector.id)}
          onOpenChange={(open) => !open && onCloseReveal()}
        />
      )}
      {peerSetup && (
        <ConnectorPeerSetupSheet
          setup={peerSetup}
          live={live(peerSetup.connector.id)}
          onOpenChange={(open) => !open && onClosePeerSetup()}
        />
      )}
    </>
  );
}

/**
 * Where a fresh connector lands. A manual kind has no token and no command, so
 * it goes to the paste-ready peer block for the edge it was linked to; an agent
 * kind goes to the install sheet. A connector created without an edge is simply
 * selected — it exists, and linking it is the next step.
 */
function handleCreated(
  result: CreateConnectorResult,
  context: {
    edges: readonly EdgeNatServer[];
    scope: EdgeNatServer | null;
    onCreateOpenChange: (open: boolean) => void;
    onSelectedIdChange: (id: string | null) => void;
    setReveal: (reveal: InstallReveal) => void;
    setPeerSetup: (setup: ManualSetup) => void;
  },
): void {
  const { connector } = result;
  const server = context.scope ?? firstLinkedEdge(connector, context.edges);
  context.onCreateOpenChange(false);
  const minted = connectorInstallReveal(result);
  // Creating with an edge can also provision that edge's WireGuard tunnel, so
  // the fact travels into whichever setup sheet the operator lands on.
  const tunnelProvisioned = connectorTunnelProvisioned(result);
  if (!isManualConnector(connector) && minted) {
    context.setReveal({
      ...minted,
      connector,
      reason: "created",
      baselineLastSeenAt: connector.lastSeenAt,
      server,
      tunnelProvisioned,
    });
    return;
  }
  if (server) {
    const link = connectorLinkFor(connector, server.id);
    context.setPeerSetup({ connector, server, link, apiPeerConfig: result.peerConfig, tunnelProvisioned });
    return;
  }
  context.onSelectedIdChange(connector.id);
}
