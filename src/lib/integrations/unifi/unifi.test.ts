import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cookieHeaderFrom,
  loginErrorMessage,
  mapApState,
  mapDevice,
  mapLegacyClient,
  mapManagedDevice,
  mapNetwork,
  mapSecurity,
  mapWlan,
  mapWpaMode,
  resolveWlanVlan,
  type RawNetworkConf,
  type RawUnifiDevice,
  type RawWlanConf,
} from "./client";
import {
  mapOfficialClient,
  mapOfficialDevice,
  mapOfficialNetwork,
  mapOfficialWlan,
  fetchOfficialUnifiSnapshot,
  officialApiRoot,
  officialDeviceToAp,
  officialWifiSecurity,
  selectOfficialSite,
} from "./official-client";
import { pickNetworkIdForWlan } from "./sync";
import { mockUnifiSnapshot } from "./mock";

afterEach(() => vi.unstubAllGlobals());

// Real UniFi Network 8.3.32 fixture data (scratchpad-unifi-fixture.json).
const FIXTURE_WLANS: RawWlanConf[] = [
  { _id: "63e98468419602435856d0e5", name: "element-5d2d200b8a7b215f", enabled: true, security: "wpapsk", wpa_mode: "wpa2", hide_ssid: true, wlan_band: "both" },
  { _id: "63e9892e419602435856d117", name: "UwU", enabled: true, security: "wpapsk", wpa_mode: "wpa2", wpa3_support: false, wpa3_transition: false, networkconf_id: "6964462fb53bf24a11784c46", is_guest: false, hide_ssid: true, wlan_band: "both", ap_group_ids: ["63e98468419602435856d0fd"] },
  { _id: "6487a6511b62c06e1c53e0da", name: "Devices", enabled: true, security: "wpapsk", wpa_mode: "wpa2", networkconf_id: "6964462fb53bf24a11784c46", is_guest: false, hide_ssid: false, wlan_band: "2g", ap_group_ids: ["63e98468419602435856d0fd"] },
  { _id: "654ac3f8511bca3218822e15", name: "Devices5g", enabled: true, security: "wpapsk", wpa_mode: "wpa2", networkconf_id: "6964462fb53bf24a11784c46", is_guest: false, hide_ssid: false, wlan_band: "5g", ap_group_ids: ["63e98468419602435856d0fd"] },
];

const FIXTURE_NETWORKS: RawNetworkConf[] = [
  { _id: "63e98468419602435856d0f4", purpose: "corporate", ip_subnet: "192.168.1.1/24", networkgroup: "LAN", vlan_enabled: false, name: "Default" },
  { _id: "6964462fb53bf24a11784c46", vlan: 4, purpose: "vlan-only", name: "WirelessLan", vlan_enabled: true },
  { _id: "696e234728670a5de1adf04c", vlan: 3, purpose: "vlan-only", name: "LocalServers", vlan_enabled: true },
];

const FIXTURE_AP: RawUnifiDevice = {
  _id: "63e9cf70419602435856d139",
  type: "uap",
  model: "UAL6",
  ip: "10.0.3.94",
  version: "6.7.31.15618",
  mac: "60:22:32:47:15:90",
  adopted: true,
  state: 1,
  name: "U6 Lite",
};

function fixtureWlan(name: string): RawWlanConf {
  const wlan = FIXTURE_WLANS.find((w) => w.name === name);
  if (!wlan) throw new Error(`fixture wlan ${name} missing`);
  return wlan;
}

describe("resolveWlanVlan", () => {
  it("resolves the three real SSIDs to VLAN 4 via WirelessLan", () => {
    for (const name of ["UwU", "Devices", "Devices5g"]) {
      expect(resolveWlanVlan(fixtureWlan(name), FIXTURE_NETWORKS)).toBe(4);
    }
  });

  it("returns null for the onboarding SSID with no networkconf_id", () => {
    expect(resolveWlanVlan(fixtureWlan("element-5d2d200b8a7b215f"), FIXTURE_NETWORKS)).toBeNull();
  });

  it("returns null when the linked network has VLAN tagging disabled", () => {
    expect(resolveWlanVlan({ networkconf_id: "63e98468419602435856d0f4" }, FIXTURE_NETWORKS)).toBeNull();
  });

  it("returns null for an unknown networkconf_id", () => {
    expect(resolveWlanVlan({ networkconf_id: "does-not-exist" }, FIXTURE_NETWORKS)).toBeNull();
  });
});

