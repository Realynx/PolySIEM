import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RunContext } from "../registry";

const { provisionContainerMock } = vi.hoisted(() => ({
  provisionContainerMock: vi.fn(),
}));

vi.mock("@/lib/services/provisioning", () => ({
  provisionContainer: provisionContainerMock,
}));

import { proxmoxCreateContainer } from "./provision-container";
import { getAction } from "../registry";

const baseConfig = {
  integrationId: "integration-pve",
  node: "pve1",
  hostname: "app-01",
  template: "local:vztmpl/debian-12-standard.tar.zst",
  rootStorage: "local-lvm",
  diskGiB: 16,
  cores: 2,
  memoryMiB: 2048,
  swapMiB: 512,
  bridge: "vmbr0",
  ipv4Mode: "dhcp" as const,
  unprivileged: true,
  start: true,
  firewall: true,
};

function context(): RunContext {
  return {
    input: {},
    nodeOutputs: {},
    nodeId: "create-container",
    actor: { type: "user", userId: "admin-1" },
    prisma: {} as RunContext["prisma"],
    chain: ["workflow-1"],
    log: () => {},
  };
}

describe("proxmox.create-container workflow action", () => {
  beforeEach(() => {
    provisionContainerMock.mockReset();
    provisionContainerMock.mockResolvedValue({
      integrationId: "integration-pve",
      provider: "PROXMOX",
      inventoryId: "container-row-1",
      vmid: 220,
      node: "pve1",
      hostname: "app-01",
      taskId: "UPID:pve1:0001:create:220",
      started: true,
      syncRunId: "sync-run-1",
    });
  });

  it("publishes only the explicit reviewed provisioning fields", () => {
    expect(proxmoxCreateContainer.meta).toMatchObject({
      kind: "proxmox.create-container",
      category: "proxmox",
    });
    const keys = proxmoxCreateContainer.meta.inputs.map((input) => input.key);
    expect(keys).toEqual([
      "integrationId",
      "node",
      "vmid",
      "hostname",
      "template",
      "rootStorage",
      "diskGiB",
      "cores",
      "memoryMiB",
      "swapMiB",
      "bridge",
      "ipv4Mode",
      "ipv4Address",
      "gateway",
      "vlanTag",
      "sshKeyId",
      "unprivileged",
      "start",
      "firewall",
    ]);
    for (const forbidden of ["url", "path", "method", "payload", "body"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(proxmoxCreateContainer.meta.outputs.map((output) => output.key)).toEqual([
      "inventoryId",
      "vmid",
      "node",
      "hostname",
      "taskId",
      "started",
      "syncRunId",
    ]);
    expect(getAction("proxmox.create-container")).toBe(proxmoxCreateContainer);
  });

  it("rejects arbitrary Proxmox API escape hatches", () => {
    expect(() =>
      proxmoxCreateContainer.configSchema.parse({
        ...baseConfig,
        path: "/api2/json/nodes/pve1/status",
        method: "DELETE",
      }),
    ).toThrow();
  });

  it("enforces coherent static IPv4 settings", () => {
    expect(() =>
      proxmoxCreateContainer.configSchema.parse({
        ...baseConfig,
        ipv4Mode: "static",
      }),
    ).toThrow(/static IPv4 CIDR|gateway/i);
    expect(
      proxmoxCreateContainer.configSchema.parse({
        ...baseConfig,
        ipv4Mode: "static",
        ipv4Address: "10.0.30.50/24",
        gateway: "10.0.30.1",
        vlanTag: 30,
      }),
    ).toMatchObject({
      ipv4Mode: "static",
      ipv4Address: "10.0.30.50/24",
      gateway: "10.0.30.1",
      vlanTag: 30,
    });
  });

  it("delegates to the audited service with the workflow actor", async () => {
    const ctx = context();
    const output = await proxmoxCreateContainer.run({ config: baseConfig, ctx });
    expect(provisionContainerMock).toHaveBeenCalledOnce();
    expect(provisionContainerMock).toHaveBeenCalledWith(
      ctx.actor,
      expect.objectContaining(baseConfig),
    );
    expect(output).toEqual({
      inventoryId: "container-row-1",
      vmid: 220,
      node: "pve1",
      hostname: "app-01",
      taskId: "UPID:pve1:0001:create:220",
      started: true,
      syncRunId: "sync-run-1",
    });
  });

  it("keeps nullable post-sync identifiers in the declared output", async () => {
    provisionContainerMock.mockResolvedValueOnce({
      integrationId: "integration-pve",
      provider: "PROXMOX",
      inventoryId: null,
      vmid: 221,
      node: "pve1",
      hostname: "queued-ct",
      taskId: "UPID:pve1:0002:create:221",
      started: false,
      syncRunId: null,
    });
    await expect(proxmoxCreateContainer.run({ config: { ...baseConfig, hostname: "queued-ct", start: false }, ctx: context() })).resolves.toMatchObject({
      inventoryId: null,
      syncRunId: null,
      started: false,
    });
  });
});
