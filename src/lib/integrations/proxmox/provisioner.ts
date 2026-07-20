import { isMock } from "../types";
import {
  genericProvisioningFailure,
  type ContainerProvisioner,
  type ProvisioningFailure,
} from "../provisioning";
import { HttpError } from "../http";

export function translateProxmoxProvisioningFailure(
  error: unknown,
): ProvisioningFailure {
  if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
    return {
      status: 403,
      code: "provider_permission",
      message:
        "The Proxmox API token is read-only or lacks container provisioning permissions. " +
        "Use a dedicated token with VM.Allocate, VM.Config.*, Datastore.AllocateSpace, and the required audit permissions on only the intended pool, node, storage, and bridge.",
    };
  }
  if (error instanceof HttpError) {
    return {
      status: 502,
      code: "provider_error",
      message: `Proxmox rejected the request (HTTP ${error.status})`,
    };
  }
  return genericProvisioningFailure(error);
}

export const proxmoxContainerProvisioner: ContainerProvisioner = {
  translateFailure: translateProxmoxProvisioningFailure,

  async listNodes(cfg) {
    if (isMock(cfg)) {
      const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
      return generateDemoScenarioFromUrl(cfg.baseUrl).proxmox.nodes.map((node) => ({
        id: node.name,
        label: node.name,
        online: node.status === "online",
      }));
    }
    const { listPveProvisioningNodes } = await import("./client");
    return (await listPveProvisioningNodes(cfg)).map((node) => ({ ...node, label: node.id }));
  },

  async getOptions(cfg, node) {
    if (isMock(cfg)) {
      const { generateDemoScenarioFromUrl } = await import("@/lib/demo/scenario");
      const snapshot = generateDemoScenarioFromUrl(cfg.baseUrl).proxmox;
      const selected = snapshot.nodes.find((item) => item.name === node);
      if (!selected) throw new Error(`Demo Proxmox node “${node}” was not found`);
      const { mockProvisionedContainers } = await import("./mock");
      const usedIds = [...snapshot.guests, ...mockProvisionedContainers(cfg.id)].map((guest) => guest.vmid);
      const storages = snapshot.storage
        .filter((item) => item.node === node && item.content?.split(",").includes("rootdir"))
        .map((item) => ({
          id: item.name,
          label: item.name,
          availableBytes:
            item.totalBytes !== null && item.usedBytes !== null
              ? Number(item.totalBytes - item.usedBytes)
              : null,
        }));
      return {
        nextVmid: Math.max(100, ...usedIds) + 1,
        storages,
        templates: [
          { id: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst", label: "Debian 12 standard" },
          { id: "local:vztmpl/ubuntu-24.04-standard_24.04-2_amd64.tar.zst", label: "Ubuntu 24.04 standard" },
          { id: "local:vztmpl/alpine-3.20-default_20240908_amd64.tar.xz", label: "Alpine 3.20 default" },
        ],
        networks: selected.interfaces
          .filter((item) => item.type === "bridge")
          .map((item) => ({ id: item.name, label: item.name })),
      };
    }
    const { getPveContainerOptions } = await import("./client");
    const options = await getPveContainerOptions(cfg, node);
    return {
      ...options,
      storages: options.storages.map((item) => ({ ...item, label: item.id })),
      networks: options.networks.map((item) => ({ ...item, label: item.id })),
    };
  },

  async create(cfg, input) {
    const vmid = input.vmid;
    if (vmid === undefined) throw new Error("A VMID must be resolved before container creation");
    if (isMock(cfg)) {
      const GiB = 1024 ** 3;
      const MiB = 1024 ** 2;
      const { mockCreateContainer } = await import("./mock");
      mockCreateContainer(cfg.id, {
        kind: "lxc",
        node: input.node,
        vmid,
        name: input.hostname,
        status: input.start ? "running" : "stopped",
        cpuCores: input.cores,
        memoryBytes: BigInt(input.memoryMiB * MiB),
        diskBytes: BigInt(input.diskGiB * GiB),
        osName: input.template.split("/").at(-1)?.split("-").slice(0, 2).join(" ") ?? null,
        description: "Provisioned by PolySIEM (demo)",
        nics: [
          {
            name: "net0",
            mac: null,
            bridge: input.bridge,
            vlanTag: input.vlanTag ?? null,
            ip: input.ipv4Mode === "static" ? (input.ipv4Address?.split("/")[0] ?? null) : null,
          },
        ],
        firewall: input.firewall ? { enabled: true, policyIn: null, groups: [], rules: [] } : null,
      });
      return { id: `mock:${cfg.id}:${vmid}`, node: input.node, vmid };
    }
    const { createPveContainer } = await import("./client");
    const id = await createPveContainer(cfg, { ...input, vmid });
    return { id, node: input.node, vmid };
  },

  async wait(cfg, task) {
    if (isMock(cfg)) return;
    const { waitForPveTask } = await import("./client");
    await waitForPveTask(cfg, task.node, task.id);
  },
};
