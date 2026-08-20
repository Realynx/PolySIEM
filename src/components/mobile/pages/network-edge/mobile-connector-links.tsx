"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Cable, Link2, Link2Off, Loader2, Server, TriangleAlert, Waypoints } from "lucide-react";
import { toast } from "sonner";
import { formatRelative } from "@/lib/format";
import { apiFetch } from "@/components/shared/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { BottomSheet } from "@/components/mobile/ui/bottom-sheet";
import { MobileEmpty, MobileKeyRow, MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  connectorKindLabel,
  connectorLinkEdgeName,
  connectorLinkFor,
  connectorLinkPeerHandoff,
  connectorLinkSummary,
  connectorLinkUrl,
  connectorLinks,
  connectorLinksUrl,
  connectorsAllUrl,
  connectorsAvailableToLink,
  connectorsQueryKey,
  connectorPeerSettingsAction,
  connectorTunnelProvisioned,
  connectorTunnelProvisionedCopy,
  edgeServerForLink,
  edgeTunnelSetupNotice,
  edgesAvailableForConnector,
  isConnectorLinkEnabled,
  isManualConnector,
  CONNECTORS_QUERY_PREFIX,
  EDGE_NETWORKS_QUERY_KEY,
  type ConnectorDto,
  type ConnectorLinkDto,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
  type LinkConnectorInput,
  type LinkConnectorResult,
} from "@/components/network/edge-networks-types";
import { EdgeTunnelSetupNote } from "./mobile-connector-atoms";
// Type only — erased at build time, so the peer-setup sheet keeps importing the
// link rows from here without the two modules meeting at runtime.
import type { ManualSetup } from "./mobile-connector-setup";

/**
 * Connector ↔ edge links, on a phone.
 *
 * A connector is installed ONCE and is standalone: it belongs to no edge box. A
 * **link** joins one connector to one edge, and the tunnel address lives on the
 * link, not on the connector — each edge has its own tunnel subnet, so a
 * connector serving two edges holds a different tunnel IP on each. The
 * connector still runs ONE WireGuard interface: one peer, and one address, per
 * linked edge.
 *
 * Every derivation (which links exist, which edges are still linkable, the
 * address on one edge) comes from the shared desktop layer, so both
 * presentations answer these questions identically. Only the surface is here.
 */

/**
 * Poll only while something is still expected to arrive: a `pending` connector
 * is one nobody has installed or keyed yet, and that is exactly when an
 * operator is watching the screen for it to flip.
 */
export function connectorPendingPoll(data: readonly ConnectorDto[] | undefined): number | false {
  return (data ?? []).some((connector) => connector.status === "pending") ? 5_000 : false;
}

/**
 * The instance-wide connector list. Same endpoint, DTO and key prefix as the
 * per-edge query — only the filter differs — so the two share one cache
 * namespace and one invalidation.
 */
export function useAllConnectorsQuery(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: connectorsQueryKey(),
    queryFn: () => apiFetch<ConnectorDto[]>(connectorsAllUrl()),
    enabled: options?.enabled ?? true,
    refetchInterval: (query) => connectorPendingPoll(query.state.data),
  });
}

/**
 * Refresh every connector surface at once. One connector now appears in the
 * instance-wide list AND in each linked edge's list, so mutations invalidate the
 * shared prefix rather than guessing which lists they touched.
 */
export function useConnectorInvalidator(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: CONNECTORS_QUERY_PREFIX });
    void queryClient.invalidateQueries({ queryKey: EDGE_NETWORKS_QUERY_KEY });
  };
}

/** Which connector is being joined to which edge box — both halves of a link. */
export interface LinkConnectorTarget {
  connector: ConnectorDto;
  server: EdgeNatServer;
}

/**
 * The link response carries `peerConfig`: the paste-ready block for the edge
 * that was JUST linked. For a manual kind that block is the whole reason the
 * operator linked — it holds that edge's endpoint, its public key, the far
 * side's AllowedIPs and the address this edge allocated — so the link hands it
 * straight to the peer-settings sheet, scoped to the new link. An agent kind has
 * nothing to paste anywhere, so it keeps the toast.
 *
 * Reading the response is `connectorLinkPeerHandoff`'s job, shared with desktop:
 * it decides manual-or-not and folds the new link into the connector so the new
 * edge's address resolves before the list refetches. Only the packaging — this
 * phone's sheet takes the edge server object — is done here.
 */
