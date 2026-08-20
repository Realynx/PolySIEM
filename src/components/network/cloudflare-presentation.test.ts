import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_ROUTE_SCROLL_THRESHOLD,
  cloudflareCatchAllService,
  cloudflareConfigSource,
  cloudflareCountOnly,
  cloudflareIntegrationSummary,
  cloudflarePathLabel,
  cloudflarePublishedCountLabel,
  cloudflareRouteRows,
  cloudflareRouteScrollNote,
  cloudflareRoutesScroll,
  cloudflareServiceLabel,
  cloudflareShortId,
  cloudflareTunnelCards,
  cloudflareTunnelCount,
  cloudflareTunnelEntries,
  cloudflareTunnelStatus,
  cloudflareZoneWorthShowing,
  edgeCardCountLabel,
  edgeCardsStartExpanded,
  EDGE_CARD_EXPAND_THRESHOLD,
} from "./cloudflare-presentation";
import type { OtherEdgeNetwork } from "./edge-networks-types";

const integration = (overrides: Partial<OtherEdgeNetwork> = {}): OtherEdgeNetwork => ({
  id: "cf-1",
  name: "Cloudflare",
  account: { id: "acc-1", name: "Fox account" },
  zones: [{ id: "zone-1", name: "example.com" }],
  tunnels: [
    {
      id: "tunnel-1",
      name: "home",
      status: "healthy",
      configSource: "cloudflare",
      ingress: [
        { hostname: "app.example.com", service: "http://10.0.3.20:8080", path: null },
        { hostname: "api.example.com", service: "http://10.0.3.21:9000", path: "/v1/*" },
        { hostname: null, service: "http_status:404", path: null },
      ],
    },
  ],
  ...overrides,
});

describe("payload shapes", () => {
  it("reads a tunnel array", () => {
    expect(cloudflareTunnelCount(integration())).toBe(1);
    expect(cloudflareTunnelEntries(integration())).toHaveLength(1);
    expect(cloudflareCountOnly(integration())).toBe(false);
  });

  it("survives the older payload where tunnels is a plain number", () => {
    const older = integration({ tunnels: 4 });
    expect(cloudflareTunnelCount(older)).toBe(4);
    expect(cloudflareTunnelEntries(older)).toEqual([]);
    expect(cloudflareTunnelCards(older)).toEqual([]);
    expect(cloudflareRouteRows(older)).toEqual([]);
    expect(cloudflareCountOnly(older)).toBe(true);
  });

  it("treats a missing or nonsense count as no information", () => {
    expect(cloudflareTunnelCount(integration({ tunnels: undefined }))).toBe(0);
    expect(cloudflareTunnelCount(integration({ tunnels: Number.NaN }))).toBe(0);
    expect(cloudflareTunnelCount(integration({ tunnels: -3 }))).toBe(0);
    expect(cloudflareTunnelCount(integration({ tunnels: 2.7 }))).toBe(2);
    expect(cloudflareCountOnly(integration({ tunnels: undefined }))).toBe(false);
    expect(cloudflareCountOnly(integration({ tunnels: [] }))).toBe(false);
  });
});

describe("tunnel cards", () => {
  it("turns one tunnel into one card carrying its hostname routes", () => {
    const [card] = cloudflareTunnelCards(integration());
    expect(card.name).toBe("home");
    expect(card.status).toEqual({ label: "Healthy", tone: "up" });
    expect(card.routeCount).toBe(2);
    expect(card.routes.map((route) => route.hostname)).toEqual(["app.example.com", "api.example.com"]);
    expect(card.canAddRoute).toBe(true);
  });

  it("resolves the zone per hostname and only allows removal when it can address the route", () => {
    const [card] = cloudflareTunnelCards(integration());
    expect(card.routes[0].zoneId).toBe("zone-1");
    expect(card.routes[0].zoneName).toBe("example.com");
    expect(card.routes.every((route) => route.removable)).toBe(true);
  });

  it("still lists routes of a tunnel with no id, but never offers to remove them", () => {
    const cards = cloudflareTunnelCards(integration({
      tunnels: [{ name: "orphan", configSource: "cloudflare", ingress: [{ hostname: "app.example.com", service: "http://x", path: null }] }],
    }));
    expect(cards[0].tunnelId).toBeNull();
    expect(cards[0].routeCount).toBe(1);
    expect(cards[0].routes[0].removable).toBe(false);
    expect(cards[0].canAddRoute).toBe(false);
  });

  it("marks a route unremovable when no zone matches its hostname", () => {
    const [card] = cloudflareTunnelCards(integration({ zones: [{ id: "zone-2", name: "other.net" }] }));
    expect(card.routes[0].zoneId).toBeNull();
    expect(card.routes[0].removable).toBe(false);
  });

  it("keeps keys distinct for two paths on the same hostname", () => {
    const [card] = cloudflareTunnelCards(integration({
      tunnels: [{
        id: "tunnel-1",
        name: "home",
        configSource: "cloudflare",
        ingress: [
          { hostname: "app.example.com", service: "http://a", path: "/one" },
          { hostname: "app.example.com", service: "http://b", path: "/two" },
        ],
      }],
    }));
    expect(new Set(card.routes.map((route) => route.key)).size).toBe(2);
  });

  it("reports the catch-all rule separately instead of as a route", () => {
    const [card] = cloudflareTunnelCards(integration());
    expect(card.catchAllService).toBe("http_status:404");
    expect(card.routes.some((route) => route.service === "http_status:404")).toBe(false);
    expect(cloudflareCatchAllService({ name: "bare" })).toBeNull();
  });

  it("does not offer Add route on a locally configured tunnel", () => {
    const [card] = cloudflareTunnelCards(integration({
      tunnels: [{ id: "t", name: "local", configSource: "local", ingress: [] }],
    }));
    expect(card.canAddRoute).toBe(false);
    expect(card.config.editable).toBe(false);
  });
});

