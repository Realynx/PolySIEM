"use client";

import { Waypoints } from "lucide-react";
import {
  connectorTunnelProvisionedCopy,
  edgeTunnelSetupNotice,
  type ConnectorTunnelProvisionedDto,
  type EdgeNatServer,
} from "./edge-networks-types";

/**
 * Said BEFORE the operator commits: this edge has no WireGuard tunnel yet, and
 * PolySIEM will stand one up as part of the link.
 *
 * Deliberately quiet — nothing is wrong and nothing is being asked of the
 * operator, so it reads as a footnote under the picker rather than a warning.
 * Renders nothing at all when the edge's tunnel is already up.
 */
export function EdgeTunnelSetupNote({
  server,
  servers = [],
}: {
  server: EdgeNatServer | null | undefined;
  /** Every edge box, so the note never promises a subnet another edge occupies. */
  servers?: readonly EdgeNatServer[];
}) {
  const notice = edgeTunnelSetupNotice(server, servers);
  if (!notice) return null;
  return <p className="text-xs text-muted-foreground">{notice}</p>;
}

/**
 * Said AFTER the fact: PolySIEM created (or enabled) the edge's tunnel during
 * the link, and it needs an Apply to reach the host.
 *
 * Informational, not a warning — amber is reserved for genuine risk.
 */
export function ConnectorTunnelProvisionedNote({
  tunnel,
}: {
  tunnel: ConnectorTunnelProvisionedDto | null | undefined;
}) {
  if (!tunnel) return null;
  const copy = connectorTunnelProvisionedCopy(tunnel);
  return (
    <div className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/5 p-3">
      <Waypoints className="mt-0.5 size-4 shrink-0 text-info" aria-hidden="true" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-info">{copy.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{copy.detail}</p>
      </div>
    </div>
  );
}
