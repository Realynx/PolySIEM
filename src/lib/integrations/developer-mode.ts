import { ApiError } from "@/lib/api";
import { parseMockIntegrationUrl } from "@/lib/integrations/mock-url";

export function isMockIntegrationUrl(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase().startsWith("mock://") === true;
}

/**
 * Guard mock integration URLs. With mock integrations off, no write may leave a
 * mock URL saved — not even resaving the one already there, since the feature
 * being off means the fixtures are meant to be gone. Deleting an integration
 * and editing fields other than `baseUrl` stay available, so a mock left over
 * from before the feature was switched off can still be cleaned up.
 */
export function assertMockIntegrationAllowed(input: {
  requestedBaseUrl: string | null | undefined;
  mockIntegrationsEnabled: boolean;
  existingBaseUrl?: string | null;
}): void {
  const requested = input.requestedBaseUrl?.trim();
  if (!requested || !isMockIntegrationUrl(requested)) return;
  const existing = input.existingBaseUrl?.trim();
  const unchanged =
    requested === existing && isMockIntegrationUrl(existing);
  // Fixtures created before named profiles were introduced no longer parse.
  // Keep them editable at their exact saved URL rather than forcing a
  // migration, but only while the feature is on — the gate below still runs.
  if (!unchanged && !parseMockIntegrationUrl(requested)) {
    throw new ApiError(
      400,
      "invalid_mock_scenario",
      "Choose one of the supported mock scenario profiles and a valid seed.",
    );
  }
  if (input.mockIntegrationsEnabled) return;

  throw new ApiError(
    403,
    "developer_mode_required",
    unchanged
      ? "Mock integrations are turned off. Re-enable them in Settings → Integrations to keep this one, or point it at a real system or delete it."
      : "Enable Developer mode in Settings → Integrations before saving a mock integration.",
  );
}