describe("mapWlan", () => {
  it("maps UwU with vlan, band, hidden and guest flags", () => {
    expect(mapWlan(fixtureWlan("UwU"), FIXTURE_NETWORKS)).toEqual({
      externalId: "63e9892e419602435856d117",
      name: "UwU",
      enabled: true,
      security: "wpa-psk",
      wpaMode: "wpa2",
      band: "both",
      hidden: true,
      isGuest: false,
      vlanId: 4,
      networkExternalId: "6964462fb53bf24a11784c46",
      apCount: 1,
    });
  });

  it("maps the band per SSID", () => {
    expect(mapWlan(fixtureWlan("Devices"), FIXTURE_NETWORKS).band).toBe("2g");
    expect(mapWlan(fixtureWlan("Devices5g"), FIXTURE_NETWORKS).band).toBe("5g");
    expect(mapWlan(fixtureWlan("UwU"), FIXTURE_NETWORKS).band).toBe("both");
  });

  it("maps visible SSIDs as not hidden", () => {
    expect(mapWlan(fixtureWlan("Devices"), FIXTURE_NETWORKS).hidden).toBe(false);
    expect(mapWlan(fixtureWlan("Devices5g"), FIXTURE_NETWORKS).hidden).toBe(false);
  });

  it("maps the element onboarding SSID without a network link", () => {
    const wlan = mapWlan(fixtureWlan("element-5d2d200b8a7b215f"), FIXTURE_NETWORKS);
    expect(wlan.networkExternalId).toBeNull();
    expect(wlan.vlanId).toBeNull();
    expect(wlan.hidden).toBe(true);
    expect(wlan.isGuest).toBe(false);
    expect(wlan.apCount).toBeNull();
  });
});

describe("mapSecurity", () => {
  it("normalizes known UniFi security values", () => {
    expect(mapSecurity("open")).toBe("open");
    expect(mapSecurity("wpapsk")).toBe("wpa-psk");
    expect(mapSecurity("wpaeap")).toBe("wpa-enterprise");
  });

  it("passes unknown values through and nulls missing ones", () => {
    expect(mapSecurity("wep")).toBe("wep");
    expect(mapSecurity(undefined)).toBeNull();
  });
});

describe("mapWpaMode", () => {
  it("keeps the raw wpa_mode when wpa3 flags are off", () => {
    expect(mapWpaMode(fixtureWlan("UwU"))).toBe("wpa2");
    expect(mapWpaMode(fixtureWlan("Devices"))).toBe("wpa2");
  });

  it("upgrades to wpa3 / wpa3-transition when flagged", () => {
    expect(mapWpaMode({ wpa_mode: "wpa2", wpa3_support: true })).toBe("wpa3");
    expect(mapWpaMode({ wpa_mode: "wpa2", wpa3_support: true, wpa3_transition: true })).toBe("wpa3-transition");
  });
});

describe("mapNetwork", () => {
  it("maps VLAN-enabled and untagged networks from the fixture", () => {
    expect(FIXTURE_NETWORKS.map((network) => mapNetwork(network))).toEqual([
      { externalId: "63e98468419602435856d0f4", siteId: "default", name: "Default", vlanId: null, cidr: "192.168.1.0/24", gateway: "192.168.1.1", enabled: true, management: "corporate" },
      { externalId: "6964462fb53bf24a11784c46", siteId: "default", name: "WirelessLan", vlanId: 4, cidr: null, gateway: null, enabled: true, management: "vlan-only" },
      { externalId: "696e234728670a5de1adf04c", siteId: "default", name: "LocalServers", vlanId: 3, cidr: null, gateway: null, enabled: true, management: "vlan-only" },
    ]);
  });
});

describe("mapDevice", () => {
  it("maps the real U6 Lite", () => {
    expect(mapDevice(FIXTURE_AP)).toEqual({
      externalId: "63e9cf70419602435856d139",
      name: "U6 Lite",
      model: "UAL6",
      mac: "60:22:32:47:15:90",
      ip: "10.0.3.94",
      adopted: true,
      state: "online",
      version: "6.7.31.15618",
    });
  });

  it("uppercases lowercase MACs", () => {
    expect(mapDevice({ ...FIXTURE_AP, mac: "60:22:32:47:15:90".toLowerCase() }).mac).toBe("60:22:32:47:15:90");
  });

  it("maps state numbers to friendly statuses", () => {
    expect(mapApState(1)).toBe("online");
    expect(mapApState(0)).toBe("offline");
    expect(mapApState(undefined)).toBe("offline");
    expect(mapApState(5)).toBe("pending");
  });
});