function linkedManualSetup(result: LinkConnectorResult, target: LinkConnectorTarget): ManualSetup | null {
  const handoff = connectorLinkPeerHandoff({
    connector: target.connector,
    integrationId: target.server.id,
    result,
  });
  if (!handoff) return null;
  return {
    connector: handoff.connector,
    server: target.server,
    link: connectorLinkFor(handoff.connector, handoff.integrationId),
    apiPeerConfig: handoff.peerConfig,
    tunnelProvisioned: handoff.tunnelProvisioned,
    justLinked: true,
  };
}

/** A tunnel PolySIEM stood up as part of the link, as a toast description. */
function tunnelToastOptions(tunnel: ConnectorTunnelProvisionedDto | null): { description: string } | undefined {
  return tunnel ? { description: connectorTunnelProvisionedCopy(tunnel).toast } : undefined;
}

/**
 * What the toast says when no peer sheet follows the link.
 *
 * A manual kind still has a block to paste — a caller that cannot open a sheet
 * (the NAT rule form owns its screen) says where that block lives instead of
 * leaving the operator to hunt for it.
 */
function linkedToastMessage(setup: ManualSetup | null, target: LinkConnectorTarget): string {
  if (!setup) return "Connector linked. Apply that edge to register its peer.";
  return `Linked to ${target.server.name}. Its peer settings are on that edge's row under Linked edges.`;
}

/**
 * POST /api/network/connectors/[id]/links — allocates the address on that edge.
 *
 * Linking an edge that has no WireGuard tunnel now provisions one instead of
 * refusing, so the response can report a tunnel that did not exist a moment ago;
 * that fact rides the toast and, for a manual kind, the sheet it opens.
 */
