import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import type { User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { randomToken, sha256Hex } from "@/lib/crypto";

export const SESSION_COOKIE = "polysiem_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days, fixed from login

export type SessionUser = Pick<
  User,
  | "id"
  | "username"
  | "displayName"
  | "role"
  | "themeColor"
  | "themeMode"
  | "anonymousMode"
  | "shieldOnCapture"
  | "shieldOnBlur"
  | "disabled"
>;

export interface SessionInfo {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
}

/** Create a session for a user; returns the raw token to place in the cookie. */
export async function createSession(userId: string, meta?: { ip?: string; userAgent?: string }) {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      id: sha256Hex(token),
      userId,
      expiresAt,
      ip: meta?.ip,
      userAgent: meta?.userAgent?.slice(0, 255),
    },
  });
  return { token, expiresAt };
}

export async function destroySession(token: string) {
  await prisma.session.deleteMany({ where: { id: sha256Hex(token) } });
}

/** Validate a raw session token: sliding expiry, disabled-user check. */
export async function validateSessionToken(token: string): Promise<SessionInfo | null> {
  const id = sha256Hex(token);
  const session = await prisma.session.findUnique({
    where: { id },
    include: {
      user: {
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
          disabled: true,
        },
      },
    },
  });
  if (!session) return null;
  if (session.expiresAt.getTime() < Date.now() || session.user.disabled) {
    await prisma.session.delete({ where: { id } }).catch(() => {});
    return null;
  }
  // Fixed 30-day expiry (no sliding renewal): the browser cookie was set once
  // at login with the same absolute expiry, so DB and cookie stay in lockstep,
  // and a stolen token cannot be kept alive indefinitely by mere activity.
  return { user: session.user, sessionId: id, expiresAt: session.expiresAt };
}

/** Per-request cached session lookup for pages, layouts, and route handlers. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return validateSessionToken(token);
});

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.APP_URL?.startsWith("https://") ?? false,
    path: "/",
    expires: expiresAt,
  };
}

export async function requestMeta() {
  const h = await headers();
  return {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined,
    userAgent: h.get("user-agent") ?? undefined,
  };
}
