import { describe, expect, it } from "vitest";
import {
  type ContainerProvisioningOptions,
  genericProvisioningFailure,
  unsupportedContainerSelection,
} from "./provisioning";

const options: ContainerProvisioningOptions = {
  nextVmid: 101,
  templates: [{ id: "local:vztmpl/debian-12.tar.zst", label: "Debian 12" }],
  storages: [{ id: "local-zfs", label: "Local ZFS", availableBytes: 1024 }],
  networks: [{ id: "vmbr0", label: "LAN" }],
};

describe("container provisioning selection validation", () => {
  it("accepts selections advertised by the provider", () => {
    expect(unsupportedContainerSelection(options, {
      template: "local:vztmpl/debian-12.tar.zst",
      rootStorage: "local-zfs",
      bridge: "vmbr0",
    })).toBeNull();
  });

  it.each([
    ["template", { template: "missing", rootStorage: "local-zfs", bridge: "vmbr0" }],
    ["storage", { template: "local:vztmpl/debian-12.tar.zst", rootStorage: "missing", bridge: "vmbr0" }],
    ["network", { template: "local:vztmpl/debian-12.tar.zst", rootStorage: "local-zfs", bridge: "missing" }],
  ] as const)("reports an unsupported %s", (expected, selection) => {
    expect(unsupportedContainerSelection(options, selection)).toBe(expected);
  });
});

describe("generic provisioning failure", () => {
  it("preserves Error messages", () => {
    expect(genericProvisioningFailure(new Error("Connection refused"))).toEqual({
      status: 502,
      code: "provider_error",
      message: "Connection refused",
    });
  });

  it("uses the existing safe fallback for non-Error failures", () => {
    expect(genericProvisioningFailure(null)).toEqual({
      status: 502,
      code: "provider_error",
      message: "The provider request failed",
    });
  });
});
