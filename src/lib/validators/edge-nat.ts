import { isIP } from "node:net";
import { z } from "zod";
import { wireguardKeyRegex } from "@/lib/validators/integrations";

function isIpv4Cidr(value: string): boolean {
  const [address, prefix, extra] = value.split("/");
  if (extra !== undefined || isIP(address) !== 4) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,2}$/.test(prefix)) return false;
  const bits = Number(prefix);
  return bits >= 0 && bits <= 32;
}

function isUnicastIpv4(value: string): boolean {
  if (isIP(value) !== 4) return false;
  const octets = value.split(".").map(Number);
  return octets[0] !== 0 && octets[0] !== 127 && octets[0] < 224 && octets[3] !== 255;
}

/**
 * How a published port reaches its target.
 *
 * "direct"    — the edge DNATs straight to the target, which must be reachable
 *               from the edge itself. This is the original primitive behaviour
 *               and remains the default; never regress it.
 * "connector" — the edge forwards over the WireGuard tunnel to the selected
 *               connector, which performs the last hop to the target as seen
 *               FROM THE CONNECTOR. The connector's tunnel IP stays implicit.
 */
export const edgeRouteModeSchema = z.enum(["direct", "connector"]);
export type EdgeRouteMode = z.infer<typeof edgeRouteModeSchema>;

/** Object half of the rule schema. Kept unrefined so `.partial()` still works for PATCH. */
export const edgeNatRuleBaseSchema = z.object({
  name: z.string().trim().min(1).max(128),
  protocol: z.enum(["tcp", "udp"]),
  publicPort: z.number().int().min(1).max(65535),
  targetAddress: z.string().refine(isUnicastIpv4, "Use a unicast, non-loopback IPv4 target address"),
  targetPort: z.number().int().min(1).max(65535),
  sourceCidr: z.string().trim().refine(isIpv4Cidr, "Use an IPv4 address or CIDR").nullable().optional(),
  enabled: z.boolean().default(true),
  mode: edgeRouteModeSchema.default("direct"),
  /** Required when mode is "connector"; ignored for direct routes. */
  connectorId: z.string().trim().min(1).max(128).nullable().optional(),
});

export const edgeNatRuleSchema = edgeNatRuleBaseSchema.refine(
  (rule) => rule.mode !== "connector" || Boolean(rule.connectorId),
  { message: "Select a connector for a connector-routed rule", path: ["connectorId"] },
);
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

export const updateEdgeNatRuleSchema = edgeNatRuleBaseSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  "Provide at least one field",
);

// ---------- connectors (Cloudflare-tunnel style) ----------

/**
 * What kind of WireGuard peer a connector is. Every kind is an edge peer with an
 * allocated tunnel address; they differ in how the far side is set up.
 *
 * "agent"    — PolySIEM's connector agent on a Linux host (token/SSH managed).
 * "opnsense" — an OPNsense box; PolySIEM shows a paste-ready peer block and only
 *              needs the public key back. No install token, SSH key, or pushed rules.
 * "peer"     — any other WireGuard endpoint; identical flow to "opnsense".
 */
export const connectorKindSchema = z.enum(["agent", "opnsense", "peer"]);
export type ConnectorKind = z.infer<typeof connectorKindSchema>;

/** Kinds the operator configures by hand — they never run a PolySIEM agent. */
export const MANUAL_CONNECTOR_KINDS = ["opnsense", "peer"] as const;
export function isManualConnectorKind(kind: string): boolean {
  return (MANUAL_CONNECTOR_KINDS as readonly string[]).includes(kind);
}

/** Operator-facing connector fields. The tunnel address is allocated, never typed. */
export const createConnectorSchema = z.object({
  name: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9 _.-]*$/, "Use a short descriptive name"),
  notes: z.string().trim().max(1000).nullable().optional(),
  kind: connectorKindSchema.default("agent"),
  /**
   * WireGuard public key of a manual peer. Optional at create time (the operator
   * often generates it on the far side afterwards) and rejected for "agent"
   * connectors, which generate their own key on the host.
   */
  publicKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard public key").nullable().optional(),
});
export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;

/**
 * Where PolySIEM reaches this connector over SSH (phase 2). Hostname or IP —
 * the connector box normally has no public address, so this is a LAN/VPN address
 * reachable from the PolySIEM server itself.
 */
const connectorSshHostSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      isIP(value) !== 0 ||
      /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value),
    "Use a hostname or IP address reachable from the PolySIEM server",
  );

/**
 * The Linux account whose `authorized_keys` carries the restricted PolySIEM key.
 * Defaults to `polysiem-connector`; kept configurable only for hosts that must
 * use a different service account.
 */
const connectorSshUsernameSchema = z
  .string()
  .trim()
  .regex(/^[a-z_][a-z0-9_-]{0,31}$/, "Use a Linux service account name");

