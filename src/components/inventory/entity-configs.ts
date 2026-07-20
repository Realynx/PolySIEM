import { z } from "zod";
import { deviceKinds } from "@/lib/validators/inventory";

/**
 * Config-driven create/edit forms for the seven inventory entities.
 * Form state is kept as strings (react-hook-form friendly); `buildPayload`
 * converts to the JSON shape the API validators expect (empty string → null,
 * GiB inputs → byte strings so `z.coerce.bigint()` accepts them).
 */

export const NONE_VALUE = "__none__";

export type RelationKind = "hosts" | "vms" | "containers" | "networks";

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "number" | "textarea" | "select" | "relation";
  options?: { value: string; label: string }[];
  relation?: RelationKind;
  placeholder?: string;
  /** Convert the raw string before sending. */
  convert?: "int" | "gib";
  /** JSON body key when it differs from the form field name (e.g. memoryGib → memoryBytes). */
  payloadKey?: string;
  /** Still editable when the entity is owned by an integration sync. */
  syncedEditable?: boolean;
  required?: boolean;
  colSpan2?: boolean;
}

export interface EntityConfig {
  /** REST base, e.g. /api/inventory/hosts */
  apiPath: string;
  /** List page, e.g. /inventory/hosts */
  listHref: string;
  singular: string;
  formSchema: z.ZodType;
  fields: FieldDef[];
}

// ---- string-based form schema helpers (server validators re-check everything) ----

const nameField = z.string().trim().min(1, "Name is required").max(128);
const str = (max: number) => z.string().max(max);
const intStr = (min: number, max: number, msg: string) =>
  z
    .string()
    .regex(/^\d*$/, "Must be a whole number")
    .refine((v) => v === "" || (Number(v) >= min && Number(v) <= max), msg);
const gibStr = z.string().regex(/^\d*(\.\d+)?$/, "Must be a number of GiB");
const ipv4Str = z.string().refine((v) => v === "" || z.ipv4().safeParse(v).success, "Invalid IPv4 address");
const urlStr = z.string().refine((v) => v === "" || z.url().safeParse(v).success, "Invalid URL");
const anyStr = z.string();

export type FormValues = Record<string, string>;

export function buildPayload(fields: FieldDef[], values: FormValues, mode: "create" | "edit") {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (values[field.name] ?? "").trim();
    const key = field.payloadKey ?? field.name;
    let value: unknown;
    if (raw === "" || raw === NONE_VALUE) value = null;
    else if (field.convert === "int") value = Number.parseInt(raw, 10);
    else if (field.convert === "gib") value = String(Math.round(Number.parseFloat(raw) * 1024 ** 3));
    else value = raw;
    // On create, omit empty optional fields so schema defaults apply.
    if (mode === "create" && value === null) continue;
    payload[key] = value;
  }
  return payload;
}

/** "1073741824" → "1" (GiB), for pre-filling edit forms. */
export function bytesToGibString(bytes: string | number | bigint | null | undefined): string {
  if (bytes == null || bytes === "") return "";
  const n = Number(bytes) / 1024 ** 3;
  if (!Number.isFinite(n) || n < 0) return "";
  const rounded = Math.round(n * 100) / 100;
  return String(rounded);
}

const powerStateOptions = [
  { value: "RUNNING", label: "Running" },
  { value: "STOPPED", label: "Stopped" },
  { value: "PAUSED", label: "Paused" },
  { value: "UNKNOWN", label: "Unknown" },
];

// ---------------- Hosts (Device) ----------------

