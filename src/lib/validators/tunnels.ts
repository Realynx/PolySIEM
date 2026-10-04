import { z } from "zod";
import { patchSchema } from "@/lib/validators/patch";

/**
 * Documented ingress tunnels (e.g. cloudflared connectors). Identifiers only —
 * tunnel run tokens/secrets are never accepted or stored.
 */
export const createTunnelSchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(50).default("cloudflare"),
  tunnelExternalId: z.string().max(100).nullish(),
  originIp: z.string().max(45).nullish(),
  ingressHostnames: z.array(z.string().min(1).max(253)).max(500).default([]),
  deviceId: z.string().nullish(),
  vmId: z.string().nullish(),
  containerId: z.string().nullish(),
  notes: z.string().max(10_000).nullish(),
});

/**
 * All keys optional and absent keys genuinely absent. `patchSchema`, not
 * `.partial()`: `.partial()` keeps the `provider` and `ingressHostnames`
 * defaults, and the PATCH route spreads the parsed body straight into a Prisma
 * `update`, so an omitted key would have reset the provider to "cloudflare" and
 * emptied the hostname list.
 */
export const updateTunnelSchema = patchSchema(createTunnelSchema);

export type CreateTunnelInput = z.infer<typeof createTunnelSchema>;
export type UpdateTunnelInput = z.infer<typeof updateTunnelSchema>;