describe("pickNetworkIdForWlan", () => {
  const networks = [
    { id: "net-lan", vlanId: null },
    { id: "net-wifi", vlanId: 4 },
    { id: "net-servers", vlanId: 3 },
  ];

  it("links VLAN 4 SSIDs to the vlan-4 network row", () => {
    for (const name of ["UwU", "Devices", "Devices5g"]) {
      const wlan = mapWlan(fixtureWlan(name), FIXTURE_NETWORKS);
      expect(pickNetworkIdForWlan(wlan.vlanId, networks)).toBe("net-wifi");
    }
  });

  it("leaves untagged or unmatched WLANs unlinked", () => {
    expect(pickNetworkIdForWlan(null, networks)).toBeNull();
    expect(pickNetworkIdForWlan(99, networks)).toBeNull();
  });
});

describe("official UniFi API mapping", () => {
  it("fetches official evidence with the API key only in the request header", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, headers: init?.headers as Record<string, string> });
      const path = new URL(url).pathname;
      const data = path.endsWith("/info")
        ? { applicationVersion: "10.1.84" }
        : path.endsWith("/sites")
          ? { offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: "site-id", internalReference: "default", name: "Home" }] }
          : path.endsWith("/networks")
            ? { offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: "iot", name: "IoT", vlanId: 20, enabled: true }] }
            : path.endsWith("/devices")
              ? { offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: "ap", name: "AP", state: "ONLINE", features: ["accessPoint"], interfaces: ["radios"] }] }
              : path.endsWith("/clients")
                ? { offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: "phone", name: "Phone", ipAddress: "10.0.20.7", type: "WIRELESS" }] }
                : path.endsWith("/wifi/broadcasts")
                  ? { offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: "ssid", name: "Things", network: { networkId: "iot" } }] }
                  : null;
      return new Response(JSON.stringify(data), { status: data ? 200 : 404, headers: { "Content-Type": "application/json" } });
    }));

    const snapshot = await fetchOfficialUnifiSnapshot({
      id: "test",
      type: "UNIFI",
      name: "UniFi",
      baseUrl: "https://unifi.example",
      credentials: { apiKey: "test-secret" },
      verifyTls: true,
      settings: { site: "default" },
    });

    expect(snapshot).toMatchObject({
      apiMode: "official",
      controllerVersion: "10.1.84",
      sites: [{ id: "site-id", name: "Home" }],
    });
    expect(snapshot.networks).toHaveLength(1);
    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.aps).toHaveLength(1);
    expect(snapshot.clients).toHaveLength(1);
    expect(snapshot.wlans[0]).toMatchObject({ name: "Things", vlanId: 20 });
    expect(requests).toHaveLength(6);
    expect(requests.every((request) => request.headers["X-API-KEY"] === "test-secret")).toBe(true);
    expect(requests.every((request) => !request.url.includes("test-secret"))).toBe(true);
  });

  it("discovers an AP-only self-hosted site when the official site list is empty", async () => {
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, headers: init?.headers as Record<string, string> });
      const path = new URL(url).pathname;
      const data = path.endsWith("/info")
        ? { applicationVersion: "10.1.84" }
        : path.endsWith("/sites")
          ? { data: { offset: 0, totalCount: 0, data: [] } }
          : path.endsWith("/stat/device")
            ? { meta: { rc: "ok" }, data: [FIXTURE_AP] }
            : path.endsWith("/stat/sysinfo")
              ? { meta: { rc: "ok" }, data: [{ version: "10.1.84" }] }
              : path.endsWith("/rest/networkconf")
                ? { meta: { rc: "ok" }, data: FIXTURE_NETWORKS }
                : path.endsWith("/rest/wlanconf")
                  ? { meta: { rc: "ok" }, data: FIXTURE_WLANS }
                  : path.endsWith("/stat/sta")
                    ? { meta: { rc: "ok" }, data: [{ _id: "phone", hostname: "Phone", ip: "10.0.3.50", is_wired: false }] }
                    : null;
      return new Response(JSON.stringify(data), { status: data ? 200 : 404, headers: { "Content-Type": "application/json" } });
    }));

    const snapshot = await fetchOfficialUnifiSnapshot({
      id: "test",
      type: "UNIFI",
      name: "UniFi",
      baseUrl: "https://unifi.example:11443",
      credentials: { apiKey: "rotated-test-key" },
      verifyTls: false,
      settings: { site: "default" },
    });

    expect(snapshot).toMatchObject({
      apiMode: "api-key-compat",
      sites: [{ id: "default", internalReference: "default", name: "Default" }],
      controllerVersion: "10.1.84",
    });
    expect(snapshot.devices).toHaveLength(1);
    expect(snapshot.aps).toHaveLength(1);
    expect(snapshot.aps[0]).toMatchObject({ name: "U6 Lite", adopted: true, state: "online" });
    expect(snapshot.clients).toHaveLength(1);
    expect(snapshot.networks).toHaveLength(3);
    expect(snapshot.wlans).toHaveLength(4);
    expect(requests.every((request) => request.headers["X-API-KEY"] === "rotated-test-key")).toBe(true);
    expect(requests.some((request) => request.url.includes("/proxy/network/api/s/default/stat/device"))).toBe(true);
  });

  it("accepts raw and nested official site collection response shapes", async () => {
    for (const response of [
      [{ siteId: "site-raw", internalReference: "default", displayName: "Raw Site" }],
      { data: { data: [{ _id: "site-nested", desc: "Nested Site" }], totalCount: 1 } },
    ]) {
      vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(String(input)).pathname;
        const data = path.endsWith("/info")
          ? { applicationVersion: "10.1.84" }
          : path.endsWith("/sites")
            ? response
            : { data: [] };
        return new Response(JSON.stringify(data), { status: 200, headers: { "Content-Type": "application/json" } });
      }));
      const snapshot = await fetchOfficialUnifiSnapshot({
        id: "test",
        type: "UNIFI",
        name: "UniFi",
        baseUrl: "https://unifi.example",
        credentials: { apiKey: "test-key" },
        verifyTls: true,
        settings: { site: "default" },
      });
      expect(snapshot.apiMode).toBe("official");
      expect(snapshot.sites).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("builds the local API root for a host, docs URL, or already-complete root", () => {
    expect(officialApiRoot({ baseUrl: "https://unifi.example:11443" })).toBe(
      "https://unifi.example:11443/proxy/network/integration/v1",
    );
    expect(officialApiRoot({ baseUrl: "https://unifi.example:11443/unifi-api/network" })).toBe(
      "https://unifi.example:11443/proxy/network/integration/v1",
    );
    expect(officialApiRoot({ baseUrl: "https://unifi.example/proxy/network/integration/v1/" })).toBe(
      "https://unifi.example/proxy/network/integration/v1",
    );
  });

  it("selects an official site by id, internal reference, or display name", () => {
    const sites = [
      { id: "site-1", internalReference: "default", name: "Main Lab" },
      { id: "site-2", internalReference: "garage", name: "Workshop" },
    ];
    expect(selectOfficialSite(sites, "site-1").id).toBe("site-1");
    expect(selectOfficialSite(sites, "DEFAULT").id).toBe("site-1");
    expect(selectOfficialSite(sites, "workshop").id).toBe("site-2");
    expect(() => selectOfficialSite(sites, "missing")).toThrow(/available sites: Main Lab, Workshop/);
  });

  it("maps adopted gateway, switch and AP capabilities", () => {
    expect(mapOfficialDevice({ id: "gw", name: "Gateway", features: ["routing", "switching"] }, "site").kind).toBe("firewall");
    expect(mapOfficialDevice({ id: "sw", name: "Switch", features: ["switching"] }, "site").kind).toBe("switch");
    const ap = mapOfficialDevice({
      id: "ap",
      name: "Office AP",
      model: "U7P",
      macAddress: "aa:bb:cc:dd:ee:ff",
      ipAddress: "10.0.3.94",
      state: "ONLINE",
      firmwareVersion: "7.0.1",
      features: ["accessPoint"],
      interfaces: ["radios"],
    }, "site");
    expect(ap).toMatchObject({ externalId: "site/ap", isAccessPoint: true, kind: "device", mac: "AA:BB:CC:DD:EE:FF" });
    expect(officialDeviceToAp(ap)).toMatchObject({ externalId: "site/ap", adopted: true, state: "online" });
  });

  it("maps official networks and WiFi broadcasts onto VLAN evidence", () => {
    const networks = [
      mapOfficialNetwork({ id: "default", name: "Default", vlanId: 1, default: true }, "site"),
      mapOfficialNetwork({ id: "iot", name: "IoT", vlanId: 20, enabled: true }, "site"),
    ];
    expect(networks[0].vlanId).toBeNull();
    expect(mapOfficialWlan({
      id: "wifi-iot",
      name: "Things",
      enabled: true,
      broadcastingFrequenciesGHz: [2.4],
      network: { type: "STANDARD", networkId: "iot" },
      securityConfiguration: { type: "WPA2_WPA3_PERSONAL" },
      broadcastingDeviceFilter: { type: "DEVICES", deviceIds: ["ap-1", "ap-2"] },
      hideName: true,
    }, networks, "site")).toEqual({
      externalId: "site/wifi-iot",
      name: "Things",
      enabled: true,
      security: "wpa-psk",
      wpaMode: "wpa3-transition",
      band: "2g",
      hidden: true,
      isGuest: false,
      vlanId: 20,
      networkExternalId: "site/iot",
      apCount: 2,
    });
  });

  it("normalizes official WiFi security and connected-client evidence", () => {
    expect(officialWifiSecurity("OPEN")).toEqual({ security: "open", wpaMode: null });
    expect(officialWifiSecurity("WPA3_ENTERPRISE")).toEqual({ security: "wpa-enterprise", wpaMode: "wpa3" });
    expect(mapOfficialClient({
      id: "client-1",
      name: "phone",
      macAddress: "aa:bb:cc:00:00:01",
      ipAddress: "10.0.20.5",
      type: "WIRELESS",
      access: { type: "STANDARD", authorized: true },
    }, "site")).toMatchObject({
      externalId: "site/client-1",
      mac: "AA:BB:CC:00:00:01",
      ip: "10.0.20.5",
      authorized: true,
    });
  });
});

