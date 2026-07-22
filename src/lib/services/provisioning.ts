import "server-only";
import type { IntegrationType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { getDriver, toDriverConfig } from "@/lib/integrations";
import {
  unsupportedContainerSelection,
  type ContainerCreateRequest,
  type ContainerProvisioner,
  type ContainerProvisioningOptions,
} from "@/lib/integrations/provisioning";
import { runSync } from "@/lib/integrations/engine";
import {
  provisionContainerSchema,
  type ProvisionContainerInput,
} from "@/lib/validators/provisioning";

export interface ProvisioningTarget {
  integrationId: string;
  integrationName: string;
  provider: IntegrationType;
  nodes: { id: string; label: string; online: boolean }[];
  error: string | null;
}

export interface ProvisionContainerResult {
  integrationId: string;
  provider: IntegrationType;
  inventoryId: string | null;
  vmid: number;
  node: string;
  hostname: string;
  taskId: string;
  started: boolean;
  syncRunId: string | null;
}

function friendlyProvisioningError(
  provisioner: ContainerProvisioner,
  err: unknown,
): never {
  if (err instanceof ApiError) throw err;
  const failure = provisioner.translateFailure(err);
  throw new ApiError(failure.status, failure.code, failure.message);
}

function createRequest(
  input: ProvisionContainerInput,
  vmid: number,
  publicKey?: string,
): ContainerCreateRequest {
  return {
    node: input.node,
    vmid,
    hostname: input.hostname,
    template: input.template,
    rootStorage: input.rootStorage,
    diskGiB: input.diskGiB,
    cores: input.cores,
    memoryMiB: input.memoryMiB,
    swapMiB: input.swapMiB,
    bridge: input.bridge,
    ipv4Mode: input.ipv4Mode,
    ...(input.ipv4Address ? { ipv4Address: input.ipv4Address } : {}),
    ...(input.gateway ? { gateway: input.gateway } : {}),
    ...(input.vlanTag !== undefined ? { vlanTag: input.vlanTag } : {}),
    ...(publicKey ? { publicKey } : {}),
    unprivileged: input.unprivileged,
    start: input.start,
    firewall: input.firewall,
  };
}

async function getProvisioningIntegration(id: string) {
  const integration = await prisma.integrationConfig.findUnique({ where: { id } });
  if (!integration) throw new ApiError(404, "not_found", "Integration not found");
  if (!integration.enabled) throw new ApiError(409, "integration_disabled", "That integration is disabled");
  const driver = getDriver(integration.type);
  if (!driver.containerProvisioner) {
    throw new ApiError(422, "unsupported", `${integration.type} does not support container provisioning`);
  }
  return { integration, provisioner: driver.containerProvisioner, cfg: toDriverConfig(integration) };
}

/** Integration capabilities are discovered from drivers, not hard-coded in the UI. */
export async function listContainerProvisioningTargets(): Promise<ProvisioningTarget[]> {
  const integrations = await prisma.integrationConfig.findMany({
    where: { enabled: true },
    orderBy: [{ type: "asc" }, { name: "asc" }],
  });
  const targets = await Promise.all(
    integrations.flatMap((integration) => {
      const provisioner = getDriver(integration.type).containerProvisioner;
      if (!provisioner) return [];
      return [
        (async (): Promise<ProvisioningTarget> => {
          try {
            const nodes = await provisioner.listNodes(toDriverConfig(integration));
            return {
              integrationId: integration.id,
              integrationName: integration.name,
              provider: integration.type,
              nodes,
              error: null,
            };
          } catch (err) {
            return {
              integrationId: integration.id,
              integrationName: integration.name,
              provider: integration.type,
              nodes: [],
              error: err instanceof Error ? err.message : "Could not query provider nodes",
            };
          }
        })(),
      ];
    }),
  );
  return targets;
}

export async function getContainerProvisioningOptions(
  integrationId: string,
  node: string,
): Promise<ContainerProvisioningOptions> {
  const { provisioner, cfg } = await getProvisioningIntegration(integrationId);
  try {
    const nodes = await provisioner.listNodes(cfg);
    if (!nodes.some((item) => item.id === node)) throw new ApiError(404, "node_not_found", "Provider node not found");
    return await provisioner.getOptions(cfg, node);
  } catch (err) {
    friendlyProvisioningError(provisioner, err);
  }
}

async function provisioningPublicKey(sshKeyId: string | undefined): Promise<string | undefined> {
  if (!sshKeyId) return undefined;
  const key = await prisma.sshKey.findUnique({ where: { id: sshKeyId } });
  if (!key) throw new ApiError(404, "ssh_key_not_found", "SSH key not found");
  return key.publicKey;
}

function validateContainerSelection(
  options: ContainerProvisioningOptions,
  input: ProvisionContainerInput,
): void {
  const unsupported = unsupportedContainerSelection(options, input);
  const errors = {
    template: ["template_not_found", "That template is not available on the selected node"],
    storage: ["storage_not_found", "That storage cannot hold container root disks"],
    network: ["network_not_found", "That bridge is not available on the selected node"],
  } as const;
  if (unsupported) {
    const [code, message] = errors[unsupported];
    throw new ApiError(422, code, message);
  }
}

/** Create one container, wait for the provider task, sync it, and audit both phases. */
export async function provisionContainer(
  actor: AuditActor,
  rawInput: ProvisionContainerInput,
): Promise<ProvisionContainerResult> {
  const input = provisionContainerSchema.parse(rawInput);
  const { integration, provisioner, cfg } = await getProvisioningIntegration(input.integrationId);
  const publicKey = await provisioningPublicKey(input.sshKeyId);

  try {
    const nodes = await provisioner.listNodes(cfg);
    const node = nodes.find((item) => item.id === input.node);
    if (!node) throw new ApiError(404, "node_not_found", "Provider node not found");
    if (!node.online) throw new ApiError(409, "node_offline", `Provider node “${node.label}” is offline`);
    const options = await provisioner.getOptions(cfg, input.node);
    validateContainerSelection(options, input);
    const vmid = input.vmid ?? options.nextVmid;
    const task = await provisioner.create(cfg, createRequest(input, vmid, publicKey));
    await audit(actor, "provision.container_requested", { type: "integration", id: integration.id }, {
      provider: integration.type,
      node: input.node,
      vmid,
      hostname: input.hostname,
      taskId: task.id,
      template: input.template,
      rootStorage: input.rootStorage,
      bridge: input.bridge,
      sshKeyId: input.sshKeyId ?? null,
    });
    await provisioner.wait(cfg, task);

    const { runId } = await runSync(integration.id, "manual", actor);
    const container = await prisma.container.findUnique({
      where: { integrationId_externalId: { integrationId: integration.id, externalId: `lxc/${vmid}@${input.node}` } },
      select: { id: true },
    });
    if (container && input.sshKeyId) {
      const existingDeployment = await prisma.sshKeyDeployment.findFirst({
        where: {
          sshKeyId: input.sshKeyId,
          containerId: container.id,
          username: "root",
          method: "proxmox-lxc-create",
        },
      });
      if (!existingDeployment) {
        await prisma.sshKeyDeployment.create({
          data: {
            sshKeyId: input.sshKeyId,
            entityType: "container",
            containerId: container.id,
            username: "root",
            method: "proxmox-lxc-create",
            notes: `Injected while creating ${input.node}/lxc/${vmid}`,
          },
        });
      }
    }
    await audit(actor, "provision.container_completed", { type: "integration", id: integration.id }, {
      provider: integration.type,
      node: input.node,
      vmid,
      hostname: input.hostname,
      taskId: task.id,
      inventoryId: container?.id ?? null,
      syncRunId: runId,
    });
    return {
      integrationId: integration.id,
      provider: integration.type,
      inventoryId: container?.id ?? null,
      vmid,
      node: input.node,
      hostname: input.hostname,
      taskId: task.id,
      started: input.start,
      syncRunId: runId,
    };
  } catch (err) {
    friendlyProvisioningError(provisioner, err);
  }
}
