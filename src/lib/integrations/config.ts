import "server-only";
import type { IntegrationConfig } from "@prisma/client";
import { decryptSecret } from "@/lib/crypto";
import type { DriverConfig } from "./types";

/** Decrypt an IntegrationConfig row into the shape drivers consume. */
export function toDriverConfig(integration: IntegrationConfig): DriverConfig {
  let credentials: Record<string, string> = {};
  try {
    credentials = JSON.parse(decryptSecret(integration.encryptedCredentials));
  } catch (err) {
    throw new Error(
      `Failed to decrypt credentials for integration "${integration.name}". ` +
        `Was APP_SECRET changed since they were saved? (${err instanceof Error ? err.message : err})`,
    );
  }
  return {
    id: integration.id,
    type: integration.type,
    name: integration.name,
    baseUrl: integration.baseUrl,
    credentials,
    verifyTls: integration.verifyTls,
    settings: (integration.settings as Record<string, unknown> | null) ?? {},
  };
}
