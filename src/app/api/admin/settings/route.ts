import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
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
import { getAutoUpdateConfig } from "@/lib/updates/auto-update";

const DEFAULT_STALE_REMOVE_THRESHOLD = 3;

type InstanceSettings = ReturnType<typeof instanceSettingsSchema.parse>;

async function updateBasicSettings(instance: InstanceSettings, fields: string[]): Promise<void> {
  const updates = [
    ["instanceName", SETTING_KEYS.instanceName, instance.instanceName],
    ["defaultTheme", SETTING_KEYS.defaultTheme, instance.defaultTheme],
    ["staleRemoveThreshold", SETTING_KEYS.staleRemoveThreshold, instance.staleRemoveThreshold],
  ] as const;
  for (const [field, key, value] of updates) {
    if (value === undefined) continue;
    await setSetting(key, value);
    fields.push(field);
  }
}

async function updateAutoSetting(value: boolean | undefined, fields: string[]): Promise<void> {
  if (value === undefined) return;
  const current = await getAutoUpdateConfig();
  if (value && !current.capable) throw new ApiError(409, "auto_update_unavailable", "Automatic updates require a managed Linux Docker installation.");
  if (current.enforcedByDemo && !value) throw new ApiError(409, "auto_update_enforced", "Automatic updates are required for the public demo.");
  await setSetting(SETTING_KEYS.autoUpdate, value);
  fields.push("autoUpdate");
}

async function updateDeveloperSetting(
  userId: string,
  value: InstanceSettings["developerMode"],
  fields: string[],
): Promise<string[]> {
  if (value === undefined) return [];
  const before = await getDeveloperModeConfig();
  await setSetting(SETTING_KEYS.developerMode, value);
  const after = await getDeveloperModeConfig();
  fields.push("developerMode");
  if (before.enabled && before.features.mockIntegrations && !(after.enabled && after.features.mockIntegrations)) {
    return purgeMockIntegrations({ type: "user", userId });
  }
  return [];
}

async function updateAiSettings(body: Record<string, unknown>, fields: string[]): Promise<void> {
  if (body.ollamaConfig !== undefined) {
    const input = ollamaConfigSchema.parse(body.ollamaConfig);
    await setSetting(SETTING_KEYS.ollamaConfig, mergeStoredAiConfig(input, await getOllamaConfig()));
    fields.push("ollamaConfig");
  }
  if (body.embeddingConfig !== undefined) {
    const input = embeddingConfigSchema.parse(body.embeddingConfig);
    await setSetting(SETTING_KEYS.embeddingConfig, mergeStoredEmbeddingConfig(input, await getEmbeddingConfig()));
    fields.push("embeddingConfig");
  }
}

async function readSettings() {
  const [
    instanceName,
    defaultTheme,
    staleRemoveThreshold,
    ollamaConfig,
    embeddingConfig,
    developerMode,
    autoUpdate,
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
    getAutoUpdateConfig(),
  ]);
  // Sanitize AI configs so the encrypted Azure API key never leaves the server.
  return {
    instanceName,
    defaultTheme,
    staleRemoveThreshold,
    ollamaConfig: sanitizeAiConfig(ollamaConfig),
    embeddingConfig: sanitizeEmbeddingConfig(embeddingConfig),
    developerMode,
    autoUpdate,
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

  await updateBasicSettings(instance, updatedFields);
  await updateAutoSetting(instance.autoUpdate, updatedFields);
  const purgedMockIntegrations = await updateDeveloperSetting(user.id, instance.developerMode, updatedFields);
  await updateAiSettings(body, updatedFields);

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
