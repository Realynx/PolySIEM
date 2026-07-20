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
 * Parse a PATCH body with an update schema, then drop keys the client did not
 * send. The update schemas are `createXSchema.partial()`, and zod still applies
 * `.default()` values (e.g. kind, powerState, runtime) for absent keys — which
 * would trip the integration-owned field guard on synced entities.
 */
function parsePatch<S extends { parse: (body: unknown) => object }>(
  schema: S,
  body: unknown,
): ReturnType<S["parse"]> {
  const parsed = schema.parse(body) as Record<string, unknown>;
  const provided = new Set(Object.keys((body ?? {}) as Record<string, unknown>));
  return Object.fromEntries(
    Object.entries(parsed).filter(([key]) => provided.has(key)),
  ) as ReturnType<S["parse"]>;
}

const INVENTORY_ENTITIES: Record<string, EntityHandlers> = {
  hosts: {
    list: (q) => inventory.listDevices(q),
    get: (id) => inventory.getDevice(id),
    create: (actor, body) => inventory.createDevice(actor, createDeviceSchema.parse(body)),
    update: (actor, id, body) => inventory.updateDevice(actor, id, parsePatch(updateDeviceSchema, body)),
    remove: (actor, id) => inventory.deleteDevice(actor, id),
  },
  vms: {
    list: (q) => inventory.listVms(q),
    get: (id) => inventory.getVm(id),
    create: (actor, body) => inventory.createVm(actor, createVmSchema.parse(body)),
    update: (actor, id, body) => inventory.updateVm(actor, id, parsePatch(updateVmSchema, body)),
    remove: (actor, id) => inventory.deleteVm(actor, id),
  },
  containers: {
    list: (q) => inventory.listContainers(q),
    get: (id) => inventory.getContainer(id),
    create: (actor, body) => inventory.createContainer(actor, createContainerSchema.parse(body)),
    update: (actor, id, body) => inventory.updateContainer(actor, id, parsePatch(updateContainerSchema, body)),
    remove: (actor, id) => inventory.deleteContainer(actor, id),
  },
  services: {
    list: (q) => inventory.listServices(q),
    get: (id) => inventory.getService(id),
    create: (actor, body) => inventory.createService(actor, createServiceSchema.parse(body)),
    update: (actor, id, body) => inventory.updateService(actor, id, parsePatch(updateServiceSchema, body)),
    remove: (actor, id) => inventory.deleteService(actor, id),
  },
  networks: {
    list: (q) => inventory.listNetworks(q),
    get: (id) => inventory.getNetwork(id),
    create: (actor, body) => inventory.createNetwork(actor, createNetworkSchema.parse(body)),
    update: (actor, id, body) => inventory.updateNetwork(actor, id, parsePatch(updateNetworkSchema, body)),
    remove: (actor, id) => inventory.deleteNetwork(actor, id),
  },
  ips: {
    list: (q) => inventory.listIps(q),
    get: (id) => inventory.getIp(id),
    create: (actor, body) => inventory.createIp(actor, createIpSchema.parse(body)),
    update: (actor, id, body) => inventory.updateIp(actor, id, parsePatch(updateIpSchema, body)),
    remove: (actor, id) => inventory.deleteIp(actor, id),
  },
  storage: {
    list: (q) => inventory.listStoragePools(q),
    get: (id) => inventory.getStoragePool(id),
    create: (actor, body) => inventory.createStoragePool(actor, createStorageSchema.parse(body)),
    update: (actor, id, body) => inventory.updateStoragePool(actor, id, parsePatch(updateStorageSchema, body)),
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
