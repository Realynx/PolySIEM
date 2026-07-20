import { z } from "zod";

function isIpv4(value: string): boolean {
  const parts = value.split(".");
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const octet = Number(part);
    return octet >= 0 && octet <= 255 && String(octet) === part;
  });
}

function isIpv4Cidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split("/");
  if (rest.length > 0 || !address || !prefix || !isIpv4(address)) return false;
  const bits = Number(prefix);
  return Number.isInteger(bits) && bits >= 0 && bits <= 32 && String(bits) === prefix;
}

const pveName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/, "Use a valid Proxmox resource name");
const providerTemplateId = z
  .string()
  .trim()
  .min(3)
  .max(256)
  .regex(
    /^[A-Za-z0-9_.-]+:[A-Za-z0-9_.+-]+\/[A-Za-z0-9_.+/-]+$/,
    "Use a valid provider template volume ID",
  );

/** Safe, explicit container-creation surface shared by the UI and workflows. */
export const provisionContainerSchema = z
  .object({
    integrationId: z.string().trim().min(1),
    node: pveName,
    vmid: z.number().int().min(100).max(999_999_999).optional(),
    hostname: z
      .string()
      .trim()
      .min(1)
      .max(63)
      .regex(/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/, "Use a valid single-label hostname"),
    template: providerTemplateId,
    rootStorage: pveName,
    diskGiB: z.number().int().min(1).max(16_384).default(8),
    cores: z.number().int().min(1).max(256).default(1),
    memoryMiB: z.number().int().min(64).max(1_048_576).default(512),
    swapMiB: z.number().int().min(0).max(1_048_576).default(512),
    bridge: pveName,
    ipv4Mode: z.enum(["dhcp", "static"]).default("dhcp"),
    ipv4Address: z.string().trim().refine(isIpv4Cidr, "Use an IPv4 address with CIDR prefix").optional(),
    gateway: z.string().trim().refine(isIpv4, "Use a valid IPv4 gateway").optional(),
    vlanTag: z.number().int().min(1).max(4094).optional(),
    sshKeyId: z.string().trim().min(1).optional(),
    unprivileged: z.boolean().default(true),
    start: z.boolean().default(true),
    firewall: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.ipv4Mode !== "static") return;
    if (!value.ipv4Address) {
      ctx.addIssue({ code: "custom", path: ["ipv4Address"], message: "A static IPv4 CIDR is required" });
    }
    if (!value.gateway) {
      ctx.addIssue({ code: "custom", path: ["gateway"], message: "A gateway is required for static IPv4" });
    }
  });

export type ProvisionContainerInput = z.infer<typeof provisionContainerSchema>;