describe("state in words", () => {
  it("names known tunnel states and passes unknown ones through readably", () => {
    expect(cloudflareTunnelStatus("healthy").tone).toBe("up");
    expect(cloudflareTunnelStatus("degraded")).toEqual({ label: "Degraded", tone: "down" });
    expect(cloudflareTunnelStatus(undefined)).toEqual({ label: "Status unknown", tone: "unknown" });
    expect(cloudflareTunnelStatus("  ")).toEqual({ label: "Status unknown", tone: "unknown" });
    expect(cloudflareTunnelStatus("provisioning")).toEqual({ label: "Provisioning", tone: "unknown" });
  });

  it("states a local config source neutrally, never as a risk", () => {
    const local = cloudflareConfigSource("local");
    expect(local.editable).toBe(false);
    expect(local.note).toContain("does not change them");
    expect(local.note).not.toMatch(/warn|danger|risk|insecure/i);
    expect(cloudflareConfigSource("cloudflare")).toEqual({ editable: true, label: "Managed in Cloudflare", note: null });
    expect(cloudflareConfigSource(undefined).editable).toBe(false);
  });
});

describe("integration summary", () => {
  it("counts tunnels, routes, and editable tunnels", () => {
    const summary = cloudflareIntegrationSummary(integration());
    expect(summary.accountName).toBe("Fox account");
    expect(summary.tunnelCount).toBe(1);
    expect(summary.routeCount).toBe(2);
    expect(summary.editableTunnelCount).toBe(1);
    expect(summary.detail).toBe("1 tunnel · 2 published hostnames");
    expect(summary.canAddRoute).toBe(true);
    expect(summary.addRouteBlockedReason).toBeNull();
    expect(summary.capability).toBe("unknown");
  });

  it("explains why Add route is unavailable rather than only disabling it", () => {
    expect(cloudflareIntegrationSummary(integration({ tunnels: 4 })).addRouteBlockedReason)
      .toContain("Re-sync");
    expect(cloudflareIntegrationSummary(integration({
      tunnels: [{ id: "t", name: "local", configSource: "local" }],
    })).addRouteBlockedReason).toContain("local cloudflared config file");
    expect(cloudflareIntegrationSummary(integration({ zones: [] })).addRouteBlockedReason)
      .toContain("No DNS zone");
  });

  it("carries the route-management capability through", () => {
    const denied = cloudflareIntegrationSummary(integration({
      routeManagementCapability: { status: "denied", checkedAt: null, reason: "token lacks Tunnel Edit" },
    }));
    expect(denied.capability).toBe("denied");
    // A denied capability is a real blocker to flag, but it never hides the button
    // that leads to the token upgrade.
    expect(denied.canAddRoute).toBe(true);
  });

  it("names the zone per row only when there is more than one to choose from", () => {
    expect(cloudflareZoneWorthShowing(integration())).toBe(false);
    expect(cloudflareZoneWorthShowing(integration({
      zones: [{ id: "z1", name: "example.com" }, { id: "z2", name: "example.net" }],
    }))).toBe(true);
  });
});

describe("collapse and scroll", () => {
  it("starts cards expanded only while they all fit", () => {
    expect(EDGE_CARD_EXPAND_THRESHOLD).toBe(3);
    expect(edgeCardsStartExpanded(1)).toBe(true);
    expect(edgeCardsStartExpanded(3)).toBe(true);
    expect(edgeCardsStartExpanded(4)).toBe(false);
    expect(edgeCardsStartExpanded(4, 5)).toBe(true);
  });

  it("scrolls a routes list only once it would crowd the page", () => {
    expect(CLOUDFLARE_ROUTE_SCROLL_THRESHOLD).toBe(8);
    expect(cloudflareRoutesScroll(8)).toBe(false);
    expect(cloudflareRoutesScroll(9)).toBe(true);
    expect(cloudflareRouteScrollNote(8)).toBeNull();
    expect(cloudflareRouteScrollNote(200)).toBe(
      "200 routes on this tunnel · about 8 fit at a time, scroll the list for the rest.",
    );
  });
});

describe("labels", () => {
  it("pluralises counts without a stray (s)", () => {
    expect(edgeCardCountLabel(1, "route")).toBe("1 route");
    expect(edgeCardCountLabel(0, "route")).toBe("0 routes");
    expect(cloudflarePublishedCountLabel(1)).toBe("1 published hostname");
  });

  it("says when an ingress rule matches everything", () => {
    expect(cloudflarePathLabel("")).toBe("All paths");
    expect(cloudflarePathLabel("  ")).toBe("All paths");
    expect(cloudflarePathLabel("/*")).toBe("All paths");
    expect(cloudflarePathLabel("/api/*")).toBe("/api/*");
  });

  it("never renders an empty service cell", () => {
    expect(cloudflareServiceLabel("")).toBe("No origin service");
    expect(cloudflareServiceLabel(" http://a ")).toBe("http://a");
  });

  it("shortens a tunnel uuid but leaves a short id alone", () => {
    expect(cloudflareShortId(null)).toBeNull();
    expect(cloudflareShortId("short-id")).toBe("short-id");
    expect(cloudflareShortId("6ff42ae2-765d-4d6b-9c1e-6f4a1f2f0f11")).toBe("6ff42ae2…2f0f11");
  });
});
