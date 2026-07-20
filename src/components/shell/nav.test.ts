import { describe, expect, it } from "vitest";
import { NAV_GROUPS, isActive } from "./nav";

describe("network navigation", () => {
  const groupTitleFor = (href: string) =>
    NAV_GROUPS.find((group) => group.items.some((item) => item.href === href))?.title;

  it("leads with access map, firewall, edge networks, and networks in that order", () => {
    const network = NAV_GROUPS.find((group) => group.title === "Network");

    expect(network?.items.slice(0, 4).map(({ title, href }) => ({ title, href }))).toEqual([
      { title: "Access map", href: "/network/access-map" },
      { title: "Firewall", href: "/firewall" },
      { title: "Edge networks", href: "/network/edge-networks" },
      { title: "Networks", href: "/network" },
    ]);
  });

  it("promotes Network insights to the ungrouped rail between Dashboard and Documentation", () => {
    const ungrouped = NAV_GROUPS.find((group) => group.title === null);

    expect(ungrouped?.items.map((item) => item.href)).toEqual([
      "/",
      "/network/insights",
      "/docs",
    ]);
  });

  it("lists every page exactly once", () => {
    // Insights and Firewall moved groups; a copy left behind would render twice.
    const hrefs = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect(groupTitleFor("/firewall")).toBe("Network");
    expect(groupTitleFor("/network/insights")).toBeNull();
  });

  it("folds IP addresses and Clients into the Networks page as palette-only tabs", () => {
    // Both are now tabs of /network, so they stay reachable from the command
    // palette but no longer draw their own sidebar rows.
    const network = NAV_GROUPS.find((group) => group.title === "Network");
    const tabHrefs = ["/network/ips", "/network/dhcp"];
    for (const href of tabHrefs) {
      const item = network?.items.find((entry) => entry.href === href);
      expect(item?.paletteOnly, `${href} should be palette-only`).toBe(true);
    }
  });
});

describe("sidebar active highlighting", () => {
  // paletteOnly entries (Virtual machines, Containers, IP addresses, Clients)
  // never render in the rail — "Compute" and "Networks" deliberately own their
  // routes — so only the items the sidebar actually draws can double-highlight.
  const railHrefs = NAV_GROUPS.flatMap((group) =>
    group.items.filter((item) => !item.paletteOnly).map((item) => item.href),
  );
  const activeFor = (pathname: string) =>
    railHrefs.filter((href) => isActive(pathname, href));

  it("highlights a network subpage without also highlighting Networks", () => {
    expect(activeFor("/network/insights")).toEqual(["/network/insights"]);
  });

  it("still gives /network/<id> detail pages to Networks", () => {
    expect(activeFor("/network/abc123")).toEqual(["/network"]);
    expect(activeFor("/network")).toEqual(["/network"]);
  });

  it("never lights up two sidebar items for the same route", () => {
    // Every rail destination must resolve to exactly one highlighted item —
    // the invariant the /network catch-all broke for /network/insights.
    for (const href of railHrefs) {
      expect(activeFor(href), `${href} highlighted more than one nav item`).toHaveLength(1);
    }
  });

  it("keeps a nested subpage off its parent across every group", () => {
    expect(activeFor("/workflows/runs")).toEqual(["/workflows/runs"]);
    expect(activeFor("/network/access-map")).toEqual(["/network/access-map"]);
    expect(activeFor("/network/edge-networks")).toEqual(["/network/edge-networks"]);
    expect(activeFor("/logs/threats")).toEqual(["/logs/threats"]);
  });

  it("keeps palette-only compute routes under Compute", () => {
    for (const pathname of ["/inventory/vms", "/inventory/containers"]) {
      expect(activeFor(pathname)).toEqual(["/inventory/hosts"]);
    }
  });

  it("keeps the IP and Clients tabs under Networks", () => {
    for (const pathname of ["/network/ips", "/network/dhcp"]) {
      expect(activeFor(pathname)).toEqual(["/network"]);
    }
  });
});