describe("legacy evidence mapping", () => {
  it("promotes classic adopted devices and connected stations into normalized evidence", () => {
    expect(mapManagedDevice(FIXTURE_AP)).toMatchObject({
      externalId: FIXTURE_AP._id,
      isAccessPoint: true,
      features: ["accessPoint"],
      kind: "device",
    });
    expect(mapLegacyClient({
      _id: "station-1",
      hostname: "tablet",
      mac: "aa:bb:cc:dd:ee:01",
      ip: "10.0.4.20",
      is_wired: false,
      first_seen: 1_700_000_000,
    })).toMatchObject({
      externalId: "station-1",
      name: "tablet",
      mac: "AA:BB:CC:DD:EE:01",
      type: "WIRELESS",
    });
  });
});

describe("cookieHeaderFrom", () => {
  it("keeps only the name=value pair of each Set-Cookie", () => {
    expect(
      cookieHeaderFrom([
        "unifises=abc123; Path=/; Secure; HttpOnly",
        "csrf_token=xyz789; Path=/; Secure",
      ]),
    ).toBe("unifises=abc123; csrf_token=xyz789");
  });

  it("returns null when nothing usable was set", () => {
    expect(cookieHeaderFrom([])).toBeNull();
    expect(cookieHeaderFrom(["garbage"])).toBeNull();
  });
});

