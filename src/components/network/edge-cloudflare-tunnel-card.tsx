"use client";

import { useState } from "react";
import { Cloud, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ssh/copy-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  cloudflarePathLabel,
  cloudflareRouteScrollNote,
  cloudflareRoutesScroll,
  cloudflareServiceLabel,
  cloudflareShortId,
  type CloudflareRouteRow,
  type CloudflareTunnelCardModel,
  type CloudflareTunnelStatus,
  type CloudflareTunnelTone,
} from "./cloudflare-presentation";
import { EdgeCardCollapseTrigger } from "./edge-card-collapse";

/**
 * One Cloudflare tunnel, built the way an SSH edge box is built: an always-visible
 * identity head — name, state, tunnel id, where its ingress is configured — over a
 * collapsible body holding the routes it publishes.
 *
 * The routes table is the Cloudflare answer to the edge Routes table and is read
 * the same way, left to right: `Hostname → Path → Service`.
 */
export function CloudflareTunnelCard({
  card,
  isAdmin,
  showZone,
  defaultExpanded,
  onAddRoute,
  onRemoveRoute,
}: {
  card: CloudflareTunnelCardModel;
  isAdmin: boolean;
  /** Only true when the account has more than one zone to tell rows apart with. */
  showZone: boolean;
  defaultExpanded: boolean;
  onAddRoute: () => void;
  onRemoveRoute: (route: CloudflareRouteRow) => void;
}) {
  // Per card, for as long as the card is mounted. The initial value follows how
  // many tunnels the page is showing, so one tunnel opens and twelve do not.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const canEdit = isAdmin && card.config.editable;
  return (
    <Card>
      <Collapsible open={expanded} onOpenChange={setExpanded} className="flex flex-col gap-(--card-spacing)">
        <CardHeader className="gap-3 border-b pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <CloudflareTunnelIdentity card={card} />
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {isAdmin && card.canAddRoute && (
                <Button variant="outline" size="sm" onClick={onAddRoute}>
                  <Plus /> Add route
                </Button>
              )}
              <EdgeCardCollapseTrigger expanded={expanded} count={card.routeCount} name={card.name} />
            </div>
          </div>
          {/* Ordinary configuration, said once and styled as information. */}
          {card.config.note && <p className="text-xs text-muted-foreground">{card.config.note}</p>}
        </CardHeader>

        <CollapsibleContent>
          <CardContent>
            {card.routeCount === 0 ? (
              <CloudflareRoutesEmpty canAdd={isAdmin && card.canAddRoute} onAddRoute={onAddRoute} />
            ) : (
              <CloudflareRoutesTable
                card={card}
                showZone={showZone}
                canEdit={canEdit}
                onRemoveRoute={onRemoveRoute}
              />
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

/** Who this tunnel is: name, state, id, and where its ingress is configured. */
function CloudflareTunnelIdentity({ card }: { card: CloudflareTunnelCardModel }) {
  const shortId = cloudflareShortId(card.tunnelId);
  return (
    <div className="flex min-w-0 items-start gap-3">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
        <Cloud className="size-5" />
      </div>
      <div className="min-w-0">
        <CardTitle className="flex flex-wrap items-center gap-2">
          {card.name}
          <TunnelStatusBadge status={card.status} />
        </CardTitle>
        <CardDescription className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          <span className="font-mono">{shortId ?? "no tunnel id reported"}</span>
          {/* The id is shortened to keep the line scannable, so copying it has to
              stay possible — the middle of a UUID cannot be selected by hand. */}
          {card.tunnelId && <CopyButton value={card.tunnelId} label={`Copy the ${card.name} tunnel id`} className="size-6" />}
          <span className="text-muted-foreground/50" aria-hidden="true">·</span>
          <span>{card.config.label}</span>
        </CardDescription>
      </div>
    </div>
  );
}

const TUNNEL_BADGE_VARIANT: Record<CloudflareTunnelTone, "secondary" | "destructive" | "outline"> = {
  up: "secondary",
  down: "destructive",
  unknown: "outline",
};

function TunnelStatusBadge({ status }: { status: CloudflareTunnelStatus }) {
  return (
    <Badge variant={TUNNEL_BADGE_VARIANT[status.tone]} className="font-normal">
      {status.tone === "up" && <span className="size-1.5 rounded-full bg-success" />}
      {status.label}
    </Badge>
  );
}

/**
 * The height cap, applied twice on purpose. The table's own container is what a
 * sticky header sticks to, so it has to be the scroller; the wrapper carries the
 * same cap as the guarantee that the page cannot grow past it whatever the table
 * renders into.
 */
const SCROLLING_ROUTES = "max-h-[22rem] overflow-y-auto [&>[data-slot=table-container]]:max-h-[22rem] [&>[data-slot=table-container]]:overflow-y-auto";

/**
 * The routes table. Once a tunnel publishes more hostnames than fit, the list
 * scrolls inside the card instead of stretching the page, and says so — nothing
 * is dropped, and the count is on the collapse control either way.
 */
function CloudflareRoutesTable({
  card,
  showZone,
  canEdit,
  onRemoveRoute,
}: {
  card: CloudflareTunnelCardModel;
  showZone: boolean;
  canEdit: boolean;
  onRemoveRoute: (route: CloudflareRouteRow) => void;
}) {
  const scrolls = cloudflareRoutesScroll(card.routeCount);
  const scrollNote = cloudflareRouteScrollNote(card.routeCount);
  return (
    <div className="space-y-2">
      <div className={cn("rounded-lg border", scrolls ? SCROLLING_ROUTES : "overflow-hidden")}>
        <Table>
          <TableHeader className="sticky top-0 z-10 bg-card">
            <TableRow>
              <TableHead className="w-[18rem]">Hostname</TableHead>
              <TableHead className="w-[11rem]">Path</TableHead>
              <TableHead>Service</TableHead>
              {canEdit && <TableHead className="w-16"><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {card.routes.map((route) => (
              <CloudflareRouteTableRow
                key={route.key}
                route={route}
                showZone={showZone}
                canEdit={canEdit}
                onRemove={() => onRemoveRoute(route)}
              />
            ))}
          </TableBody>
        </Table>
      </div>
      {scrollNote && <p className="text-xs text-muted-foreground">{scrollNote}</p>}
      {card.catchAllService && (
        <p className="text-xs text-muted-foreground">
          Anything else on this tunnel falls through to <span className="font-mono">{card.catchAllService}</span>.
        </p>
      )}
    </div>
  );
}

/**
 * One published route. The hostname is the key of the row and leads it; no
 * per-row status column repeats what the card head already reports.
 */
function CloudflareRouteTableRow({
  route,
  showZone,
  canEdit,
  onRemove,
}: {
  route: CloudflareRouteRow;
  showZone: boolean;
  canEdit: boolean;
  onRemove: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <div className="font-medium">{route.hostname}</div>
        {showZone && route.zoneName && (
          <div className="mt-0.5 text-xs text-muted-foreground">zone {route.zoneName}</div>
        )}
      </TableCell>
      <TableCell className="align-top">
        <span className={cn("text-xs", route.path ? "font-mono" : "text-muted-foreground")}>
          {cloudflarePathLabel(route.path)}
        </span>
      </TableCell>
      <TableCell className="align-top font-mono text-xs">{cloudflareServiceLabel(route.service)}</TableCell>
      {canEdit && (
        <TableCell className="align-top">
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-destructive hover:text-destructive"
              disabled={!route.removable}
              title={route.removable ? undefined : "PolySIEM needs this tunnel's id and a matching zone to remove the route"}
              aria-label={`Remove ${route.hostname}`}
              onClick={onRemove}
            >
              <Trash2 />
            </Button>
          </div>
        </TableCell>
      )}
    </TableRow>
  );
}

function CloudflareRoutesEmpty({ canAdd, onAddRoute }: { canAdd: boolean; onAddRoute: () => void }) {
  return (
    <div className="rounded-lg border border-dashed p-6 text-center">
      <p className="font-medium">No hostnames published</p>
      <p className="mt-1 text-sm text-muted-foreground">
        This tunnel is connected, but no ingress rule sends a hostname through it yet.
      </p>
      {canAdd && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onAddRoute}>
          <Plus /> Add first route
        </Button>
      )}
    </div>
  );
}
