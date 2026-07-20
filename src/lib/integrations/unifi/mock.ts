import type {
  UnifiApDevice,
  UnifiClient,
  UnifiManagedDevice,
  UnifiNetwork,
  UnifiSnapshot,
  UnifiWlan,
} from "./sync";

export const MOCK_UNIFI_VERSION = "8.3.32 (demo)";

/** VLANs line up with the mock OPNsense interfaces (IOT=20, GUEST=40) for cross-linking. */
const NETWORKS: UnifiNetwork[] = [
  { externalId: "64f0aa10c3d4e5f601000001", siteId: "default", name: "Default", vlanId: null, cidr: "10.0.10.0/24", gateway: "10.0.10.1", enabled: true, management: "GATEWAY" },
  { externalId: "64f0aa10c3d4e5f601000002", siteId: "default", name: "IOT", vlanId: 20, cidr: "10.0.20.0/24", gateway: "10.0.20.1", enabled: true, management: "GATEWAY" },
  { externalId: "64f0aa10c3d4e5f601000003", siteId: "default", name: "Guest", vlanId: 40, cidr: "10.0.40.0/24", gateway: "10.0.40.1", enabled: true, management: "GATEWAY" },
];

const WLANS: UnifiWlan[] = [
  {
    externalId: "64f0ab20c3d4e5f601000101",
    name: "FoxNet",
    enabled: true,
    security: "wpa-psk",
    wpaMode: "wpa3-transition",
    band: "both",
    hidden: false,
    isGuest: false,
    vlanId: null,
    networkExternalId: "64f0aa10c3d4e5f601000001",
    apCount: 2,
  },
  {
    externalId: "64f0ab20c3d4e5f601000102",
    name: "FoxNet-IoT",
    enabled: true,
    security: "wpa-psk",
    wpaMode: "wpa2",
    band: "2g",
    hidden: true,
    isGuest: false,
    vlanId: 20,
    networkExternalId: "64f0aa10c3d4e5f601000002",
    apCount: 2,
  },
  {
    externalId: "64f0ab20c3d4e5f601000103",
    name: "FoxNet-Guest",
    enabled: true,
    security: "wpa-psk",
    wpaMode: "wpa2",
    band: "both",
    hidden: false,
    isGuest: true,
    vlanId: 40,
    networkExternalId: "64f0aa10c3d4e5f601000003",
    apCount: 1,
  },
];

const APS: UnifiApDevice[] = [
  {
    externalId: "64f0ac30c3d4e5f601000201",
    name: "AP Living Room",
    model: "UAL6",
    mac: "78:45:58:AA:10:01",
    ip: "10.0.10.70",
    adopted: true,
    state: "online",
    version: "6.7.31.15618",
  },
  {
    externalId: "64f0ac30c3d4e5f601000202",
    name: "AP Office",
    model: "U6P",
    mac: "78:45:58:AA:10:02",
    ip: "10.0.10.71",
    adopted: true,
    state: "offline",
    version: "6.7.31.15618",
  },
];

const DEVICES: UnifiManagedDevice[] = APS.map((ap) => ({
  externalId: ap.externalId,
  siteId: "default",
  name: ap.name,
  model: ap.model,
  mac: ap.mac,
  ip: ap.ip,
  state: ap.state ?? "unknown",
  version: ap.version,
  features: ["accessPoint"],
  interfaces: ["radios"],
  isAccessPoint: true,
  kind: "device",
}));

const CLIENTS: UnifiClient[] = [
  { externalId: "default/client-thermostat", siteId: "default", name: "hall-thermostat", mac: "A4:CF:12:10:20:31", ip: "10.0.20.31", type: "WIRELESS", connectedAt: null, accessType: "STANDARD", authorized: true },
  { externalId: "default/client-guest", siteId: "default", name: "guest-phone", mac: "A4:CF:12:10:40:61", ip: "10.0.40.61", type: "WIRELESS", connectedAt: null, accessType: "GUEST", authorized: true },
];

/** Deterministic demo controller: 3 networks, 3 SSIDs, 2 APs. */
export function mockUnifiSnapshot(): UnifiSnapshot {
  return {
    schemaVersion: 2,
    apiMode: "mock",
    capturedAt: "2026-01-01T00:00:00.000Z",
    controllerVersion: MOCK_UNIFI_VERSION,
    sites: [{ id: "default", internalReference: "default", name: "Default" }],
    wlans: WLANS,
    aps: APS,
    networks: NETWORKS,
    devices: DEVICES,
    clients: CLIENTS,
    errors: [],
    skippedFamilies: [],
  };
}