/** Body of the SSH half of PATCH /api/network/connectors/[id]. */
export const connectorSshEndpointSchema = z
  .object({
    sshHost: connectorSshHostSchema.nullable().optional(),
    sshPort: z.number().int().min(1).max(65535).optional(),
    sshUsername: connectorSshUsernameSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field");
export type ConnectorSshEndpointInput = z.infer<typeof connectorSshEndpointSchema>;

const updateConnectorBaseSchema = z.object({
  name: createConnectorSchema.shape.name.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
  /** Disabling keeps the row but tears the peer off the edge. */
  disabled: z.boolean().optional(),
  /** SSH management endpoint (phase 2). Clearing the host disables SSH push. */
  sshHost: connectorSshHostSchema.nullable().optional(),
  sshPort: z.number().int().min(1).max(65535).optional(),
  sshUsername: connectorSshUsernameSchema.optional(),
  /**
   * WireGuard public key for a manual ("opnsense"/"peer") connector — this is the
   * write path the operator uses after generating the key on the far side. Rejected
   * in the service for "agent" connectors, whose key is reported by the agent itself.
   */
  publicKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard public key").nullable().optional(),
});

export const updateConnectorSchema = updateConnectorBaseSchema
  .refine((value) => Object.keys(value).length > 0, "Provide at least one field");
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;

/** POST /api/network/connectors body: the operator fields plus their edge server. */
export const createConnectorRequestSchema = createConnectorSchema.extend({
  integrationId: z.string().trim().min(1).max(128),
});
export type CreateConnectorRequestInput = z.infer<typeof createConnectorRequestSchema>;

/** GET /api/network/connectors query: optionally scope the list to one edge server. */
export const listConnectorsQuerySchema = z.object({
  integrationId: z.string().trim().min(1).max(128).optional(),
});

/** Opaque install token handed to the connector installer. */
export const connectorInstallTokenSchema = z
  .string()
  .trim()
  .regex(/^pscx_[A-Za-z0-9_-]{24,96}$/, "Invalid connector install token");

/**
 * Body the connector agent posts to enroll itself. Authenticated by the one-time
 * install token, NOT by a session: this is a machine-to-machine endpoint.
 */
export const connectorEnrollSchema = z.object({
  token: connectorInstallTokenSchema,
  publicKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard public key"),
  osInfo: z.string().trim().max(512).optional(),
  agentVersion: z.string().trim().max(64).optional(),
  hostname: z.string().trim().max(253).optional(),
});
export type ConnectorEnrollInput = z.infer<typeof connectorEnrollSchema>;

/** Heartbeat/status the agent reports while polling for its desired config. */
export const connectorHeartbeatSchema = z.object({
  connectorId: z.string().trim().min(1).max(128),
  token: connectorInstallTokenSchema,
  handshakeAgeSeconds: z.number().int().min(0).max(31_536_000).nullable().optional(),
  appliedConfigHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().optional(),
  agentVersion: z.string().trim().max(64).optional(),
});
export type ConnectorHeartbeatInput = z.infer<typeof connectorHeartbeatSchema>;

export const enrollEdgeHostKeySchema = z.object({
  fingerprint: z.string().trim().regex(/^SHA256:[A-Za-z0-9+/]{20,100}$/, "Use an observed SHA256 host-key fingerprint"),
});

/**
 * POST /api/network/connectors/[id]/host-key. Same shape as the edge: the
 * operator confirms one of the fingerprints the scan observed, out of band.
 */
export const enrollConnectorHostKeySchema = enrollEdgeHostKeySchema;
export type EnrollConnectorHostKeyInput = z.infer<typeof enrollConnectorHostKeySchema>;

export const provisionEdgeNatSchema = enrollEdgeHostKeySchema.extend({
  adminUsername: z.string().trim().regex(
    /^(?!polysiem-edge$)[A-Za-z_][A-Za-z0-9_-]{0,31}$/,
    "Use your existing Linux administrator username",
  ),
});

/** Linux interface name (matches edgeInterfaceSchema in validators/integrations). */
const wireguardInterfaceSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.:-]{1,15}$/, "Use a Linux interface name");

/**
 * Body for PUT /api/network/edge-networks/servers/[id]/wireguard.
 *
 * The edge is the WireGuard LISTENER; the home OPNsense box INITIATES the tunnel,
 * so the peer's `endpoint` is normally null. The edge private key is generated
 * (or rotated) server-side and stored only in encrypted credentials; a pasted
 * `privateKey` is accepted but validated for value (32-byte key) in the service,
 * and it is NEVER returned in any response.
 */
export const configureWireguardSchema = z.object({
  enabled: z.boolean(),
  interfaceName: wireguardInterfaceSchema.optional(),
  address: z.string().trim().max(64).optional(),
  listenPort: z.number().int().min(1).max(65535).optional(),
  regenerateKey: z.boolean().optional().default(false),
  privateKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard private key").optional(),
  /**
   * The legacy single hand-entered peer. OPTIONAL since phase 3: peers are now
   * connectors, so the tunnel form no longer collects one. Omitting it PRESERVES
   * whatever is already stored (see configureEdgeWireguard) — it never clears it.
   */
  peer: z
    .object({
      publicKey: z.string().trim().regex(wireguardKeyRegex, "Enter a 44-character WireGuard public key"),
      allowedIps: z.array(z.string().trim().max(64)).max(64).default([]),
      endpoint: z.string().trim().max(256).nullable().optional().default(null),
      keepalive: z.number().int().min(0).max(65535).optional().default(25),
    })
    .optional(),
});
export type ConfigureWireguardInput = z.infer<typeof configureWireguardSchema>;
