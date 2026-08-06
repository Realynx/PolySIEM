import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { handleApi, jsonError } from "@/lib/api";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, requestMeta, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { loginSchema } from "@/lib/validators/auth";
import { audit } from "@/lib/audit";
import { THEME_COOKIE, MODE_COOKIE } from "@/lib/theme";
import { clearRateLimit, consumeRateLimit, pruneExpiredRateLimits, trustedClientIp } from "@/lib/rate-limit";

const ACCOUNT_LIMIT = { limit: 10, windowMs: 15 * 60_000 } as const;
const IP_LIMIT = { limit: 60, windowMs: 15 * 60_000 } as const;
const GLOBAL_LIMIT = { limit: 300, windowMs: 15 * 60_000 } as const;

export const POST = handleApi(async (req: NextRequest) => {
  const input = loginSchema.parse(await req.json());
  const normalizedUsername = input.username.trim().toLowerCase();
  const clientIp = trustedClientIp(req);
  await pruneExpiredRateLimits();

  // Check the global circuit breaker first. Once it is exhausted, do not create
  // attacker-controlled account buckets for arbitrary usernames.
  const globalLimit = await consumeRateLimit("login-global", "all", GLOBAL_LIMIT);
  if (!globalLimit.allowed) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many login attempts. Try again shortly." } },
      { status: 429, headers: { "Retry-After": String(globalLimit.retryAfterSeconds) } },
    );
  }

  const identityLimits = await Promise.all([
    consumeRateLimit("login-account", normalizedUsername, ACCOUNT_LIMIT),
    ...(clientIp ? [consumeRateLimit("login-ip", clientIp, IP_LIMIT)] : []),
  ]);
  const blocked = identityLimits.find((limit) => !limit.allowed);
  if (blocked) {
    return NextResponse.json(
      { error: { code: "rate_limited", message: "Too many login attempts. Try again shortly." } },
      { status: 429, headers: { "Retry-After": String(blocked.retryAfterSeconds) } },
    );
  }

  const user = await prisma.user.findUnique({ where: { username: input.username } });
  // Always verify against a hash to keep timing consistent.
  const ok = await verifyPassword(
    input.password,
    user?.passwordHash ?? "$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinve",
  );
  if (!user || !ok || user.disabled) {
    return jsonError(401, "invalid_credentials", "Invalid username or password");
  }

  await Promise.all([
    clearRateLimit("login-account", normalizedUsername),
    ...(clientIp ? [clearRateLimit("login-ip", clientIp)] : []),
  ]);

  const { token, expiresAt } = await createSession(user.id, await requestMeta());
  await audit({ type: "user", userId: user.id }, "auth.login");

  const res = NextResponse.json({ data: { ok: true } });
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(expiresAt));
  const yearCookie = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const };
  res.cookies.set(THEME_COOKIE, user.themeColor, yearCookie);
  res.cookies.set(MODE_COOKIE, user.themeMode, yearCookie);
  return res;
});
