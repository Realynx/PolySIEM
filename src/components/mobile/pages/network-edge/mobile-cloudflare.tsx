"use client";

import { useState } from "react";
import { Cloud, LockKeyhole } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { MobileSection } from "@/components/mobile/ui/mobile-page";
import {
  cloudflareIntegrationSummary,
  cloudflareTunnelCards,
  cloudflareTunnelCountLabel,
  cloudflareZoneWorthShowing,
  edgeCardsStartExpanded,
  type CloudflareIntegrationSummary,
  type CloudflareRouteRow,
} from "@/components/network/cloudflare-presentation";
import type { OtherEdgeNetwork } from "@/components/network/edge-networks-types";
import {
  MobileCloudflareAddRouteSheet,
  MobileCloudflareRemoveDialog,
  MobileCloudflareRouteSheet,
  MobileCloudflareTokenSheet,
} from "./mobile-cloudflare-sheets";
import { MobileCloudflareTunnelCard } from "./mobile-cloudflare-tunnel";
import { MobileSummaryLine } from "./mobile-edge-tabs";

/**
 * The Cloudflare tab on a phone.
 *
 * It is the SSH edge tab with different nouns, exactly as on desktop: a tunnel
 * is the card that publishes things — the Cloudflare "connector" — and its
 * ingress entries are the routes beneath it. Both tabs collapse the same way and
 * from the same threshold, so the phone reads as one feature rather than two
 * similar screens.
 *
 * Nothing here derives a Cloudflare fact. Counts, tunnel state, config source,
 * route rows, the collapse default and the scroll threshold all come from
 * `network/cloudflare-presentation`; this file owns only the phone treatment and
 * which sheet a tap opens.
 */

/** The one selection at a time this tab can be in. */
type CloudflareSheet =
  | { kind: "add"; integration: OtherEdgeNetwork; tunnelId: string | null }
  | { kind: "upgrade"; integration: OtherEdgeNetwork }
  | null;

export function MobileCloudflarePanel({
  networks,
  isAdmin,
}: {
  networks: OtherEdgeNetwork[];
  isAdmin: boolean;
}) {
  // One sheet host for the whole tab: every tunnel card raises its route here,
  // so a route opened from one card behaves like a route opened from any other.
  const [route, setRoute] = useState<CloudflareRouteRow | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<CloudflareRouteRow | null>(null);
  const [sheet, setSheet] = useState<CloudflareSheet>(null);
  // One decision for the whole tab, the same one desktop makes: a screen showing
  // a handful of tunnels opens them, a screen showing a dozen does not.
  const tunnelCount = networks.reduce((total, network) => total + cloudflareTunnelCards(network).length, 0);
  const startExpanded = edgeCardsStartExpanded(tunnelCount);

  if (networks.length === 0) {
    return (
      <EmptyState
        icon={Cloud}
        title="No Cloudflare integration"
        description="Connect a Cloudflare account to document and manage published tunnel routes."
      />
    );
  }

  return (
    <>
      {networks.map((network) => (
        <MobileCloudflareIntegration
          key={network.id}
          integration={network}
          isAdmin={isAdmin}
          startExpanded={startExpanded}
          onSelectRoute={setRoute}
          onAddRoute={(tunnelId) => setSheet({ kind: "add", integration: network, tunnelId })}
          onUpgradeToken={() => setSheet({ kind: "upgrade", integration: network })}
        />
      ))}

      <MobileCloudflareRouteSheet
        route={route}
        isAdmin={isAdmin}
        onOpenChange={(open) => !open && setRoute(null)}
        onRemove={setConfirmRemove}
      />
      <MobileCloudflareRemoveDialog
        route={confirmRemove}
        onOpenChange={(open) => !open && setConfirmRemove(null)}
        onRemoved={() => {
          setConfirmRemove(null);
          setRoute(null);
        }}
      />
      {sheet?.kind === "add" && (
        <MobileCloudflareAddRouteSheet
          integration={sheet.integration}
          initialTunnelId={sheet.tunnelId}
          onOpenChange={(open) => !open && setSheet(null)}
        />
      )}
      {sheet?.kind === "upgrade" && (
        <MobileCloudflareTokenSheet
          integration={sheet.integration}
          onOpenChange={(open) => !open && setSheet(null)}
        />
      )}
    </>
  );
}

