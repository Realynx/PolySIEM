import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError, handleApi, jsonError, jsonOk } from "@/lib/api";
import { hashPassword } from "@/lib/auth/password";
import { requireAdmin } from "@/lib/auth/guards";
import { createSession, requestMeta, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getOllamaConfig, getSetupState, SETTING_KEYS, setSetting } from "@/lib/settings";
import { setupProgressSchema, setupSchema } from "@/lib/validators/auth";
import { audit } from "@/lib/audit";
import { THEME_COOKIE } from "@/lib/theme";

export const GET = handleApi(async () => {
  return jsonOk(await getSetupState());
});

export const POST = handleApi(async (req: NextRequest) => {
  const setupState = await getSetupState();
  if (setupState.completed || setupState.started) {
    return jsonError(403, "setup_completed", "Setup has already been completed");
  }

  const input = setupSchema.parse(await req.json());
  const passwordHash = await hashPassword(input.password);

  // Claim the installer atomically before creating the administrator. Setup is
  // completed later, after the optional integrations and tutorial steps.
  let user;
  try {
    user = await prisma.$transaction(async (tx) => {
      await tx.appSetting.create({ data: { key: SETTING_KEYS.setupStarted, value: true } });
      // Defense in depth: setup state is not the only installation lock. If a
      // user exists, never let this unauthenticated route mint another admin,
      // even when setup settings were manually removed or corrupted.
      const existingUser = await tx.user.findFirst({ select: { id: true } });
      if (existingUser) {
        throw new ApiError(403, "already_installed", "This PolySIEM instance is already installed");
      }
      const created = await tx.user.create({
        data: {
          username: input.username,
          displayName: input.displayName,
          passwordHash,
          role: "ADMIN",
          themeColor: input.themeColor,
        },
      });
      await tx.appSetting.upsert({
        where: { key: SETTING_KEYS.instanceName },
        create: { key: SETTING_KEYS.instanceName, value: input.instanceName },
        update: { value: input.instanceName },
      });
      await tx.appSetting.upsert({
        where: { key: SETTING_KEYS.defaultTheme },
        create: { key: SETTING_KEYS.defaultTheme, value: input.themeColor },
        update: { value: input.themeColor },
      });
      await tx.appSetting.upsert({
        where: { key: SETTING_KEYS.setupStage },
        create: { key: SETTING_KEYS.setupStage, value: "ai" },
        update: { value: "ai" },
      });
      return created;
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return jsonError(403, "setup_started", "The installer has already created an administrator");
    }
    throw err;
  }

  await audit(
    { type: "system" },
    "setup.admin_created",
    { type: "user", id: user.id },
    { username: user.username },
  );

  const { token, expiresAt } = await createSession(user.id, await requestMeta());
  const res = NextResponse.json({ data: { ok: true, stage: "ai" } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  res.cookies.set(THEME_COOKIE, input.themeColor, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  return res;
});

export const PATCH = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const state = await getSetupState();
  if (state.completed) {
    return jsonError(403, "setup_completed", "Setup has already been completed");
  }
  if (!state.started) {
    return jsonError(409, "setup_not_started", "Create the administrator account first");
  }

  const input = setupProgressSchema.parse(await req.json());
  if (input.action === "set_stage") {
    await setSetting(SETTING_KEYS.setupStage, input.stage);
    return jsonOk({ ok: true, stage: input.stage });
  }

  if (input.action === "set_ai") {
    const existing = await getOllamaConfig();
    const nextStage = input.enabled && input.configureNow ? "ai" : "integrations";
    const nextConfig = JSON.parse(
      JSON.stringify({ ...existing, enabled: input.enabled }),
    ) as Prisma.InputJsonValue;
    await prisma.$transaction([
      prisma.appSetting.upsert({
        where: { key: SETTING_KEYS.ollamaConfig },
        create: {
          key: SETTING_KEYS.ollamaConfig,
          value: nextConfig,
        },
        update: { value: nextConfig },
      }),
      prisma.appSetting.upsert({
        where: { key: SETTING_KEYS.setupStage },
        create: { key: SETTING_KEYS.setupStage, value: nextStage },
        update: { value: nextStage },
      }),
    ]);
    await audit(
      { type: "user", userId: user.id },
      "setup.ai_preference",
      undefined,
      { enabled: input.enabled, configureNow: input.configureNow },
    );
    return jsonOk({ ok: true, stage: nextStage });
  }

  await prisma.$transaction([
    prisma.appSetting.upsert({
      where: { key: SETTING_KEYS.setupCompleted },
      create: { key: SETTING_KEYS.setupCompleted, value: true },
      update: { value: true },
    }),
    prisma.appSetting.upsert({
      where: { key: SETTING_KEYS.setupStage },
      create: { key: SETTING_KEYS.setupStage, value: "complete" },
      update: { value: "complete" },
    }),
  ]);
  await audit(
    { type: "user", userId: user.id },
    "setup.complete",
    { type: "user", id: user.id },
    { tutorialSkipped: input.tutorialSkipped },
  );
  return jsonOk({ ok: true, stage: "complete" });
});
