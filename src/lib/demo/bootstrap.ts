import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { provisionDemoEnvironment } from "@/lib/demo/provision";
import { getPublicDemoConfig } from "@/lib/demo/mode";
import { SETTING_KEYS } from "@/lib/settings";

interface DemoMarker {
  managed: true;
  username: string;
}

function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function isManagedMarker(value: unknown): value is DemoMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as Partial<DemoMarker>;
  return marker.managed === true && typeof marker.username === "string";
}

/**
 * Create the public account and coordinated mock lab used by the dedicated
 * demo Compose stack. A marker plus empty-database check prevents this startup
 * feature from ever converting an operator's real PolySIEM database.
 */
export async function bootstrapPublicDemo(): Promise<void> {
  const config = getPublicDemoConfig();
  if (!config.enabled || !config.locked || !config.autoSetup) return;

  const existingMarker = await prisma.appSetting.findUnique({
    where: { key: SETTING_KEYS.publicDemo },
    select: { value: true },
  });

  if (!existingMarker) {
    const [settings, users, integrations] = await Promise.all([
      prisma.appSetting.count(),
      prisma.user.count(),
      prisma.integrationConfig.count(),
    ]);
    if (settings > 0 || users > 0 || integrations > 0) {
      throw new Error(
        "Public demo auto-setup requires its dedicated empty database. Refusing to modify an existing PolySIEM installation.",
      );
    }
  } else if (!isManagedMarker(existingMarker.value)) {
    throw new Error(
      "The public-demo database marker is invalid. Refusing automatic changes.",
    );
  } else if (existingMarker.value.username !== config.username) {
    throw new Error(
      `This demo database is managed for username "${existingMarker.value.username}". Keep POLYSIEM_DEMO_USERNAME unchanged or start with a fresh demo volume.`,
    );
  }

  const [users, integrations] = await Promise.all([
    prisma.user.findMany({ select: { username: true } }),
    prisma.integrationConfig.findMany({ select: { baseUrl: true } }),
  ]);
  const unexpectedUser = users.find((user) => user.username !== config.username);
  if (unexpectedUser) {
    throw new Error(
      `Unexpected user "${unexpectedUser.username}" exists in the public-demo database. Refusing to continue.`,
    );
  }
  if (integrations.some(({ baseUrl }) => !baseUrl.toLowerCase().startsWith("mock://"))) {
    throw new Error(
      "A live integration exists in the public-demo database. Refusing to expose it.",
    );
  }

  const passwordHash = await hashPassword(config.password);
  const marker = { managed: true, username: config.username } satisfies DemoMarker;
  const user = await prisma.$transaction(async (tx) => {
    const demoUser = await tx.user.upsert({
      where: { username: config.username },
      create: {
        username: config.username,
        displayName: "Demo Administrator",
        passwordHash,
        role: "ADMIN",
        disabled: false,
        themeColor: "violet",
        themeMode: "system",
      },
      update: {
        displayName: "Demo Administrator",
        passwordHash,
        role: "ADMIN",
        disabled: false,
        encryptedOtxKey: null,
      },
    });

    const settings: Array<[string, unknown]> = [
      [SETTING_KEYS.publicDemo, marker],
      [SETTING_KEYS.setupStarted, true],
      [SETTING_KEYS.setupCompleted, true],
      [SETTING_KEYS.setupStage, "complete"],
      [SETTING_KEYS.instanceName, "PolySIEM Public Demo"],
      [SETTING_KEYS.defaultTheme, "violet"],
      [
        SETTING_KEYS.developerMode,
        { enabled: true, features: { mockIntegrations: true } },
      ],
      [
        SETTING_KEYS.ollamaConfig,
        {
          enabled: true,
          provider: "ollama",
          baseUrl: "mock://demo",
          model: "demo-model:latest",
        },
      ],
      [SETTING_KEYS.backupDestinations, []],
    ];
    for (const [key, value] of settings) {
      await tx.appSetting.upsert({
        where: { key },
        create: { key, value: json(value) },
        update: { value: json(value) },
      });
    }

    // Public sessions and tokens never survive a demo-server restart. The
    // shared login remains available immediately with the configured password.
    await tx.session.deleteMany();
    await tx.apiToken.deleteMany();
    await tx.aiCredential.deleteMany();
    return demoUser;
  });

  const result = await provisionDemoEnvironment(
    { type: "system" },
    { profile: config.profile, seed: config.seed, size: config.size },
  );
  console.log(
    `[public-demo] ready as ${user.username}; ${result.integrations.length} mock integrations, profile=${result.profile}, seed=${result.seed}, size=${result.size}`,
  );
}
