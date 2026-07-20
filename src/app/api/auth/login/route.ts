import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApi, jsonError } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, requestMeta, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validators/auth";
import { audit } from "@/lib/audit";
import { THEME_COOKIE, MODE_COOKIE } from "@/lib/theme";

export const POST = handleApi(async (req: NextRequest) => {
  const input = loginSchema.parse(await req.json());

  const user = await prisma.user.findUnique({ where: { username: input.username } });
  // Always verify against a hash to keep timing consistent.
  const ok = await verifyPassword(
    input.password,
    user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinve",
  );
  if (!user || !ok || user.disabled) {
    return jsonError(401, "invalid_credentials", "Invalid username or password");
  }

  const { token, expiresAt } = await createSession(user.id, await requestMeta());
  await audit({ type: "user", userId: user.id }, "auth.login");

  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  const yearCookie = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  res.cookies.set(THEME_COOKIE, user.themeColor, yearCookie);
  res.cookies.set(MODE_COOKIE, user.themeMode, yearCookie);
  return res;
});
