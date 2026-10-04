import "server-only";
import { ApiError } from "@/lib/api";
import type { AuditActor } from "@/lib/audit";
import * as inventory from "@/lib/services/inventory";
import {
  createContainerSchema,
  createDeviceSchema,
  createIpSchema,
  createNetworkSchema,
  createServiceSchema,
  createStorageSchema,
  createVmSchema,
  updateContainerSchema,
  updateDeviceSchema,
  updateIpSchema,
  updateNetworkSchema,
  updateServiceSchema,
  updateStorageSchema,
  updateVmSchema,
  type ListQuery,
} from "@/lib/validators/inventory";

/**
 * URL segment → service mapping for /api/inventory/{entity}(/{id}).
 * hosts=Device, vms=VirtualMachine, containers=Container, services=Service,
 * networks=Network, ips=IpAddress, storage=StoragePool.
 */
export interface EntityHandlers {
  list: (query: ListQuery) => Promise<{ items: unknown[]; total: number }>;
  get: (id: string) => Promise<unknown>;
  create: (actor: AuditActor, body: unknown) => Promise<unknown>;
  update: (actor: AuditActor, id: string, body: unknown) => Promise<unknown>;
  remove: (actor: AuditActor, id: string) => Promise<unknown>;
}

/**
 * The `updateXSchema`s are built with `patchSchema`, so a key the client did not
 * send is genuinely absent from the parsed body. That is what keeps a PATCH from
 * tripping the integration-owned-field guard on a synced entity — parsing them
 * with a plain `.partial()` schema would reintroduce `kind`/`powerState`/`runtime`.
 */
const INVENTORY_ENTITIES: Record<string, EntityHandlers> = {
  hosts: {
    list: (q) => inventory.listDevices(q),
    get: (id) => inventory.getDevice(id),
    create: (actor, body) => inventory.createDevice(actor, createDeviceSchema.parse(body)),
    update: (actor, id, body) => inventory.updateDevice(actor, id, updateDeviceSchema.parse(body)),
    remove: (actor, id) => inventory.deleteDevice(actor, id),
  },
  vms: {
    list: (q) => inventory.listVms(q),
    get: (id) => inventory.getVm(id),
    create: (actor, body) => inventory.createVm(actor, createVmSchema.parse(body)),
    update: (actor, id, body) => inventory.updateVm(actor, id, updateVmSchema.parse(body)),
    remove: (actor, id) => inventory.deleteVm(actor, id),
  },
  containers: {
    list: (q) => inventory.listContainers(q),
    get: (id) => inventory.getContainer(id),
    create: (actor, body) => inventory.createContainer(actor, createContainerSchema.parse(body)),
    update: (actor, id, body) => inventory.updateContainer(actor, id, updateContainerSchema.parse(body)),
    remove: (actor, id) => inventory.deleteContainer(actor, id),
  },
  services: {
    list: (q) => inventory.listServices(q),
    get: (id) => inventory.getService(id),
    create: (actor, body) => inventory.createService(actor, createServiceSchema.parse(body)),
    update: (actor, id, body) => inventory.updateService(actor, id, updateServiceSchema.parse(body)),
    remove: (actor, id) => inventory.deleteService(actor, id),
  },
  networks: {
    list: (q) => inventory.listNetworks(q),
    get: (id) => inventory.getNetwork(id),
    create: (actor, body) => inventory.createNetwork(actor, createNetworkSchema.parse(body)),
    update: (actor, id, body) => inventory.updateNetwork(actor, id, updateNetworkSchema.parse(body)),
    remove: (actor, id) => inventory.deleteNetwork(actor, id),
  },
  ips: {
    list: (q) => inventory.listIps(q),
    get: (id) => inventory.getIp(id),
    create: (actor, body) => inventory.createIp(actor, createIpSchema.parse(body)),
    update: (actor, id, body) => inventory.updateIp(actor, id, updateIpSchema.parse(body)),
    remove: (actor, id) => inventory.deleteIp(actor, id),
  },
  storage: {
    list: (q) => inventory.listStoragePools(q),
    get: (id) => inventory.getStoragePool(id),
    create: (actor, body) => inventory.createStoragePool(actor, createStorageSchema.parse(body)),
    update: (actor, id, body) => inventory.updateStoragePool(actor, id, updateStorageSchema.parse(body)),
    remove: (actor, id) => inventory.deleteStoragePool(actor, id),
  },
};

export function resolveEntity(entity: string): EntityHandlers {
  const handlers = INVENTORY_ENTITIES[entity];
  if (!handlers) {
    throw new ApiError(404, "unknown_entity", `Unknown inventory entity "${entity}"`);
  }
  return handlers;
}