export function useLinkConnectorMutation({
  onDone,
  onPeerSetup,
}: {
  onDone: () => void;
  /** Where a manual connector's new peer block goes. Omitted keeps toast-and-close. */
  onPeerSetup?: (setup: ManualSetup) => void;
}) {
  const invalidate = useConnectorInvalidator();
  return useMutation({
    mutationFn: ({ connector, server }: LinkConnectorTarget) =>
      apiFetch<LinkConnectorResult>(connectorLinksUrl(connector.id), {
        method: "POST",
        body: JSON.stringify({ integrationId: server.id } satisfies LinkConnectorInput),
      }),
    onSuccess: (result, target) => {
      const options = tunnelToastOptions(connectorTunnelProvisioned(result));
      const setup = linkedManualSetup(result, target);
      invalidate();
      if (setup && onPeerSetup) {
        toast.success(`Linked to ${target.server.name}. Here are its peer settings.`, options);
        onPeerSetup(setup);
        return;
      }
      toast.success(linkedToastMessage(setup, target), options);
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/** Enabled/disabled state of one link, without giving up its address. */
function useLinkEnabledMutation(connectorId: string) {
  const invalidate = useConnectorInvalidator();
  return useMutation({
    mutationFn: ({ linkId, enabled }: { linkId: string; enabled: boolean }) =>
      apiFetch(connectorLinkUrl(connectorId, linkId), {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      }),
    onSuccess: (_result, variables) => {
      toast.success(variables.enabled ? "Link resumed." : "Link paused — apply the edge to drop its peer.");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });
}

/**
 * DELETE the link. The server refuses with 409 while enabled connector-mode
 * rules on that edge still target this connector, and names them — so the
 * reason is surfaced verbatim instead of a generic failure.
 */
function useUnlinkMutation(connectorId: string, onDone: () => void, onRefused: (reason: string) => void) {
  const invalidate = useConnectorInvalidator();
  return useMutation({
    mutationFn: (linkId: string) => apiFetch(connectorLinkUrl(connectorId, linkId), { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Connector unlinked. Apply that edge to drop its peer.");
      invalidate();
      onDone();
    },
    onError: (error: Error) => {
      onRefused(error.message);
      toast.error(error.message);
    },
  });
}

/** "2 edges", "1 edge", "not linked" — compact enough for a row's trailing slot. */
export function linkCountLabel(connector: ConnectorDto): string {
  const { total } = connectorLinkSummary(connector);
  if (total === 0) return "not linked";
  return total === 1 ? "1 edge" : `${total} edges`;
}

function handshakeLabel(link: ConnectorLinkDto): string {
  return link.lastHandshakeAt ? formatRelative(link.lastHandshakeAt) : "No handshake";
}

/** Read-only "which edges does this serve, and at what address" rows. */
export function ConnectorLinkKeyRows({
  connector,
  edges,
}: {
  connector: ConnectorDto;
  edges: readonly EdgeNatServer[];
}) {
  const links = connectorLinks(connector);
  if (links.length === 0) {
    return <MobileKeyRow label="Edges">Not linked to an edge box yet</MobileKeyRow>;
  }
  return (
    <>
      {links.map((link) => (
        <MobileKeyRow key={link.id} label={connectorLinkEdgeName(link, edges)} mono>
          {link.tunnelAddress}
          {isConnectorLinkEnabled(link) ? "" : " · paused"}
        </MobileKeyRow>
      ))}
    </>
  );
}

/**
 * One linked edge box.
 *
 * A manual connector's row carries its OWN peer-settings action, because the
 * paste-ready block is per edge: endpoint, edge key, AllowedIPs and the address
 * are all that edge's. One action for the whole connector cannot say which
 * edge's values it would hand over once two are linked, which is exactly how an
 * operator ends up pasting the wrong edge's peer into OPNsense. The wording is
 * `connectorPeerSettingsAction`, so the row and the desktop table say the same.
 */
function ConnectorLinkRow({
  connector,
  link,
  edges,
  onSelect,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
  edges: readonly EdgeNatServer[];
  onSelect: () => void;
  onPeerSetup: (() => void) | null;
}) {
  const edgeName = connectorLinkEdgeName(link, edges);
  const action = connectorPeerSettingsAction({ connectorName: connector.name, edgeName });
  const row = (
    <MobileListRow
      className={onPeerSetup ? "min-w-0 flex-1" : undefined}
      onClick={onSelect}
      leading={<Server className="size-4" />}
      title={
        <>
          <span className="truncate">{edgeName}</span>
          {!isConnectorLinkEnabled(link) && (
            <Badge variant="outline" className="text-[10px] font-normal">
              paused
            </Badge>
          )}
        </>
      }
      subtitle={
        <>
          <span className="font-mono">{link.tunnelAddress}</span>
          {onPeerSetup && <span> · {handshakeLabel(link)}</span>}
        </>
      }
      // The handshake moves into the subtitle when the action takes the trailing
      // slot, so nothing is dropped to make room for it.
      trailing={onPeerSetup ? undefined : <span className="max-w-24 truncate">{handshakeLabel(link)}</span>}
    />
  );
  if (!onPeerSetup) return row;
  return (
    <div className="flex items-stretch">
      {row}
      <button
        type="button"
        onClick={onPeerSetup}
        aria-label={action.ariaLabel}
        title={action.title}
        className="flex min-h-13 shrink-0 flex-col items-center justify-center gap-0.5 border-l px-3 text-[10px] leading-none font-medium text-muted-foreground transition-colors active:bg-muted/70"
      >
        <Waypoints className="size-4" aria-hidden="true" />
        {action.label}
      </button>
    </div>
  );
}

/** The same links, tappable: one row per edge this connector serves. */
export function ConnectorLinkList({
  connector,
  edges,
  onSelect,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  edges: readonly EdgeNatServer[];
  onSelect: (link: ConnectorLinkDto) => void;
  /** Manual kinds only: opens THAT edge's paste-ready block. Null hides the action. */
  onPeerSetup?: ((link: ConnectorLinkDto) => void) | null;
}) {
  const links = connectorLinks(connector);
  if (links.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-4 py-4 text-center text-xs text-muted-foreground">
        This connector serves no edge box yet. Link it to one and PolySIEM allocates its tunnel address there.
      </p>
    );
  }
  return (
    <MobileList>
      {links.map((link) => (
        <ConnectorLinkRow
          key={link.id}
          connector={connector}
          link={link}
          edges={edges}
          onSelect={() => onSelect(link)}
          // No edge row loaded means no block to show, so the action is not
          // offered rather than offered and inert.
          onPeerSetup={onPeerSetup && edgeServerForLink(edges, link) ? () => onPeerSetup(link) : null}
        />
      ))}
    </MobileList>
  );
}

/** Why unlinking was refused, shown next to the button that tried it. */
function UnlinkRefusal({ reason }: { reason: string }) {
  return (
    <p className="flex items-start gap-1.5 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span className="min-w-0">
        <span className="block font-medium">Still in use on this edge</span>
        <span className="mt-0.5 block leading-snug">{reason}</span>
      </span>
    </p>
  );
}

/** Pause/resume plus unlink — everything an admin does to one link. */
function ConnectorLinkActions({
  connector,
  link,
  edgeName,
  onUnlinked,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
  edgeName: string;
  onUnlinked: () => void;
  onPeerSetup: (() => void) | null;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);
  const enabledMutation = useLinkEnabledMutation(connector.id);
  const unlinkMutation = useUnlinkMutation(connector.id, onUnlinked, setRefusal);
  return (
    <>
      {/* Named, never "this edge": the same button exists on every link, and a
          block pasted into the wrong far-side peer is the bug being fixed. */}
      {onPeerSetup && (
        <Button variant="outline" className="w-full" onClick={onPeerSetup}>
          <Waypoints /> Peer settings for {edgeName}
        </Button>
      )}
      <div className="flex items-center justify-between gap-4 rounded-xl border p-3">
        <div>
          <Label htmlFor={`m-cx-link-${link.id}`}>Link active</Label>
          <p className="text-xs text-muted-foreground">
            Pausing keeps the address reserved but drops the peer on the next apply.
          </p>
        </div>
        <Switch
          id={`m-cx-link-${link.id}`}
          checked={isConnectorLinkEnabled(link)}
          disabled={enabledMutation.isPending}
          onCheckedChange={(next) => enabledMutation.mutate({ linkId: link.id, enabled: next })}
        />
      </div>
      {refusal && <UnlinkRefusal reason={refusal} />}
      <Button
        variant="destructive"
        className="w-full"
        disabled={unlinkMutation.isPending}
        onClick={() => {
          setRefusal(null);
          unlinkMutation.mutate(link.id);
        }}
      >
        {unlinkMutation.isPending ? <Loader2 className="animate-spin" /> : <Link2Off />} Unlink from this edge
      </Button>
      <p className="px-0.5 text-[11px] text-muted-foreground">
        Unlinking frees the address on this edge only. The connector stays installed and keeps serving every other
        edge it is linked to.
      </p>
    </>
  );
}

/**
 * One link: what this connector is on ONE edge. The tunnel address belongs to
 * the link, so this is also where a manual connector's paste-ready peer block
 * for that edge is reached from.
 */
export function ConnectorLinkSheet({
  connector,
  link,
  edges,
  isAdmin,
  onOpenChange,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  link: ConnectorLinkDto;
  edges: readonly EdgeNatServer[];
  isAdmin: boolean;
  onOpenChange: (open: boolean) => void;
  onPeerSetup: (server: EdgeNatServer, link: ConnectorLinkDto) => void;
}) {
  const server = edgeServerForLink(edges, link);
  const edgeName = connectorLinkEdgeName(link, edges);
  const manualPeerSetup = isManualConnector(connector) && server ? () => onPeerSetup(server, link) : null;

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`${connector.name} on ${edgeName}`}
      description="One connector serves several edge boxes; this is what it is on this one."
    >
      <div className="flex flex-col gap-3 pb-2">
        <MobileList>
          <MobileKeyRow label="Edge box">{edgeName}</MobileKeyRow>
          <MobileKeyRow label="Tunnel address here" mono>
            {link.tunnelAddress}
          </MobileKeyRow>
          <MobileKeyRow label="Link state">{isConnectorLinkEnabled(link) ? "Active" : "Paused"}</MobileKeyRow>
          <MobileKeyRow label="Last handshake">{handshakeLabel(link)}</MobileKeyRow>
        </MobileList>
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Each edge allocates the connector its own address from that edge&apos;s tunnel subnet. The connector holds
          all of them on one WireGuard interface, with one peer per linked edge.
        </p>

        {isAdmin && (
          <ConnectorLinkActions
            connector={connector}
            link={link}
            edgeName={edgeName}
            onUnlinked={() => onOpenChange(false)}
            onPeerSetup={manualPeerSetup}
          />
        )}
      </div>
    </BottomSheet>
  );
}

/**
 * Row-sized form of the shared setup notice. The picker lists several edges, so
 * the full sentence goes in the footnote once and each row that DIFFERS carries
 * the short form; the gate is `edgeTunnelSetupNotice`, so a row can never
 * disagree with the sentence the create dialog shows for the same edge.
 */
function edgeTunnelPendingShort(edge: EdgeNatServer): string | null {
  if (!edgeTunnelSetupNotice(edge)) return null;
  return edge.settings?.wireguard ? "tunnel switched on at link" : "tunnel set up on link";
}

const TUNNEL_PENDING_FOOTNOTE =
  "An edge box marked that way has no usable WireGuard tunnel yet — PolySIEM stands one up as part of the link, "
  + "generating its keypair and picking a free tunnel subnet, and that edge then needs an apply.";

/**
 * Base URL, plus what linking will do to an edge that has no tunnel yet. Only
 * the rows that DIFFER carry the note — an edge already serving a tunnel says
 * nothing extra.
 */
function EdgePickerSubtitle({ edge }: { edge: EdgeNatServer }) {
  const pending = edgeTunnelPendingShort(edge);
  return (
    <>
      <span className="font-mono">{edge.baseUrl}</span>
      {pending && <span> · {pending}</span>}
    </>
  );
}

/** Pick an edge for this connector — the connector-side half of linking. */
export function ConnectorEdgePickerSheet({
  connector,
  edges,
  onOpenChange,
  onPeerSetup,
}: {
  connector: ConnectorDto;
  edges: readonly EdgeNatServer[];
  onOpenChange: (open: boolean) => void;
  /** A manual connector lands on the new edge's peer block instead of closing. */
  onPeerSetup?: (setup: ManualSetup) => void;
}) {
  const mutation = useLinkConnectorMutation({ onDone: () => onOpenChange(false), onPeerSetup });
  const available = edgesAvailableForConnector(connector, edges);

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Link ${connector.name} to an edge`}
      description="The same connector can serve several edge boxes at once."
    >
      <div className="flex flex-col gap-3 pb-2">
        {available.length === 0 ? (
          <MobileEmpty
            icon={<Server />}
            title="No other edge box"
            description="This connector already serves every edge box PolySIEM knows about."
          />
        ) : (
          <MobileList>
            {available.map((edge) => (
              <MobileListRow
                key={edge.id}
                onClick={() => mutation.mutate({ connector, server: edge })}
                leading={<Server className="size-4" />}
                title={<span className="truncate">{edge.name}</span>}
                subtitle={<EdgePickerSubtitle edge={edge} />}
                trailing={
                  mutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />
                }
              />
            ))}
          </MobileList>
        )}
        <p className="px-0.5 text-[11px] text-muted-foreground">
          Linking allocates this connector an address from that edge&apos;s tunnel subnet and marks the edge for apply.
          Nothing is installed again — one install serves every edge.
        </p>
        {available.some((edge) => edgeTunnelPendingShort(edge) !== null) && (
          <p className="px-0.5 text-[11px] text-muted-foreground">{TUNNEL_PENDING_FOOTNOTE}</p>
        )}
      </div>
    </BottomSheet>
  );
}

/** Pick an existing connector for this edge — the edge-side half of linking. */
export function EdgeConnectorPickerSheet({
  server,
  connectors,
  isLoading,
  onOpenChange,
  onPeerSetup,
}: {
  server: EdgeNatServer;
  connectors: readonly ConnectorDto[];
  isLoading: boolean;
  onOpenChange: (open: boolean) => void;
  /** A manual connector lands on THIS edge's peer block instead of closing. */
  onPeerSetup?: (setup: ManualSetup) => void;
}) {
  const mutation = useLinkConnectorMutation({ onDone: () => onOpenChange(false), onPeerSetup });
  const available = connectorsAvailableToLink(connectors, server.id);

  return (
    <BottomSheet
      open
      onOpenChange={onOpenChange}
      title={`Link a connector to ${server.name}`}
      description="Reuse a connector that is already installed somewhere in your lab."
    >
      <div className="flex flex-col gap-3 pb-2">
        {available.length === 0 ? (
          <MobileEmpty
            icon={<Cable />}
            title={isLoading ? "Loading connectors…" : "Nothing to link"}
            description={
              isLoading
                ? undefined
                : "Every connector you have already serves this edge. Add a connector to install a new one."
            }
          />
        ) : (
          <MobileList>
            {available.map((connector) => (
              <MobileListRow
                key={connector.id}
                onClick={() => mutation.mutate({ connector, server })}
                leading={<Cable className="size-4" />}
                title={<span className="truncate">{connector.name}</span>}
                subtitle={
                  <span className="font-mono">
                    {connector.connectorId} · {connectorKindLabel(connector)}
                  </span>
                }
                trailing={<span className="max-w-20 truncate">{linkCountLabel(connector)}</span>}
              />
            ))}
          </MobileList>
        )}
        <EdgeTunnelSetupNote server={server} />
        <p className="px-0.5 text-[11px] text-muted-foreground">
          A connector is installed once and can serve several edge boxes. Linking gives it an address on this edge, so
          this edge&apos;s routes can travel through it.
        </p>
      </div>
    </BottomSheet>
  );
}
