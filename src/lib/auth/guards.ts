import "server-only";
import { redirect } from "next/navigation";
import { getSession, type SessionInfo } from "@/lib/auth/session";
import { ApiError } from "@/lib/api";

/** For pages/layouts: redirect to /login when unauthenticated. */
export async function requirePageUser(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** For pages/layouts: redirect non-admins to the dashboard home. */
export async function requirePageAdmin(): Promise<SessionInfo> {
  const session = await requirePageUser();
  if (session.user.role !== "ADMIN") redirect("/");
  return session;
}

/** For route handlers: throw a 401 ApiError when unauthenticated. */
export async function requireUser(): Promise<SessionInfo> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "unauthorized", "Authentication required");
  return session;
}

/** For route handlers: throw 403 for non-admins. */
export async function requireAdmin(): Promise<SessionInfo> {
  const session = await requireUser();
  if (session.user.role !== "ADMIN") {
    throw new ApiError(403, "forbidden", "Administrator access required");
  }
  return session;
}
