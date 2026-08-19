"use client";

import { Link2, Server, Unlink, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/format";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  connectorLinkEdgeName,
  connectorLinks,
  isConnectorLinkEnabled,
  type ConnectorDto,
  type ConnectorLinkDto,
  type EdgeNatServer,
} from "./edge-networks-types";

/**
 * The edge boxes one connector serves, each with the tunnel address it holds
 * THERE. This is the view that makes the model legible: one installed connector,
 * several edges, a different address on each.
 */
export function ConnectorEdgeLinks({
  connector,
  servers,
  isAdmin,
  onLink,
  onUnlink,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  isAdmin: boolean;
  onLink: () => void;
  onUnlink: (link: ConnectorLinkDto) => void;
}) {
  const links = connectorLinks(connector);
  const canLinkMore = servers.length > links.length;
  return (
    <div className="mt-3 rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/20 px-3 py-2">
        <p className="flex items-center gap-1.5 text-xs font-medium">
          <Server className="size-3.5 text-muted-foreground" aria-hidden="true" />
          Edge boxes it serves
          <Badge variant="secondary" className="font-normal tabular-nums">{links.length}</Badge>
        </p>
        {isAdmin && canLinkMore && (
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onLink}>
            <Link2 /> Link to an edge box
          </Button>
        )}
      </div>
      {links.length === 0 ? (
        <p className="px-3 py-2.5 text-xs text-muted-foreground">
          Not serving any edge box yet. Link it to one and PolySIEM allocates its tunnel address there — the same
          connector can serve as many as you need.
        </p>
      ) : (
        <ul className="divide-y">
          {links.map((link) => (
            <ConnectorLinkRow
              key={link.id}
              link={link}
              edgeName={connectorLinkEdgeName(link, servers)}
              connectorName={connector.name}
              isAdmin={isAdmin}
              onUnlink={() => onUnlink(link)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ConnectorLinkRow({
  link,
  edgeName,
  connectorName,
  isAdmin,
  onUnlink,
}: {
  link: ConnectorLinkDto;
  edgeName: string;
  connectorName: string;
  isAdmin: boolean;
  onUnlink: () => void;
}) {
  const live = isConnectorLinkEnabled(link);
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2", !live && "bg-muted/20")}>
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{edgeName}</span>
      <span className="flex min-w-0 items-center gap-1">
        <Waypoints className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        <code className="truncate font-mono text-xs">{link.tunnelAddress}</code>
        <CopyButton value={link.tunnelAddress} label={`Copy the tunnel address of ${connectorName} on ${edgeName}`} />
      </span>
      <span className="text-xs text-muted-foreground">
        {link.lastHandshakeAt ? formatRelative(link.lastHandshakeAt) : "No handshake yet"}
      </span>
      {!live && <Badge variant="outline" className="font-normal">Suspended</Badge>}
      {isAdmin && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Unlink ${connectorName} from ${edgeName}`}
          title={`Stop ${connectorName} serving ${edgeName}`}
          onClick={onUnlink}
        >
          <Unlink />
        </Button>
      )}
    </li>
  );
}

/**
 * One line for an edge card's connector row: the address this connector holds
 * HERE, and which other edge boxes it also serves. Seeing "also serves …" is
 * what tells an operator they never need a second install.
 */
export function ConnectorOtherEdges({
  connector,
  servers,
  integrationId,
}: {
  connector: ConnectorDto;
  servers: EdgeNatServer[];
  /** The edge box whose card this row is on; it is excluded from the list. */
  integrationId: string;
}) {
  const others = connectorLinks(connector).filter((link) => link.integrationId !== integrationId);
  if (others.length === 0) return null;
  return (
    <p className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <Server className="size-3.5 shrink-0" aria-hidden="true" />
      Also serves
      {others.map((link) => (
        <Badge key={link.id} variant="outline" className="font-normal">
          {connectorLinkEdgeName(link, servers)}
          <code className="ml-1 font-mono text-[0.6875rem]">{link.tunnelAddress}</code>
        </Badge>
      ))}
    </p>
  );
}
