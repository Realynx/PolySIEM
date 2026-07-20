import { z } from "zod";

export const SECURITYTRAILS_LOOKUP_COMPLETE_KIND =
  "trigger.securitytrails-lookup-complete";
export const SECURITYTRAILS_RESULT_CHANGED_KIND =
  "trigger.securitytrails-result-changed";

export function isSecurityTrailsTriggerKind(kind: string): boolean {
  return (
    kind === SECURITYTRAILS_LOOKUP_COMPLETE_KIND ||
    kind === SECURITYTRAILS_RESULT_CHANGED_KIND
  );
}

export const securityTrailsTriggerConfigSchema = z.object({
  integrationId: z.string().trim().optional(),
  lookupKind: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(["domain", "subdomains", "domain_whois", "ip_whois"]).optional(),
  ),
  query: z.string().trim().optional(),
});