describe("loginErrorMessage", () => {
  it("translates api.err.Invalid to a friendly message", () => {
    expect(loginErrorMessage(400, "api.err.Invalid")).toBe("UniFi login failed: invalid credentials");
  });

  it("falls back to the raw msg or HTTP status", () => {
    expect(loginErrorMessage(500, "api.err.ServerBusy")).toBe("UniFi login failed: api.err.ServerBusy");
    expect(loginErrorMessage(502, undefined)).toBe("UniFi login failed: HTTP 502");
  });
});

describe("mockUnifiSnapshot", () => {
  it("returns a complete, error-free demo snapshot", () => {
    const snap = mockUnifiSnapshot();
    expect(snap.errors).toEqual([]);
    expect(snap.wlans.length).toBeGreaterThanOrEqual(2);
    expect(snap.aps.length).toBeGreaterThanOrEqual(1);
    expect(snap.networks.length).toBeGreaterThanOrEqual(2);
    expect(snap.devices.length).toBeGreaterThanOrEqual(1);
    expect(snap.clients.length).toBeGreaterThanOrEqual(1);
    // Mock VLANs must line up with the mock OPNsense interfaces for linking.
    expect(snap.wlans.map((w) => w.vlanId)).toContain(20);
    expect(snap.wlans.map((w) => w.vlanId)).toContain(40);
  });
});
