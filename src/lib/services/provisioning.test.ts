import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  prisma: {
    integrationConfig: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    sshKey: { findUnique: vi.fn() },
    container: { findUnique: vi.fn() },
    sshKeyDeployment: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
  audit: vi.fn(),
  getDriver: vi.fn(),
  toDriverConfig: vi.fn(),
  runSync: vi.fn(),
  provisioner: {
    translateFailure: vi.fn(),
    listNodes: vi.fn(),
    getOptions: vi.fn(),
    create: vi.fn(),
    wait: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("@/lib/integrations", () => ({
  getDriver: mocks.getDriver,
  toDriverConfig: mocks.toDriverConfig,
}));
vi.mock("@/lib/integrations/engine", () => ({ runSync: mocks.runSync }));

import {
  listContainerProvisioningTargets,
  provisionContainer,
} from "./provisioning";

const integration = {
  id: "pve-1",
  type: "PROXMOX" as const,
  name: "Primary PVE",
  enabled: true,
};

const config = {
  id: integration.id,
  type: integration.type,
  name: integration.name,
  baseUrl: "https://pve.example:8006",
  credentials: {},
  verifyTls: true,
  settings: {},
};

const options = {
  nextVmid: 321,
  templates: [
    {
      id: "local:vztmpl/debian-12.tar.zst",
      label: "Debian 12",
    },
  ],
  storages: [
    { id: "local-zfs", label: "Local ZFS", availableBytes: 1024 },
  ],
  networks: [{ id: "vmbr0", label: "LAN" }],
};

const input = {
  integrationId: integration.id,
  node: "pve1",
  hostname: "app-01",
  template: options.templates[0].id,
  rootStorage: options.storages[0].id,
  diskGiB: 8,
  cores: 2,
  memoryMiB: 1024,
  swapMiB: 256,
  bridge: options.networks[0].id,
  ipv4Mode: "dhcp" as const,
  unprivileged: true,
  start: true,
  firewall: true,
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getDriver.mockImplementation((type: string) =>
    type === "PROXMOX"
      ? { containerProvisioner: mocks.provisioner }
      : {},
  );
  mocks.toDriverConfig.mockReturnValue(config);
  mocks.prisma.integrationConfig.findUnique.mockResolvedValue(integration);
  mocks.provisioner.listNodes.mockResolvedValue([
    { id: "pve1", label: "pve1", online: true },
  ]);
  mocks.provisioner.getOptions.mockResolvedValue(options);
  mocks.provisioner.create.mockResolvedValue({
    id: "UPID:pve1:task",
    node: "pve1",
    vmid: 321,
  });
  mocks.provisioner.wait.mockResolvedValue(undefined);
  mocks.runSync.mockResolvedValue({ runId: "sync-1" });
  mocks.prisma.container.findUnique.mockResolvedValue({ id: "container-1" });
  mocks.audit.mockResolvedValue(undefined);
});

describe("container provisioning capability selection", () => {
  it("queries only integrations whose driver advertises the capability", async () => {
    mocks.prisma.integrationConfig.findMany.mockResolvedValue([
      integration,
      {
        id: "elastic-1",
        type: "ELASTICSEARCH",
        name: "Logs",
        enabled: true,
      },
    ]);

    await expect(listContainerProvisioningTargets()).resolves.toEqual([
      {
        integrationId: integration.id,
        integrationName: integration.name,
        provider: "PROXMOX",
        nodes: [{ id: "pve1", label: "pve1", online: true }],
        error: null,
      },
    ]);
    expect(mocks.provisioner.listNodes).toHaveBeenCalledOnce();
    expect(mocks.provisioner.listNodes).toHaveBeenCalledWith(config);
  });
});

describe("provisionContainer orchestration", () => {
  it("creates, waits, syncs, reconciles inventory, and audits both phases", async () => {
    const events: string[] = [];
    mocks.provisioner.listNodes.mockImplementation(async () => {
      events.push("list-nodes");
      return [{ id: "pve1", label: "pve1", online: true }];
    });
    mocks.provisioner.getOptions.mockImplementation(async () => {
      events.push("get-options");
      return options;
    });
    mocks.provisioner.create.mockImplementation(async () => {
      events.push("create");
      return { id: "UPID:pve1:task", node: "pve1", vmid: 321 };
    });
    mocks.provisioner.wait.mockImplementation(async () => {
      events.push("wait");
    });
    mocks.runSync.mockImplementation(async () => {
      events.push("sync");
      return { runId: "sync-1" };
    });
    mocks.prisma.container.findUnique.mockImplementation(async () => {
      events.push("reconcile");
      return { id: "container-1" };
    });
    mocks.audit.mockImplementation(async (_actor, action: string) => {
      events.push(action);
    });

    await expect(
      provisionContainer({ type: "user", userId: "user-1" }, input),
    ).resolves.toEqual({
      integrationId: integration.id,
      provider: "PROXMOX",
      inventoryId: "container-1",
      vmid: 321,
      node: "pve1",
      hostname: "app-01",
      taskId: "UPID:pve1:task",
      started: true,
      syncRunId: "sync-1",
    });

    expect(mocks.provisioner.create).toHaveBeenCalledWith(config, {
      node: "pve1",
      vmid: 321,
      hostname: "app-01",
      template: "local:vztmpl/debian-12.tar.zst",
      rootStorage: "local-zfs",
      diskGiB: 8,
      cores: 2,
      memoryMiB: 1024,
      swapMiB: 256,
      bridge: "vmbr0",
      ipv4Mode: "dhcp",
      unprivileged: true,
      start: true,
      firewall: true,
    });
    expect(mocks.provisioner.wait).toHaveBeenCalledWith(config, {
      id: "UPID:pve1:task",
      node: "pve1",
      vmid: 321,
    });
    expect(mocks.runSync).toHaveBeenCalledWith(
      integration.id,
      "manual",
      { type: "user", userId: "user-1" },
    );
    expect(mocks.prisma.container.findUnique).toHaveBeenCalledWith({
      where: {
        integrationId_externalId: {
          integrationId: integration.id,
          externalId: "lxc/321@pve1",
        },
      },
      select: { id: true },
    });
    expect(mocks.audit).toHaveBeenCalledTimes(2);
    expect(events).toEqual([
      "list-nodes",
      "get-options",
      "create",
      "provision.container_requested",
      "wait",
      "sync",
      "reconcile",
      "provision.container_completed",
    ]);
  });

  it("passes intentional ApiErrors through unchanged", async () => {
    const error = new ApiError(409, "node_busy", "Provider node is busy");
    mocks.provisioner.listNodes.mockRejectedValue(error);

    await expect(
      provisionContainer({ type: "user", userId: "user-1" }, input),
    ).rejects.toBe(error);
    expect(mocks.provisioner.translateFailure).not.toHaveBeenCalled();
  });

  it("uses the selected provider's failure translation", async () => {
    const upstream = new Error("provider unavailable");
    mocks.provisioner.listNodes.mockRejectedValue(upstream);
    mocks.provisioner.translateFailure.mockReturnValue({
      status: 503,
      code: "provider_unavailable",
      message: "The selected provider is unavailable",
    });

    const promise = provisionContainer(
      { type: "user", userId: "user-1" },
      input,
    );
    await expect(promise).rejects.toMatchObject({
      status: 503,
      code: "provider_unavailable",
      message: "The selected provider is unavailable",
    });
    expect(mocks.provisioner.translateFailure).toHaveBeenCalledWith(upstream);
  });
});
