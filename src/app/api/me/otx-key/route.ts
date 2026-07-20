import type { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { encryptSecret } from "@/lib/crypto";
import { personalOtxKeySchema } from "@/lib/validators/integrations";
import { testConnection } from "@/lib/integrations/otx";
import { purgePulseCache } from "@/lib/services/threat-intel";
import { PERSONAL_OTX_SOURCE_ID } from "@/lib/types";
import type { DriverConfig } from "@/lib/integrations/types";

export const dynamic = "force-dynamic";

/**
 * PUT /api/me/otx-key — save the caller's personal AlienVault OTX key.
 * The key is probed against OTX first so a typo is caught immediately,
 * then stored encrypted. It only ever powers that user's own feed view.
 */
export const PUT = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = personalOtxKeySchema.parse(await req.json());

  const probe: DriverConfig = {
    id: "unsaved",
    type: "OTX",
    name: "personal",
    baseUrl: "https://otx.alienvault.com",
    credentials: { apiKey: input.apiKey },
    verifyTls: true,
    settings: {},
  };
  let detail: string;
  try {
    detail = (await testConnection(probe)).detail;
  } catch (err) {
    throw new ApiError(400, "otx_key_invalid", err instanceof Error ? err.message : "OTX rejected the key");
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { encryptedOtxKey: encryptSecret(input.apiKey) },
  });
  await audit({ type: "user", userId: user.id }, "profile.otx_key.set");
  return jsonOk({ ok: true, detail });
});

/** DELETE /api/me/otx-key — remove the caller's personal OTX key and its cache. */
export const DELETE = handleApi(async () => {
  const { user } = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { encryptedOtxKey: null } });
  await purgePulseCache(`${PERSONAL_OTX_SOURCE_ID}:${user.id}`);
  await audit({ type: "user", userId: user.id }, "profile.otx_key.clear");
  return jsonOk({ ok: true });
});
