import { describe, expect, it } from "vitest";
import { getDriver } from "./index";
import { inventorySyncResult } from "./synchronization";

describe("inventory synchronization capabilities", () => {
  it("advertises synchronization only for inventory-producing drivers", () => {
    expect(getDriver("PROXMOX").inventorySynchronizer).toBeDefined();
    expect(getDriver("OPNSENSE").inventorySynchronizer).toBeDefined();
    expect(getDriver("UNIFI").inventorySynchronizer).toBeDefined();
    expect(getDriver("TAILSCALE").inventorySynchronizer).toBeDefined();
    expect(getDriver("ELASTICSEARCH").inventorySynchronizer).toBeUndefined();
    expect(getDriver("OTX").inventorySynchronizer).toBeUndefined();
  });

  it("creates complete, independent result collections by default", () => {
    const first = inventorySyncResult({}, []);
    const second = inventorySyncResult({}, []);

    first.skipped.push({ feature: "interfaces", missingPrivilege: "read" });
    first.staleSweepExclusions.push("interfaces");

    expect(second.skipped).toEqual([]);
    expect(second.staleSweepExclusions).toEqual([]);
  });
});
