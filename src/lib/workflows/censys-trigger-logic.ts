import { z } from "zod";

export const CENSYS_LOOKUP_COMPLETE_KIND = "trigger.censys-lookup-complete";
export const CENSYS_HOST_CHANGED_KIND = "trigger.censys-host-changed";

export function isCensysTriggerKind(kind: string): boolean {
  return kind === CENSYS_LOOKUP_COMPLETE_KIND || kind === CENSYS_HOST_CHANGED_KIND;
}

export const censysTriggerConfigSchema = z.object({
  integrationId: z.string().trim().optional(),
  ip: z.string().trim().optional(),
});
