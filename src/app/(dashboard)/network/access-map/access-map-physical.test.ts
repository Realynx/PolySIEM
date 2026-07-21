import { describe, expect, it } from "vitest";
import { buildPhysicalNetworkData } from "./access-map-physical";

describe("buildPhysicalNetworkData", () => {
  it("uses port-channel interfaces and expands trunk VLAN ranges", () => {
    const physical = buildPhysicalNetworkData(
      [
        { id: "net-10", vlanId: 10 },
        { id: "net-20", vlanId: 20 },
      ],
      [{
        device: { id: "switch-1", name: "Core" },
        vlans: [
          { vlanId: 10, svIpAddress: "10.0.10.1/24", networkId: "net-10" },
          { vlanId: 20, svIpAddress: null, networkId: "net-20" },
        ],
        ports: [
          {
            shortName: "Gi1/0/1",
            description: "member",
            mode: "trunk",
            accessVlanId: null,
            voiceVlanId: null,
            nativeVlanId: null,
            allowedVlans: "10,20",
            channelGroup: 1,
            isPortChannel: false,
            isShutdown: false,
            connectedDevice: null,
          },
          {
            shortName: "Po1",
            description: "uplink",
            mode: "trunk",
            accessVlanId: null,
            voiceVlanId: null,
            nativeVlanId: null,
            allowedVlans: "10,20",
            channelGroup: null,
            isPortChannel: true,
            isShutdown: false,
            connectedDevice: { name: "Router" },
          },
        ],
      }],
      [],
      [],
    );

    expect(physical.carriers["net-10"][0].entries).toEqual([{
      port: "Po1",
      label: "Router",
      mode: "trunk",
    }]);
    expect(physical.switches[0].carried).toEqual([
      { networkId: "net-10", ports: 1 },
      { networkId: "net-20", ports: 1 },
    ]);
    expect(physical.sviMembers).toEqual([{
      networkId: "net-10",
      member: { ip: "10.0.10.1", label: "Core", kind: "svi" },
    }]);
  });

  it("attaches every AP to the ordered union of SSID networks", () => {
    const physical = buildPhysicalNetworkData(
      [],
      [],
      [
        { name: "Staff", band: "5GHz", security: "WPA2", hidden: false, isGuest: false, enabled: true, networkId: "staff" },
        { name: "Guest", band: null, security: null, hidden: false, isGuest: true, enabled: true, networkId: "guest" },
        { name: "Staff 2", band: null, security: null, hidden: true, isGuest: false, enabled: false, networkId: "staff" },
      ],
      [{ id: "ap-1", name: "Lobby", model: "U7" }],
    );

    expect(physical.wifiAps[0].networkIds).toEqual(["staff", "guest"]);
    expect(physical.wireless.staff).toHaveLength(2);
  });
});
