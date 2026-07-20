import { z } from "zod";
import { lookupSecurityTrailsOperation } from "@/lib/services/securitytrails";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  lookupKind: z.enum(["domain", "subdomains", "domain_whois", "ip_whois"]),
  query: z.string().trim().min(1),
  integrationId: z.string().trim().optional(),
  forceRefresh: z.boolean().default(false),
});

export const securityTrailsLookup: ActionDefinition = {
  meta: {
    kind: "securitytrails.lookup",
    title: "Research with SecurityTrails",
    description:
      "Looks up current domain details, subdomains, domain WHOIS, or public-IP WHOIS. Reuses the shared four-day cache unless a fresh lookup is explicitly requested.",
    category: "inventory",
    inputs: [
      {
        key: "lookupKind",
        label: "Dataset",
        type: "select",
        required: true,
        defaultValue: "domain",
        options: [
          { label: "Domain details", value: "domain" },
          { label: "Subdomains", value: "subdomains" },
          { label: "Domain WHOIS", value: "domain_whois" },
          { label: "IP WHOIS", value: "ip_whois" },
        ],
      },
      {
        key: "query",
        label: "Domain or public IP",
        type: "string",
        required: true,
        placeholder: "example.com or 203.0.113.10",
        help: "Templateable, for example {{input.indicator}}.",
      },
      {
        key: "integrationId",
        label: "SecurityTrails integration",
        type: "integration",
        required: false,
        help: "Defaults to the first enabled SecurityTrails integration.",
      },
      {
        key: "forceRefresh",
        label: "Force a live refresh",
        type: "boolean",
        required: false,
        defaultValue: false,
        help: "Uses a provider call even when a four-day cache entry exists.",
      },
    ],
    outputs: [
      { key: "kind", label: "Lookup dataset" },
      { key: "query", label: "Normalized query" },
      { key: "data", label: "Normalized research result" },
      { key: "cached", label: "Served from cache" },
      { key: "changed", label: "Changed since previous live lookup" },
      { key: "fetchedAt", label: "Fetched at" },
      { key: "expiresAt", label: "Cache expires at" },
      { key: "usage", label: "Provider usage window" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const args = configSchema.parse(config);
    ctx.log(
      `Looking up ${args.query} (${args.lookupKind}) in SecurityTrails${
        args.forceRefresh ? " with a forced refresh" : ""
      }`,
    );
    return lookupSecurityTrailsOperation(args.lookupKind, args.query, {
      source: "workflow",
      integrationId: args.integrationId || undefined,
      forceRefresh: args.forceRefresh,
    });
  },
};
