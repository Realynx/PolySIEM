import { z } from "zod";
import { lookupCensysHost } from "@/lib/services/censys";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  ip: z.string().trim().min(1),
  integrationId: z.string().trim().optional(),
  forceRefresh: z.boolean().default(false),
});

export const censysLookupHost: ActionDefinition = {
  meta: {
    kind: "censys.lookup-host",
    title: "Look up host in Censys",
    description: "Enriches a public IP with exposed services, DNS names, ownership, ASN, network, and location. Reuses the shared four-day cache unless a fresh lookup is explicitly requested.",
    category: "inventory",
    inputs: [
      { key: "ip", label: "Public IP address", type: "string", required: true, placeholder: "203.0.113.10", help: "Templateable, for example {{input.ip}}." },
      { key: "integrationId", label: "Censys integration", type: "integration", required: false, help: "Defaults to the first enabled Censys integration." },
      { key: "forceRefresh", label: "Force a live refresh", type: "boolean", required: false, defaultValue: false, help: "Spends a provider call even when a four-day cache entry exists." },
    ],
    outputs: [
      { key: "host", label: "Normalized host details" },
      { key: "cached", label: "Served from cache" },
      { key: "changed", label: "Changed since previous live lookup" },
      { key: "fetchedAt", label: "Fetched at" },
      { key: "expiresAt", label: "Cache expires at" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const args = configSchema.parse(config);
    ctx.log(`Looking up ${args.ip} in Censys${args.forceRefresh ? " with a forced refresh" : ""}`);
    return lookupCensysHost(args.ip, {
      source: "workflow",
      integrationId: args.integrationId || undefined,
      forceRefresh: args.forceRefresh,
    });
  },
};
