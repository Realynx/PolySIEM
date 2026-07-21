import { describe, expect, it } from "vitest";
import { deriveFootprint, focusFootprintGraph } from "./footprint";
import { input } from "./footprint.test-fixtures";

describe("focusFootprintGraph", () => {
  const graph = deriveFootprint(input());

  it("keeps a container's direct routes, host containment, and connected network rails", () => {
    const focused = focusFootprintGraph(graph, "ct101")!;

    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["alice", "ct101"]);
    expect(focused.lanes.map((lane) => lane.id)).toEqual([
      "admin",
      "servers",
      "home",
    ]);
    expect(focused.reachability.map((edge) => edge.id)).toEqual([
      "reach:home->servers",
    ]);
    expect(focused.routes).toHaveLength(17);
    expect(
      focused.routes.every(
        (route) => route.tunnelId === "t1" && route.targetId === "ct101",
      ),
    ).toBe(true);
    expect(focused.tunnels.map((tunnel) => tunnel.id)).toEqual(["t1"]);
    expect(focused.inbound).toEqual([]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "carriage:sw->servers",
    ]);
    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);

    const retainedIds = focused.lanes.flatMap((lane) =>
      lane.machines.map((machine) => machine.id),
    );
    expect(retainedIds).not.toEqual(
      expect.arrayContaining(["ct128", "ct137", "dixie", "nas", "pdu"]),
    );
  });

  it("keeps only a device's direct physical uplink and leaves unrelated lane machines out", () => {
    const withDeviceUplink = deriveFootprint(
      input({
        uplinks: [
          { switchId: "sw", deviceId: "dixie", label: "Po1 · 2×" },
          { switchId: "sw", deviceId: "alice", label: "Po4 · 2×" },
          { switchId: "sw", deviceId: "nas", label: "Gi1/0/8" },
        ],
      }),
    );
    const focused = focusFootprintGraph(withDeviceUplink, "nas")!;

    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["nas"]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "uplink:sw->nas",
    ]);
    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);
    expect(focused.reachability.map((edge) => edge.id)).toEqual([
      "reach:home->servers",
      "reach:home->internet",
    ]);
  });

  it("keeps every direct physical attachment when the switch is selected", () => {
    const focused = focusFootprintGraph(graph, "sw")!;

    expect(focused.switches.map((machine) => machine.id)).toEqual(["sw"]);
    expect(focused.switchLinks.map((link) => link.id)).toEqual([
      "uplink:sw->dixie",
      "uplink:sw->alice",
      "carriage:sw->servers",
    ]);
    expect(
      focused.lanes.flatMap((lane) =>
        lane.machines.map((machine) => machine.id),
      ),
    ).toEqual(["alice", "dixie"]);
    expect(focused.reachability).toEqual([]);
    expect(focused.firewalls).toEqual([]);
  });

  it("returns null for an id that is not a selectable asset", () => {
    expect(focusFootprintGraph(graph, "does-not-exist")).toBeNull();
  });
});
