import type { ActionDefinition } from "../registry";
import {
  SECURITYTRAILS_LOOKUP_COMPLETE_KIND,
  SECURITYTRAILS_RESULT_CHANGED_KIND,
  securityTrailsTriggerConfigSchema,
} from "../securitytrails-trigger-logic";

function definition(kind: string, changedOnly: boolean): ActionDefinition {
  return {
    meta: {
      kind,
      title: changedOnly
        ? "SecurityTrails result changed"
        : "SecurityTrails lookup completed",
      description: changedOnly
        ? "Starts when a fresh SecurityTrails response differs from the previous live response for the same query and dataset."
        : "Starts whenever PolySIEM stores a fresh SecurityTrails response (cache hits do not fire it).",
      category: "trigger",
      inputs: [
        {
          key: "integrationId",
          label: "SecurityTrails integration",
          type: "integration",
          required: false,
          help: "Leave blank to watch every SecurityTrails connection.",
        },
        {
          key: "lookupKind",
          label: "Dataset",
          type: "select",
          required: false,
          options: [
            { label: "Any dataset", value: "" },
            { label: "Domain details", value: "domain" },
            { label: "Subdomains", value: "subdomains" },
            { label: "Domain WHOIS", value: "domain_whois" },
            { label: "IP WHOIS", value: "ip_whois" },
          ],
          help: "Leave blank to watch every dataset.",
        },
        {
          key: "query",
          label: "Domain or public IP filter",
          type: "string",
          required: false,
          placeholder: "Blank watches every query",
        },
      ],
      outputs: [
        { key: "lookupKind", label: "Lookup dataset" },
        { key: "query", label: "Normalized query" },
        { key: "integrationId", label: "Integration id" },
        { key: "data", label: "Normalized research result" },
        { key: "changed", label: "Changed" },
        { key: "fetchedBy", label: "Lookup source" },
        { key: "fetchedAt", label: "Fetched at" },
        { key: "expiresAt", label: "Cache expires at" },
      ],
    },
    configSchema: securityTrailsTriggerConfigSchema,
    async run({ config, ctx }) {
      securityTrailsTriggerConfigSchema.parse(config);
      if (
        typeof ctx.input.lookupKind === "string" &&
        typeof ctx.input.query === "string"
      ) {
        return { ...ctx.input };
      }
      ctx.log(
        "Run started by hand — no SecurityTrails lookup event is attached",
        "WARN",
      );
      return {
        lookupKind: "",
        query: "",
        integrationId: "",
        data: {},
        changed: false,
        fetchedBy: "",
        fetchedAt: "",
        expiresAt: "",
      };
    },
  };
}

export const triggerSecurityTrailsLookupComplete = definition(
  SECURITYTRAILS_LOOKUP_COMPLETE_KIND,
  false,
);
export const triggerSecurityTrailsResultChanged = definition(
  SECURITYTRAILS_RESULT_CHANGED_KIND,
  true,
);
