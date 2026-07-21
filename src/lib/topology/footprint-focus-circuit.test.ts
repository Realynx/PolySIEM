import { describe, expect, it } from "vitest";
import {
  deriveFootprintFocusCircuit,
  type FootprintFocusEdge,
} from "./footprint-focus-circuit";

const edges: FootprintFocusEdge[] = [
  {
    id: "policy:vlan3:friends->container:a",
    source: "container:a",
    target: "policy:vlan3:friends",
    data: { relationship: "policy-peer" },
  },
  {
    id: "policy:vlan3:friends->container:c",
    source: "container:c",
    target: "policy:vlan3:friends",
    data: { relationship: "policy-peer" },
  },
  {
    id: "filter:firewall->vlan3",
    source: "firewall",
    target: "lane:vlan3",
    data: { relationship: "filtered-network" },
  },
  {
    id: "contain:host->container:a",
    source: "host",
    target: "container:a",
    data: { relationship: "containment" },
  },
  {
    id: "contain:host->container:b",
    source: "host",
    target: "container:b",
    data: { relationship: "containment" },
  },
];

const parents = new Map([
  ["container:a", "lane:vlan3"],
  ["container:b", "lane:vlan3"],
  ["container:c", "lane:vlan3"],
  ["policy:vlan3:friends", "lane:vlan3"],
]);

describe("Footprint reachability focus", () => {
  it("keeps an isolated same-VLAN sibling dim while following an allowed peer group", () => {
    const focus = deriveFootprintFocusCircuit(edges, "container:a", parents);

    expect(focus.nodeIds).toContain("container:a");
    expect(focus.nodeIds).toContain("container:c");
    expect(focus.nodeIds).toContain("lane:vlan3");
    expect(focus.nodeIds).not.toContain("container:b");
    expect(focus.edgeIds).toEqual(new Set([
      "policy:vlan3:friends->container:a",
      "policy:vlan3:friends->container:c",
    ]));
    expect(focus.nodeIds).not.toContain("host");
  });

  it("treats a VLAN as context, not a shortcut to every child workload", () => {
    const focus = deriveFootprintFocusCircuit(edges, "lane:vlan3", parents);

    expect(focus.nodeIds).toEqual(new Set(["lane:vlan3", "firewall"]));
    expect(focus.edgeIds).toEqual(new Set(["filter:firewall->vlan3"]));
  });

  it("expands the full allowed peer group when one of its edges is focused", () => {
    const focus = deriveFootprintFocusCircuit(
      edges,
      "policy:vlan3:friends->container:a",
      parents,
    );

    expect(focus.nodeIds).toContain("container:c");
    expect(focus.edgeIds.size).toBe(2);
  });

  it("does not treat a compute host as a network hub for all of its guests", () => {
    const focus = deriveFootprintFocusCircuit(edges, "host", parents);

    expect(focus.nodeIds).toEqual(new Set(["host"]));
    expect(focus.edgeIds.size).toBe(0);
  });

  it.each(["route:app", "container:a"])(
    "follows a published route from %s through its tunnel to the WAN root",
    (focusedId) => {
      const publishedEdges: FootprintFocusEdge[] = [
        {
          id: "tunnel:cloudflare:in:route:app",
          source: "gw:wan",
          target: "tunnel:cloudflare",
          data: { relationship: "tunnel-route", traceKey: "route:app" },
        },
        {
          id: "route:app:in",
          source: "tunnel:cloudflare",
          target: "route:app",
          data: { relationship: "tunnel-hostname", traceKey: "route:app" },
        },
        {
          id: "route:app:svc",
          source: "route:app",
          target: "container:a",
          data: { relationship: "published-service", traceKey: "route:app" },
        },
        {
          id: "tunnel:cloudflare:in:route:sibling",
          source: "gw:wan",
          target: "tunnel:cloudflare",
          data: {
            relationship: "tunnel-route",
            traceKey: "route:sibling",
          },
        },
        {
          id: "route:sibling:in",
          source: "tunnel:cloudflare",
          target: "route:sibling",
          data: {
            relationship: "tunnel-hostname",
            traceKey: "route:sibling",
          },
        },
      ];

      const focus = deriveFootprintFocusCircuit(
        publishedEdges,
        focusedId,
      );

      expect(focus.nodeIds).toContain("gw:wan");
      expect(focus.nodeIds).toContain("tunnel:cloudflare");
      expect(focus.edgeIds).toEqual(
        new Set([
          "tunnel:cloudflare:in:route:app",
          "route:app:in",
          "route:app:svc",
        ]),
      );
      expect(focus.nodeIds).not.toContain("route:sibling");
    },
  );
});
