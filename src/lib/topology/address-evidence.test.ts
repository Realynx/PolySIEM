import { describe, expect, it } from "vitest";
import { normalizeMac, resolveObservedAssetAddresses } from "./address-evidence";

describe("cross-integration address evidence", () => {
  it("normalizes common MAC formats", () => {
    expect(normalizeMac("bc-24-11-12-34-56")).toBe("BC:24:11:12:34:56");
    expect(normalizeMac("bc2411123456")).toBe("BC:24:11:12:34:56");
  });

  it("attaches an observation when its MAC has one asset owner", () => {
    expect(
      resolveObservedAssetAddresses(
        [{ ownerId: "vm-1", macAddress: "BC:24:11:12:34:56" }],
        [{
          key: "lease-1",
          address: "10.0.20.15",
          networkId: "net-20",
          macAddress: "bc-24-11-12-34-56",
          source: "dhcp-dynamic",
        }],
      ),
    ).toMatchObject([{ ownerId: "vm-1", address: "10.0.20.15", key: "lease-1" }]);
  });

  it("does not guess when a MAC is shared by several assets", () => {
    expect(
      resolveObservedAssetAddresses(
        [
          { ownerId: "vm-1", macAddress: "BC:24:11:12:34:56" },
          { ownerId: "vm-2", macAddress: "BC:24:11:12:34:56" },
        ],
        [{
          key: "neighbor-1",
          address: "10.0.20.15",
          networkId: "net-20",
          macAddress: "BC:24:11:12:34:56",
          source: "neighbor",
        }],
      ),
    ).toEqual([]);
  });
});
