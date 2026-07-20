import { z } from "zod";

/** Fields shared by all inventory entities that users may edit. */
const baseEditable = {
  name: z.string().min(1).max(128),
  description: z.string().max(50_000).nullish(),
};

const idRef = z.string().min(1).nullish();

// ---- Device (physical host / hypervisor / appliance) ----
export const deviceKinds = ["server", "hypervisor", "firewall", "switch", "nas", "other"] as const;

export const createDeviceSchema = z.object({
  ...baseEditable,
  kind: z.enum(deviceKinds).default("server"),
  manufacturer: z.string().max(128).nullish(),
  model: z.string().max(128).nullish(),
  location: z.string().max(255).nullish(),
  cpuModel: z.string().max(128).nullish(),
  cpuCores: z.number().int().positive().nullish(),
  memoryBytes: z.coerce.bigint().nonnegative().nullish(),
  osName: z.string().max(128).nullish(),
  osVersion: z.string().max(128).nullish(),
});
export const updateDeviceSchema = createDeviceSchema.partial();
export type CreateDeviceInput = z.infer<typeof createDeviceSchema>;
export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;

// ---- VirtualMachine ----
export const createVmSchema = z.object({
  ...baseEditable,
  hostId: idRef,
  powerState: z.enum(["RUNNING", "STOPPED", "PAUSED", "UNKNOWN"]).default("UNKNOWN"),
  cpuCores: z.number().int().positive().nullish(),
  memoryBytes: z.coerce.bigint().nonnegative().nullish(),
  diskBytes: z.coerce.bigint().nonnegative().nullish(),
  osName: z.string().max(128).nullish(),
});
export const updateVmSchema = createVmSchema.partial();
export type CreateVmInput = z.infer<typeof createVmSchema>;
export type UpdateVmInput = z.infer<typeof updateVmSchema>;

// ---- Container ----
export const createContainerSchema = z.object({
  ...baseEditable,
  runtime: z.enum(["lxc", "docker", "podman"]).default("docker"),
  hostId: idRef,
  vmId: idRef,
  powerState: z.enum(["RUNNING", "STOPPED", "PAUSED", "UNKNOWN"]).default("UNKNOWN"),
  cpuCores: z.number().int().positive().nullish(),
  memoryBytes: z.coerce.bigint().nonnegative().nullish(),
  diskBytes: z.coerce.bigint().nonnegative().nullish(),
  osName: z.string().max(128).nullish(),
});
export const updateContainerSchema = createContainerSchema.partial();
export type CreateContainerInput = z.infer<typeof createContainerSchema>;
export type UpdateContainerInput = z.infer<typeof updateContainerSchema>;

// ---- Network ----
export const createNetworkSchema = z.object({
  ...baseEditable,
  vlanId: z.number().int().min(0).max(4095).nullish(),
  cidr: z.string().regex(/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, "Expected CIDR like 10.0.20.0/24").nullish(),
  gateway: z.ipv4().nullish(),
  domain: z.string().max(255).nullish(),
  purpose: z.string().max(64).nullish(),
});
export const updateNetworkSchema = createNetworkSchema.partial();
export type CreateNetworkInput = z.infer<typeof createNetworkSchema>;
export type UpdateNetworkInput = z.infer<typeof updateNetworkSchema>;

// ---- IpAddress ----
export const createIpSchema = z.object({
  address: z.ipv4(),
  networkId: idRef,
  description: z.string().max(500).nullish(),
});
export const updateIpSchema = createIpSchema.partial();
export type CreateIpInput = z.infer<typeof createIpSchema>;
export type UpdateIpInput = z.infer<typeof updateIpSchema>;

// ---- Service ----
export const createServiceSchema = z.object({
  ...baseEditable,
  url: z
    .url({ protocol: /^https?$/ })
    .nullish()
    .or(z.literal("").transform(() => null)),
  port: z.number().int().min(1).max(65535).nullish(),
  protocol: z.enum(["http", "https", "tcp", "udp"]).nullish(),
  deviceId: idRef,
  vmId: idRef,
  containerId: idRef,
});
export const updateServiceSchema = createServiceSchema.partial();
export type CreateServiceInput = z.infer<typeof createServiceSchema>;
export type UpdateServiceInput = z.infer<typeof updateServiceSchema>;

// ---- StoragePool (manual entries) ----
// Note: StoragePool has no `description` column, so it does not spread baseEditable.
export const createStorageSchema = z.object({
  name: z.string().min(1).max(128),
  type: z.string().max(32).nullish(),
  deviceId: idRef,
  totalBytes: z.coerce.bigint().nonnegative().nullish(),
  usedBytes: z.coerce.bigint().nonnegative().nullish(),
});
export const updateStorageSchema = createStorageSchema.partial();
export type CreateStorageInput = z.infer<typeof createStorageSchema>;
export type UpdateStorageInput = z.infer<typeof updateStorageSchema>;

// ---- Firewall rule annotation (the only user-editable firewall field) ----
export const updateFirewallRuleSchema = z.object({
  annotation: z.string().max(10_000).nullish(),
});
export type UpdateFirewallRuleInput = z.infer<typeof updateFirewallRuleSchema>;

// ---- List query params shared by inventory list endpoints ----
export const listQuerySchema = z.object({
  q: z.string().max(255).optional(),
  source: z.enum(["MANUAL", "PROXMOX", "OPNSENSE", "UNIFI", "CLOUDFLARE", "TAILSCALE", "EDGE_NAT_SERVER"]).optional(),
  status: z.enum(["ACTIVE", "STALE", "REMOVED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
