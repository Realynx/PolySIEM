"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
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
} from "@/components/network/cloudflare-presentation";
import { MobileCopyRow } from "./mobile-connector-atoms";
import { MobileCollapseBody, MobileCollapseCard, MobileCollapseHead } from "./mobile-edge-collapse";

/**
 * One Cloudflare tunnel on a phone, built exactly like the edge server card
 * above it: an identity row that never hides — name, state, tunnel id, where its
 * ingress is configured — over a collapsible body holding the hostnames it
 * publishes.
 *
 * Every word and every threshold comes from `network/cloudflare-presentation`,
 * so a tunnel that reads "Config file on the connector" here reads the same on
 * desktop and the two can never drift.
 */
export function MobileCloudflareTunnelCard({
  card,
  isAdmin,
  showZone,
  defaultExpanded,
  onAddRoute,
  onSelectRoute,
}: {
  card: CloudflareTunnelCardModel;
  isAdmin: boolean;
  /** Only true when the account has more than one zone to tell rows apart with. */
  showZone: boolean;
  defaultExpanded: boolean;
  onAddRoute: () => void;
  onSelectRoute: (route: CloudflareRouteRow) => void;
}) {
  // Per card, for as long as the card is mounted, seeded from how many tunnels
  // this screen is showing — one opens, a dozen do not.
  const [expanded, setExpanded] = useState(defaultExpanded);
  const canAdd = isAdmin && card.canAddRoute;
  return (
    <MobileCollapseCard open={expanded} onOpenChange={setExpanded}>
      <MobileList>
        <MobileCollapseHead
          expanded={expanded}
          name={card.name}
          badge={<TunnelStatusBadge status={card.status} />}
          subtitle={<TunnelSubtitle card={card} />}
          count={card.routeCount}
        />
      </MobileList>

      <MobileCollapseBody>
        {/* The head shortens the id to keep the line scannable, so copying it has
            to stay possible — the middle of a UUID cannot be selected by hand. */}
        {card.tunnelId && <MobileCopyRow label="Tunnel ID" value={card.tunnelId} />}
        {/* Ordinary configuration, said once and styled as information. */}
        {card.config.note && (
          <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{card.config.note}</p>
        )}
        {card.routeCount === 0 ? (
          <TunnelRoutesEmpty canAdd={canAdd} onAddRoute={onAddRoute} />
        ) : (
          <TunnelRoutes card={card} showZone={showZone} onSelectRoute={onSelectRoute} />
        )}
        {canAdd && card.routeCount > 0 && (
          <Button variant="outline" className="w-full" onClick={onAddRoute}>
            <Plus /> Add route to {card.name}
          </Button>
        )}
      </MobileCollapseBody>
    </MobileCollapseCard>
  );
}

/** The tunnel id, shortened to fit, and where its ingress lives. */
function TunnelSubtitle({ card }: { card: CloudflareTunnelCardModel }) {
  const shortId = cloudflareShortId(card.tunnelId);
  return (
    <>
      <span className="font-mono">{shortId ?? "no tunnel id"}</span>
      <span className="mx-1 text-muted-foreground/50" aria-hidden="true">
        ·
      </span>
      {card.config.label}
    </>
  );
}

const TUNNEL_BADGE_VARIANT: Record<CloudflareTunnelTone, "secondary" | "destructive" | "outline"> = {
  up: "secondary",
  down: "destructive",
  unknown: "outline",
};

function TunnelStatusBadge({ status }: { status: CloudflareTunnelStatus }) {
  return (
    <Badge variant={TUNNEL_BADGE_VARIANT[status.tone]} className="text-[10px] font-normal">
      {status.tone === "up" && <span className="size-1.5 rounded-full bg-success" />}
      {status.label}
    </Badge>
  );
}

/**
 * Roughly the eight rows `CLOUDFLARE_ROUTE_SCROLL_THRESHOLD` promises, at the
 * ~56px a two-line phone row occupies. `overscroll-contain` keeps a flick inside
 * the list instead of handing the page a scroll it did not ask for.
 *
 * The cap sits on a wrapper rather than on the list itself: `MobileList` clips
 * its own corners with `overflow-hidden`, and a list that both clips and scrolls
 * is one CSS ordering accident away from hiding routes for good. The wrapper
 * scrolls and carries the frame; the list inside it drops its own.
 */
const SCROLLING_ROUTES = "max-h-[28rem] overflow-y-auto overscroll-contain rounded-xl border";

/**
 * The published hostnames, read the way the edge Routes list is read: the
 * hostname is the key of the row and leads it, with `path → service` beneath.
 * Past the shared threshold the list scrolls inside its own container rather
 * than stretching the page, and says how many rows it holds so a tunnel with 200
 * hostnames hides none of them silently.
 */
function TunnelRoutes({
  card,
  showZone,
  onSelectRoute,
}: {
  card: CloudflareTunnelCardModel;
  showZone: boolean;
  onSelectRoute: (route: CloudflareRouteRow) => void;
}) {
  const scrolls = cloudflareRoutesScroll(card.routeCount);
  const scrollNote = cloudflareRouteScrollNote(card.routeCount);
  return (
    <>
      <div className={cn(scrolls && SCROLLING_ROUTES)}>
        <MobileList className={cn(scrolls && "rounded-none border-0")}>
          {card.routes.map((route) => (
            <MobileListRow
              key={route.key}
              onClick={() => onSelectRoute(route)}
              title={<span className="truncate">{route.hostname}</span>}
              subtitle={
                <span className="font-mono">
                  {cloudflarePathLabel(route.path)} → {cloudflareServiceLabel(route.service)}
                </span>
              }
              trailing={showZone && route.zoneName ? <span className="max-w-24 truncate">{route.zoneName}</span> : null}
            />
          ))}
        </MobileList>
      </div>
      {scrollNote && <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{scrollNote}</p>}
      {card.catchAllService && (
        <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">
          Anything else on this tunnel falls through to <span className="font-mono">{card.catchAllService}</span>.
        </p>
      )}
    </>
  );
}

function TunnelRoutesEmpty({ canAdd, onAddRoute }: { canAdd: boolean; onAddRoute: () => void }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center">
      <p className="text-sm font-medium">No hostnames published</p>
      <p className="max-w-64 text-xs text-muted-foreground">
        This tunnel is connected, but no ingress rule sends a hostname through it yet.
      </p>
      {canAdd && (
        <Button variant="outline" size="sm" onClick={onAddRoute}>
          <Plus /> Add first route
        </Button>
      )}
    </div>
  );
}