export const hostConfig: EntityConfig = {
  apiPath: "/api/inventory/hosts",
  listHref: "/inventory/hosts",
  singular: "host",
  formSchema: z.object({
    name: nameField,
    kind: z.enum(deviceKinds),
    manufacturer: str(128),
    model: str(128),
    location: str(255),
    cpuModel: str(128),
    cpuCores: intStr(1, 4096, "Must be between 1 and 4096"),
    memoryGib: gibStr,
    osName: str(128),
    osVersion: str(128),
    description: str(50_000),
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "pve-01" },
    {
      name: "kind",
      label: "Kind",
      type: "select",
      options: deviceKinds.map((k) => ({ value: k, label: k.charAt(0).toUpperCase() + k.slice(1) })),
    },
    { name: "manufacturer", label: "Manufacturer", type: "text", placeholder: "Supermicro" },
    { name: "model", label: "Model", type: "text", placeholder: "X11SCL-F" },
    { name: "location", label: "Location", type: "text", placeholder: "Rack 1, U4", syncedEditable: true },
    { name: "cpuModel", label: "CPU model", type: "text", placeholder: "Intel Xeon E-2278G" },
    { name: "cpuCores", label: "CPU cores", type: "number", convert: "int" },
    { name: "memoryGib", label: "Memory (GiB)", type: "number", convert: "gib", payloadKey: "memoryBytes" },
    { name: "osName", label: "OS", type: "text", placeholder: "Proxmox VE" },
    { name: "osVersion", label: "OS version", type: "text", placeholder: "8.2" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Markdown supported…",
    },
  ],
};

// ---------------- Virtual machines ----------------

export const vmConfig: EntityConfig = {
  apiPath: "/api/inventory/vms",
  listHref: "/inventory/vms",
  singular: "virtual machine",
  formSchema: z.object({
    name: nameField,
    hostId: anyStr,
    powerState: anyStr,
    cpuCores: intStr(1, 4096, "Must be between 1 and 4096"),
    memoryGib: gibStr,
    diskGib: gibStr,
    osName: str(128),
    description: str(50_000),
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "vault" },
    { name: "hostId", label: "Host", type: "relation", relation: "hosts" },
    { name: "powerState", label: "Power state", type: "select", options: powerStateOptions },
    { name: "cpuCores", label: "vCPU cores", type: "number", convert: "int" },
    { name: "memoryGib", label: "Memory (GiB)", type: "number", convert: "gib", payloadKey: "memoryBytes" },
    { name: "diskGib", label: "Disk (GiB)", type: "number", convert: "gib", payloadKey: "diskBytes" },
    { name: "osName", label: "OS", type: "text", placeholder: "Debian 12" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Markdown supported…",
    },
  ],
};

// ---------------- Containers ----------------

export const containerConfig: EntityConfig = {
  apiPath: "/api/inventory/containers",
  listHref: "/inventory/containers",
  singular: "container",
  formSchema: z.object({
    name: nameField,
    runtime: anyStr,
    hostId: anyStr,
    vmId: anyStr,
    powerState: anyStr,
    cpuCores: intStr(1, 4096, "Must be between 1 and 4096"),
    memoryGib: gibStr,
    diskGib: gibStr,
    osName: str(128),
    description: str(50_000),
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "grafana" },
    {
      name: "runtime",
      label: "Runtime",
      type: "select",
      options: [
        { value: "docker", label: "Docker" },
        { value: "lxc", label: "LXC" },
        { value: "podman", label: "Podman" },
      ],
    },
    { name: "hostId", label: "Host", type: "relation", relation: "hosts" },
    { name: "vmId", label: "Runs on VM", type: "relation", relation: "vms" },
    { name: "powerState", label: "Power state", type: "select", options: powerStateOptions },
    { name: "cpuCores", label: "CPU cores", type: "number", convert: "int" },
    { name: "memoryGib", label: "Memory (GiB)", type: "number", convert: "gib", payloadKey: "memoryBytes" },
    { name: "diskGib", label: "Disk (GiB)", type: "number", convert: "gib", payloadKey: "diskBytes" },
    { name: "osName", label: "OS / image", type: "text", placeholder: "alpine:3.20" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Markdown supported…",
    },
  ],
};

// ---------------- Services ----------------

