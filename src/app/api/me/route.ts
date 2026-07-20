import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { updateProfileSchema } from "@/lib/validators/auth";
import { audit } from "@/lib/audit";
import { THEME_COOKIE, MODE_COOKIE } from "@/lib/theme";

export const GET = handleApi(async () => {
  const { user } = await requireUser();
  return jsonOk(user);
});

export const PATCH = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = updateProfileSchema.parse(await req.json());

  let passwordHash: string | undefined;
  if (input.newPassword) {
    const full = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!input.currentPassword || !(await verifyPassword(input.currentPassword, full.passwordHash))) {
      throw new ApiError(400, "wrong_password", "Current password is incorrect");
    }
    passwordHash = await hashPassword(input.newPassword);
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      displayName: input.displayName === undefined ? undefined : input.displayName,
      themeColor: input.themeColor,
      themeMode: input.themeMode,
      anonymousMode: input.anonymousMode,
      shieldOnCapture: input.shieldOnCapture,
      shieldOnBlur: input.shieldOnBlur,
      passwordHash,
    },
    select: {
      id: true,
      username: true,
      displayName: true,
      role: true,
      themeColor: true,
      themeMode: true,
      anonymousMode: true,
      shieldOnCapture: true,
      shieldOnBlur: true,
    },
  });
  await audit({ type: "user", userId: user.id }, "profile.update", undefined, { fields: Object.keys(input) });

  const res = NextResponse.json({ data: updated });
  const yearCookie = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  if (input.themeColor) res.cookies.set(THEME_COOKIE, input.themeColor, yearCookie);
  if (input.themeMode) res.cookies.set(MODE_COOKIE, input.themeMode, yearCookie);
  return res;
});
