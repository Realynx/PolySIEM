import { isIP } from "node:net";
import { z } from "zod";

function isIpv4Cidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (extra !== undefined || isIP(address) !== 4) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= 32;
}

export const edgeNatRuleSchema = z.object({
  name: z.string().trim().min(1).max(128),
  protocol: z.enum(["tcp", "udp"]),
  publicPort: z.number().int().min(1).max(65535),
  targetAddress: z.string().refine((value) => {
    if (isIP(value) !== 4) return false;
    const octets = value.split(".").map(Number);
    return octets[0] !== 0 && octets[0] !== 127 && octets[0] < 224 && octets[3] !== 255;
  }, "Use a unicast, non-loopback IPv4 target address"),
  targetPort: z.number().int().min(1).max(65535),
  sourceCidr: z.string().trim().refine(isIpv4Cidr, "Use an IPv4 address or CIDR").nullable().optional(),
  enabled: z.boolean().default(true),
});
export type EdgeNatRuleInput = z.infer<typeof edgeNatRuleSchema>;

export function edgeNatRuleUsesManagementPort(
  rule: Pick<EdgeNatRuleInput, "protocol" | "publicPort">,
  sshPort: number,
): boolean {
  return rule.protocol === "tcp" && rule.publicPort === sshPort;
}

export function edgeNatRulesConflict(
  left: Pick<EdgeNatRuleInput, "protocol" | "publicPort">,
  right: Pick<EdgeNatRuleInput, "protocol" | "publicPort">,
): boolean {
  return left.protocol === right.protocol && left.publicPort === right.publicPort;
}

export const updateEdgeNatRuleSchema = edgeNatRuleSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one field",
);

export const enrollEdgeHostKeySchema = z.object({
  fingerprint: z.string().trim().regex(/^SHA256:[A-Za-z0-9+/]{20,100}$/, "Use an observed SHA256 host-key fingerprint"),
});

export const provisionEdgeNatSchema = enrollEdgeHostKeySchema.extend({
  adminUsername: z.string().trim().regex(
    /^(?!polysiem-edge$)[A-Za-z_][A-Za-z0-9_-]{0,31}$/,
    "Use your existing Linux administrator username",
  ),
});
