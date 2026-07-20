import { describe, expect, it } from "vitest";
import * as inventory from "@/lib/services/inventory";

const PUBLIC_INVENTORY_OPERATIONS = [
  "createContainer",
  "createDevice",
  "createIp",
  "createNetwork",
  "createService",
  "createStoragePool",
  "createVm",
  "deleteContainer",
  "deleteDevice",
  "deleteIp",
  "deleteNetwork",
  "deleteService",
  "deleteStoragePool",
  "deleteVm",
  "getContainer",
  "getDevice",
  "getIp",
  "getNetwork",
  "getService",
  "getStoragePool",
  "getVm",
  "listContainers",
  "listDevices",
  "listDhcpLeases",
  "listFirewallAliases",
  "listFirewallRules",
  "listIps",
  "listNetworkNeighbors",
  "listNetworks",
  "listServices",
  "listStoragePools",
  "listVms",
  "updateContainer",
  "updateDevice",
  "updateFirewallRuleAnnotation",
  "updateIp",
  "updateNetwork",
  "updateService",
  "updateStoragePool",
  "updateVm",
] as const;

describe("inventory service facade", () => {
  it("preserves the complete public operation surface", () => {
    expect(Object.keys(inventory).sort()).toEqual(
      [...PUBLIC_INVENTORY_OPERATIONS].sort(),
    );
    for (const operation of PUBLIC_INVENTORY_OPERATIONS) {
      expect(inventory[operation]).toBeTypeOf("function");
    }
  });
});