/** One Cloudflare account: its headline counts, then a card per tunnel. */
function MobileCloudflareIntegration({
  integration,
  isAdmin,
  startExpanded,
  onSelectRoute,
  onAddRoute,
  onUpgradeToken,
}: {
  integration: OtherEdgeNetwork;
  isAdmin: boolean;
  startExpanded: boolean;
  onSelectRoute: (route: CloudflareRouteRow) => void;
  onAddRoute: (tunnelId: string | null) => void;
  onUpgradeToken: () => void;
}) {
  const summary = cloudflareIntegrationSummary(integration);
  const cards = cloudflareTunnelCards(integration);
  const showZone = cloudflareZoneWorthShowing(integration);
  return (
    <MobileSection title={summary.name}>
      <MobileSummaryLine items={[{ label: summary.accountName }, { label: summary.detail }]} />

      {/* Amber is spent here and nowhere else on this tab: a denied capability is
          the one state that stops a route change from ever succeeding. */}
      {isAdmin && summary.capability === "denied" && <CloudflareDeniedNotice onUpgradeToken={onUpgradeToken} />}

      {/* Why no card offers Add route. Ordinary configuration, stated neutrally. */}
      {isAdmin && summary.addRouteBlockedReason && (
        <p className="px-0.5 text-[11px] leading-snug text-muted-foreground">{summary.addRouteBlockedReason}</p>
      )}

      {cards.length === 0 ? (
        <CloudflareNoTunnels summary={summary} />
      ) : (
        cards.map((card) => (
          <MobileCloudflareTunnelCard
            key={card.key}
            card={card}
            isAdmin={isAdmin}
            showZone={showZone}
            defaultExpanded={startExpanded}
            onAddRoute={() => onAddRoute(card.tunnelId)}
            onSelectRoute={onSelectRoute}
          />
        ))
      )}
    </MobileSection>
  );
}

function CloudflareDeniedNotice({ onUpgradeToken }: { onUpgradeToken: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5">
      <p className="flex items-start gap-1.5 text-xs text-warning">
        <LockKeyhole className="mt-0.5 size-3.5 shrink-0" />
        <span className="min-w-0">
          <span className="block font-medium">Route changes need an edit-capable Cloudflare token</span>
          <span className="mt-0.5 block leading-snug">
            The Read All Resources policy is enough for discovery. Adding or removing routes needs Cloudflare Tunnel
            Edit, Zone Read, and DNS Edit.
          </span>
        </span>
      </p>
      <Button variant="outline" size="sm" className="w-full" onClick={onUpgradeToken}>
        <LockKeyhole /> Upgrade token
      </Button>
    </div>
  );
}

/**
 * Nothing to draw a card from. A count-only payload is not "no tunnels" and must
 * not look like it — the sync reported how many there are and nothing else.
 */
function CloudflareNoTunnels({ summary }: { summary: CloudflareIntegrationSummary }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-5 text-center">
      <p className="text-sm font-medium">
        {summary.countOnly
          ? `${cloudflareTunnelCountLabel(summary.tunnelCount)} reported, without their routes`
          : "No tunnels in the latest sync"}
      </p>
      <p className="max-w-64 text-xs text-muted-foreground">
        {summary.countOnly
          ? "This integration last synced before PolySIEM recorded tunnel ingress. Re-sync it to list and edit published hostnames here."
          : "Create a tunnel in Cloudflare, or run cloudflared where it can register, then refresh this page."}
      </p>
    </div>
  );
}