export const serviceConfig: EntityConfig = {
  apiPath: "/api/inventory/services",
  listHref: "/inventory/services",
  singular: "service",
  formSchema: z.object({
    name: nameField,
    url: urlStr,
    port: intStr(1, 65535, "Must be between 1 and 65535"),
    protocol: anyStr,
    deviceId: anyStr,
    vmId: anyStr,
    containerId: anyStr,
    description: str(50_000),
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "Grafana" },
    { name: "url", label: "URL", type: "text", placeholder: "https://grafana.lab.example", colSpan2: true },
    { name: "port", label: "Port", type: "number", convert: "int" },
    {
      name: "protocol",
      label: "Protocol",
      type: "select",
      options: [
        { value: NONE_VALUE, label: "—" },
        { value: "http", label: "HTTP" },
        { value: "https", label: "HTTPS" },
        { value: "tcp", label: "TCP" },
        { value: "udp", label: "UDP" },
      ],
    },
    { name: "deviceId", label: "Host", type: "relation", relation: "hosts" },
    { name: "vmId", label: "VM", type: "relation", relation: "vms" },
    { name: "containerId", label: "Container", type: "relation", relation: "containers" },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Markdown supported…",
    },
  ],
};

// ---------------- Networks ----------------

export const networkConfig: EntityConfig = {
  apiPath: "/api/inventory/networks",
  listHref: "/network",
  singular: "network",
  formSchema: z.object({
    name: nameField,
    vlanId: intStr(0, 4095, "Must be between 0 and 4095"),
    cidr: z
      .string()
      .refine((v) => v === "" || /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(v), "Expected CIDR like 10.0.20.0/24"),
    gateway: ipv4Str,
    domain: str(255),
    purpose: str(64),
    description: str(50_000),
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "LAN" },
    { name: "vlanId", label: "VLAN ID", type: "number", convert: "int" },
    { name: "cidr", label: "CIDR", type: "text", placeholder: "10.0.20.0/24" },
    { name: "gateway", label: "Gateway", type: "text", placeholder: "10.0.20.1" },
    { name: "domain", label: "Domain", type: "text", placeholder: "lab.example" },
    { name: "purpose", label: "Purpose", type: "text", placeholder: "Trusted clients", syncedEditable: true },
    {
      name: "description",
      label: "Description",
      type: "textarea",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Markdown supported…",
    },
  ],
};

// ---------------- IP addresses ----------------

export const ipConfig: EntityConfig = {
  apiPath: "/api/inventory/ips",
  listHref: "/network/ips",
  singular: "IP address",
  formSchema: z.object({
    address: z.string().min(1, "Address is required").refine((v) => z.ipv4().safeParse(v).success, "Invalid IPv4 address"),
    networkId: anyStr,
    description: str(500),
  }),
  fields: [
    { name: "address", label: "Address", type: "text", required: true, placeholder: "10.0.20.15" },
    { name: "networkId", label: "Network", type: "relation", relation: "networks" },
    {
      name: "description",
      label: "Description",
      type: "text",
      colSpan2: true,
      syncedEditable: true,
      placeholder: "Reserved for…",
    },
  ],
};

// ---------------- Storage pools ----------------

export const storageConfig: EntityConfig = {
  apiPath: "/api/inventory/storage",
  listHref: "/inventory/storage",
  singular: "storage pool",
  formSchema: z.object({
    name: nameField,
    type: str(32),
    deviceId: anyStr,
    totalGib: gibStr,
    usedGib: gibStr,
  }),
  fields: [
    { name: "name", label: "Name", type: "text", required: true, placeholder: "tank" },
    { name: "type", label: "Type", type: "text", placeholder: "zfs, lvm, dir, nfs, cifs" },
    { name: "deviceId", label: "Host", type: "relation", relation: "hosts" },
    { name: "totalGib", label: "Total size (GiB)", type: "number", convert: "gib", payloadKey: "totalBytes" },
    { name: "usedGib", label: "Used (GiB)", type: "number", convert: "gib", payloadKey: "usedBytes" },
  ],
};

/**
 * Registry keyed by API entity segment. Server pages pass the KEY (a plain
 * string, safe across the RSC boundary) and client components resolve the
 * config locally — zod schemas contain functions and cannot travel as props.
 */
export const ENTITY_CONFIGS = {
  hosts: hostConfig,
  vms: vmConfig,
  containers: containerConfig,
  services: serviceConfig,
  networks: networkConfig,
  ips: ipConfig,
  storage: storageConfig,
} as const;

export type EntityKey = keyof typeof ENTITY_CONFIGS;
