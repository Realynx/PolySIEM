import "server-only";
import type { IntegrationDriver } from "@/lib/integrations/types";
import { testSecurityTrailsConnection } from "./client";

export const securityTrailsDriver: IntegrationDriver = {
  testConnection: testSecurityTrailsConnection,
};

export { fetchSecurityTrails, securityTrailsLookupPath, testSecurityTrailsConnection } from "./client";
export type { SecurityTrailsLookupKind } from "./client";
