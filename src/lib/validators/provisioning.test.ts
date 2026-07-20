import { describe, expect, it } from "vitest";
import { provisionContainerSchema } from "./provisioning";

const valid = {
  integrationId: "pve-integration",
  node: "pve1",
  hostname: "app-01",
  template: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
  rootStorage: "local-zfs",
  bridge: "vmbr0",
};

describe("provisionContainerSchema", () => {
  it("applies conservative container defaults", () => {
    expect(provisionContainerSchema.parse(valid)).toMatchObject({
      diskGiB: 8,
      cores: 1,
      memoryMiB: 512,
      swapMiB: 512,
      ipv4Mode: "dhcp",
      unprivileged: true,
      start: true,
      firewall: true,
    });
  });

  it("requires an address and gateway for static IPv4", () => {
    const result = provisionContainerSchema.safeParse({ ...valid, ipv4Mode: "static" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.map((issue) => issue.path[0])).toEqual(["ipv4Address", "gateway"]);
  });

  it("accepts a valid static IPv4 and VLAN", () => {
    expect(
      provisionContainerSchema.safeParse({
        ...valid,
        ipv4Mode: "static",
        ipv4Address: "10.0.20.50/24",
        gateway: "10.0.20.1",
        vlanTag: 20,
      }).success,
    ).toBe(true);
  });

  it.each([
    ["node", "pve1,delete=1"],
    ["rootStorage", "local:8,acl=1"],
    ["bridge", "vmbr0,tag=20"],
    ["template", "https://attacker.invalid/template"],
  ])("rejects injectable %s values", (field, value) => {
    expect(provisionContainerSchema.safeParse({ ...valid, [field]: value }).success).toBe(false);
  });

  it("rejects unknown fields so workflows cannot smuggle raw API options", () => {
    expect(provisionContainerSchema.safeParse({ ...valid, hookscript: "evil" }).success).toBe(false);
  });
});
