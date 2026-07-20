import { provisionContainer } from "@/lib/services/provisioning";
import {
  provisionContainerSchema,
  type ProvisionContainerInput,
} from "@/lib/validators/provisioning";
import type { ActionDefinition } from "../registry";

/**
 * proxmox.create-container — deliberately exposes only the reviewed LXC
 * provisioning contract. There is no URL, method, arbitrary API path, or raw
 * Proxmox payload escape hatch in either its catalog metadata or config schema.
 */
export const proxmoxCreateContainer: ActionDefinition = {
  meta: {
    kind: "proxmox.create-container",
    title: "Create Proxmox container",
    description:
      "Creates a Proxmox LXC container from an explicit, validated configuration and records the resulting inventory. Requires a write-capable Proxmox token.",
    category: "proxmox",
    inputs: [
      {
        key: "integrationId",
        label: "Proxmox integration id",
        type: "integration",
        required: true,
        templateable: true,
        placeholder: "Select a Proxmox integration",
        help: "Enabled Proxmox integration used for provisioning.",
      },
      {
        key: "node",
        label: "Target node",
        type: "string",
        required: true,
        placeholder: "pve1",
        help: "Exact Proxmox node name.",
      },
      {
        key: "vmid",
        label: "VMID",
        type: "number",
        required: false,
        templateable: true,
        help: "Optional explicit VMID. Leave empty to allocate the next available cluster id.",
      },
      {
        key: "hostname",
        label: "Hostname",
        type: "string",
        required: true,
        placeholder: "app-01",
      },
      {
        key: "template",
        label: "Template volume",
        type: "string",
        required: true,
        placeholder: "local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst",
        help: "Existing Proxmox LXC template volume id.",
      },
      {
        key: "rootStorage",
        label: "Root storage",
        type: "string",
        required: true,
        placeholder: "local-lvm",
        help: "Proxmox storage id for the root filesystem.",
      },
      {
        key: "diskGiB",
        label: "Root disk (GiB)",
        type: "number",
        required: true,
        templateable: true,
        defaultValue: 8,
      },
      {
        key: "cores",
        label: "CPU cores",
        type: "number",
        required: true,
        templateable: true,
        defaultValue: 1,
      },
      {
        key: "memoryMiB",
        label: "Memory (MiB)",
        type: "number",
        required: true,
        templateable: true,
        defaultValue: 512,
      },
      {
        key: "swapMiB",
        label: "Swap (MiB)",
        type: "number",
        required: true,
        templateable: true,
        defaultValue: 512,
      },
      {
        key: "bridge",
        label: "Network bridge",
        type: "string",
        required: true,
        placeholder: "vmbr0",
      },
      {
        key: "ipv4Mode",
        label: "IPv4 mode",
        type: "select",
        required: false,
        options: [
          { value: "dhcp", label: "DHCP" },
          { value: "static", label: "Static address" },
        ],
        defaultValue: "dhcp",
        help: "Defaults to DHCP when left unset.",
      },
      {
        key: "ipv4Address",
        label: "Static IPv4 CIDR",
        type: "string",
        required: false,
        placeholder: "10.0.30.50/24",
        help: "Required only in static mode; include the prefix length.",
      },
      {
        key: "gateway",
        label: "IPv4 gateway",
        type: "string",
        required: false,
        placeholder: "10.0.30.1",
        help: "Required in static mode; omit for DHCP.",
      },
      {
        key: "vlanTag",
        label: "VLAN tag",
        type: "number",
        required: false,
        templateable: true,
        help: "Optional 802.1Q VLAN id.",
      },
      {
        key: "sshKeyId",
        label: "SSH key id",
        type: "string",
        required: false,
        placeholder: "{{nodes.<nodeId>.sshKeyId}}",
        help: "Optional documented PolySIEM public key to install during creation.",
      },
      {
        key: "unprivileged",
        label: "Unprivileged container",
        type: "boolean",
        required: false,
        defaultValue: true,
        help: "Recommended; defaults on when left unset.",
      },
      {
        key: "start",
        label: "Start after creation",
        type: "boolean",
        required: false,
        defaultValue: true,
        help: "Defaults on when left unset.",
      },
      {
        key: "firewall",
        label: "Enable Proxmox firewall",
        type: "boolean",
        required: false,
        defaultValue: true,
        help: "Defaults on when left unset.",
      },
    ],
    outputs: [
      { key: "inventoryId", label: "Inventory container id" },
      { key: "vmid", label: "Proxmox VMID" },
      { key: "node", label: "Proxmox node" },
      { key: "hostname", label: "Hostname" },
      { key: "taskId", label: "Proxmox task id" },
      { key: "started", label: "Started" },
      { key: "syncRunId", label: "Inventory sync run id" },
    ],
  },
  configSchema: provisionContainerSchema,
  async run({ config, ctx }) {
    const input: ProvisionContainerInput = provisionContainerSchema.parse(config);
    const result = await provisionContainer(ctx.actor, input);
    return {
      inventoryId: result.inventoryId,
      vmid: result.vmid,
      node: result.node,
      hostname: result.hostname,
      taskId: result.taskId,
      started: result.started,
      syncRunId: result.syncRunId,
    };
  },
};
