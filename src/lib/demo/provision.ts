import "server-only";

import type { IntegrationType } from "@prisma/client";
import type { AuditActor } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { runSync } from "@/lib/integrations/engine";
import {
  createIntegration,
  deleteIntegration,
  type SanitizedIntegration,
  updateIntegration,
} from "@/lib/services/integrations";
import type { CreateIntegrationInput } from "@/lib/validators/integrations";
import {
  scenarioOptionsFromMockUrl,
  type LabSize,
  type ScenarioProfile,
} from "@/lib/demo/catalog";
import { getDeveloperModeConfig } from "@/lib/settings";
import { assertMockIntegrationAllowed } from "@/lib/integrations/developer-mode";

const DEMO_TYPES = [
  "OPNSENSE",
  "PROXMOX",
  "UNIFI",
  "ELASTICSEARCH",
  "OTX",
] as const satisfies readonly IntegrationType[];

const DISPLAY_NAMES: Record<(typeof DEMO_TYPES)[number], string> = {
  OPNSENSE: "OPNsense",
  PROXMOX: "Proxmox",
  UNIFI: "UniFi",
  ELASTICSEARCH: "Elasticsearch",
  OTX: "AlienVault OTX",
};

export interface DemoProvisionOptions {
  profile: ScenarioProfile;
  seed: string;
  size: LabSize;
}

function shortHash(value: string): string {
  let hash = 0x811c9dc5;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7);
}

function scenarioInstanceLabel(options: DemoProvisionOptions): string {
  return `${options.profile}/${options.seed.slice(0, 10)}-${shortHash(options.seed)}/s${options.size}`;
}

/** Build the coordinated, credential-free provider set used by demos/tests. */
export function buildDemoIntegrationInputs(
  options: DemoProvisionOptions,
): CreateIntegrationInput[] {
  const baseUrl = `mock://${options.profile}?seed=${options.seed}&size=${options.size}`;
  // Reuse the strict catalog parser as the single URL/profile/seed validator.
  scenarioOptionsFromMockUrl(baseUrl);
  const instanceLabel = scenarioInstanceLabel(options);

  return DEMO_TYPES.map((type) => ({
    type,
    name: `Demo ${DISPLAY_NAMES[type]} (${instanceLabel})`,
    baseUrl,
    credentials: {},
    enabled: true,
    verifyTls: false,
    syncIntervalMinutes: 15,
    ...(type === "ELASTICSEARCH"
      ? {
          settings: {
            indexPattern: "logs-*,cloudflared-*",
            cloudflaredIndexPattern: "cloudflared-*",
            timestampField: "@timestamp",
            levelField: "log.level",
            messageField: "message",
            hostField: "host.name",
            tunnelHostnameField: "url.domain",
            tunnelHostField: "host.name",
          },
        }
      : type === "OPNSENSE"
        ? { settings: { bandwidthPolling: true, bandwidthPollMinutes: 2 } }
        : type === "UNIFI"
          ? { settings: { site: "default" } }
          : type === "OTX"
            ? { settings: { feed: "activity" as const } }
            : {}),
  })) as CreateIntegrationInput[];
}

export interface DemoProvisionResult {
  profile: ScenarioProfile;
  seed: string;
  size: LabSize;
  created: string[];
  reused: string[];
  removed: string[];
  integrations: Array<{
    id: string;
    type: IntegrationType;
    name: string;
  }>;
  syncRuns: Array<{ integrationId: string; runId: string }>;
}

/** Keep the coordinated lab's selected configs and remove every other mock. */
export function selectOtherMockIntegrationIds(
  integrations: Array<{ id: string; baseUrl: string }>,
  selectedIds: readonly string[],
): string[] {
  const selected = new Set(selectedIds);
  return integrations
    .filter((integration) => integration.baseUrl.startsWith("mock://") && !selected.has(integration.id))
    .map((integration) => integration.id);
}

/**
 * Remove every mock integration and the inventory it generated. Used when mock
 * integrations are switched off: leaving the fixtures behind would keep demo
 * hosts, VMs, and rules visible on every dashboard with no UI left to manage
 * them. Live integrations are never matched. Returns the deleted config ids.
 */
export async function purgeMockIntegrations(
  actor: AuditActor,
): Promise<string[]> {
  const mockIntegrations = await prisma.integrationConfig.findMany({
    where: { baseUrl: { startsWith: "mock://", mode: "insensitive" } },
    select: { id: true },
  });
  for (const { id } of mockIntegrations) {
    await deleteIntegration(actor, id, { purgeData: true });
  }
  return mockIntegrations.map((integration) => integration.id);
}

/**
 * Install one complete mock lab. Inventory providers sync in dependency order
 * (firewall/network first, then compute, then Wi-Fi); live-query providers are
 * immediately usable from their saved scenario URL.
 */
export async function provisionDemoEnvironment(
  actor: AuditActor,
  options: DemoProvisionOptions,
): Promise<DemoProvisionResult> {
  const inputs = buildDemoIntegrationInputs(options);
  const developer = await getDeveloperModeConfig();
  // Gate the operation itself, not only individual creates: an all-reused
  // environment would otherwise reach sync while the feature is disabled.
  assertMockIntegrationAllowed({
    requestedBaseUrl: inputs[0]?.baseUrl,
    mockIntegrationsEnabled:
      developer.enabled && developer.features.mockIntegrations,
  });
  const created: string[] = [];
  const reused: string[] = [];
  const integrations: SanitizedIntegration[] = [];

  for (const input of inputs) {
    const existing = await prisma.integrationConfig.findFirst({
      where: { type: input.type, baseUrl: input.baseUrl },
    });
    if (existing) {
      reused.push(existing.id);
      integrations.push(
        await updateIntegration(actor, existing.id, {
          name: input.name,
          enabled: true,
          verifyTls: false,
          syncIntervalMinutes: input.syncIntervalMinutes,
          ...("settings" in input && input.settings
            ? { settings: input.settings }
            : {}),
        }),
      );
      continue;
    }
    const integration = await createIntegration(actor, input);
    created.push(integration.id);
    integrations.push(integration);
  }

  // The complete lab is authoritative. Remove stale, partial, differently
  // seeded, and duplicate mock configurations (with their generated data), but
  // never touch a live integration. Cleanup happens only after the complete
  // target set exists, so a failed create cannot destroy the previous demo.
  const mockIntegrations = await prisma.integrationConfig.findMany({
    where: { baseUrl: { startsWith: "mock://" } },
    select: { id: true, baseUrl: true },
  });
  const removed = selectOtherMockIntegrationIds(
    mockIntegrations,
    integrations.map((integration) => integration.id),
  );
  for (const id of removed) {
    await deleteIntegration(actor, id, { purgeData: true });
  }

  const syncRuns: DemoProvisionResult["syncRuns"] = [];
  for (const type of ["OPNSENSE", "PROXMOX", "UNIFI"] as const) {
    const integration = integrations.find((item) => item.type === type);
    if (!integration) continue;
    const run = await runSync(integration.id, "manual", actor);
    syncRuns.push({ integrationId: integration.id, runId: run.runId });
  }

  return {
    ...options,
    created,
    reused,
    removed,
    integrations: integrations.map(({ id, type, name }) => ({ id, type, name })),
    syncRuns,
  };
}
