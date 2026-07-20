import type { ActionDefinition } from "../registry";
import {
  CENSYS_HOST_CHANGED_KIND,
  CENSYS_LOOKUP_COMPLETE_KIND,
  censysTriggerConfigSchema,
} from "../censys-trigger-logic";

function definition(kind: string, changedOnly: boolean): ActionDefinition {
  return {
    meta: {
      kind,
      title: changedOnly ? "Censys host changed" : "Censys lookup completed",
      description: changedOnly
        ? "Starts when a fresh Censys response differs from the previous live response for that public IP."
        : "Starts whenever PolySIEM stores a fresh Censys host response (cache hits do not fire it).",
      category: "trigger",
      inputs: [
        { key: "integrationId", label: "Censys integration", type: "integration", required: false, help: "Leave blank to watch every Censys connection." },
        { key: "ip", label: "Public IP filter", type: "string", required: false, placeholder: "Blank watches every public IP" },
      ],
      outputs: [
        { key: "ip", label: "Public IP" },
        { key: "integrationId", label: "Integration id" },
        { key: "host", label: "Normalized host details" },
        { key: "changed", label: "Changed" },
        { key: "fetchedAt", label: "Fetched at" },
        { key: "expiresAt", label: "Cache expires at" },
      ],
    },
    configSchema: censysTriggerConfigSchema,
    async run({ config, ctx }) {
      censysTriggerConfigSchema.parse(config);
      if (typeof ctx.input.ip === "string") return { ...ctx.input };
      ctx.log("Run started by hand — no Censys lookup event is attached", "WARN");
      return { ip: "", integrationId: "", host: {}, changed: false, fetchedAt: "", expiresAt: "" };
    },
  };
}

export const triggerCensysLookupComplete = definition(CENSYS_LOOKUP_COMPLETE_KIND, false);
export const triggerCensysHostChanged = definition(CENSYS_HOST_CHANGED_KIND, true);
