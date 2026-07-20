import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { purgeMockIntegrations } from "@/lib/demo/provision";
import {
  SETTING_KEYS,
  getEmbeddingConfig,
  getDeveloperModeConfig,
  getOllamaConfig,
  getSetting,
  mergeStoredAiConfig,
  mergeStoredEmbeddingConfig,
  sanitizeAiConfig,
  sanitizeEmbeddingConfig,
  setSetting,
} from "@/lib/settings";
import {
  embeddingConfigSchema,
  instanceSettingsSchema,
  ollamaConfigSchema,
} from "@/lib/validators/integrations";

const DEFAULT_STALE_REMOVE_THRESHOLD = 3;

async function readSettings() {
  const [
    instanceName,
    defaultTheme,
    staleRemoveThreshold,
    ollamaConfig,
    embeddingConfig,
    developerMode,
  ] = await Promise.all([
    getSetting<string>(SETTING_KEYS.instanceName, "PolySIEM"),
    getSetting<string>(SETTING_KEYS.defaultTheme, "blue"),
    getSetting<number>(
      SETTING_KEYS.staleRemoveThreshold,
      DEFAULT_STALE_REMOVE_THRESHOLD,
    ),
    getOllamaConfig(),
    getEmbeddingConfig(),
    getDeveloperModeConfig(),
  ]);
  // Sanitize AI configs so the encrypted Azure API key never leaves the server.
  return {
    instanceName,
    defaultTheme,
    staleRemoveThreshold,
    ollamaConfig: sanitizeAiConfig(ollamaConfig),
    embeddingConfig: sanitizeEmbeddingConfig(embeddingConfig),
    developerMode,
  };
}

export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await readSettings());
});

export const PATCH = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const body = (await req.json()) as Record<string, unknown>;

  const instance = instanceSettingsSchema.parse(body);
  const updatedFields: string[] = [];

  if (instance.instanceName !== undefined) {
    await setSetting(SETTING_KEYS.instanceName, instance.instanceName);
    updatedFields.push("instanceName");
  }
  if (instance.defaultTheme !== undefined) {
    await setSetting(SETTING_KEYS.defaultTheme, instance.defaultTheme);
    updatedFields.push("defaultTheme");
  }
  if (instance.staleRemoveThreshold !== undefined) {
    await setSetting(
      SETTING_KEYS.staleRemoveThreshold,
      instance.staleRemoveThreshold,
    );
    updatedFields.push("staleRemoveThreshold");
  }
  let purgedMockIntegrations: string[] = [];
  if (instance.developerMode !== undefined) {
    // Compare effective state, so POLYSIEM_DEMO_MODE (which forces mocks on)
    // never triggers a purge on a deployed demo instance.
    const before = await getDeveloperModeConfig();
    await setSetting(SETTING_KEYS.developerMode, instance.developerMode);
    const after = await getDeveloperModeConfig();
    const wasEnabled = before.enabled && before.features.mockIntegrations;
    const isEnabled = after.enabled && after.features.mockIntegrations;
    if (wasEnabled && !isEnabled) {
      // Turning mocks off also removes what turning them on created.
      purgedMockIntegrations = await purgeMockIntegrations({
        type: "user",
        userId: user.id,
      });
    }
    updatedFields.push("developerMode");
  }
  if (body.ollamaConfig !== undefined) {
    const input = ollamaConfigSchema.parse(body.ollamaConfig);
    // Merge with the stored config so a blank Azure key keeps the existing one
    // and any new key is encrypted at rest (the plaintext is never persisted).
    const stored = mergeStoredAiConfig(input, await getOllamaConfig());
    await setSetting(SETTING_KEYS.ollamaConfig, stored);
    updatedFields.push("ollamaConfig");
  }
  if (body.embeddingConfig !== undefined) {
    const input = embeddingConfigSchema.parse(body.embeddingConfig);
    const stored = mergeStoredEmbeddingConfig(
      input,
      await getEmbeddingConfig(),
    );
    await setSetting(SETTING_KEYS.embeddingConfig, stored);
    updatedFields.push("embeddingConfig");
  }

  await audit({ type: "user", userId: user.id }, "settings.update", undefined, {
    fields: updatedFields,
    ...(purgedMockIntegrations.length > 0
      ? { purgedMockIntegrations: purgedMockIntegrations.length }
      : {}),
  });
  return jsonOk({
    ...(await readSettings()),
    purgedMockIntegrations: purgedMockIntegrations.length,
  });
});
