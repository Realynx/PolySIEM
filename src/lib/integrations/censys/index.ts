import "server-only";
import type { IntegrationDriver } from "@/lib/integrations/types";
import { testCensysConnection } from "./client";

export const censysDriver: IntegrationDriver = {
  testConnection: testCensysConnection,
};
