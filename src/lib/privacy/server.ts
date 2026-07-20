import "server-only";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { anonymizeDeep } from "@/lib/privacy/anonymize";
import { PRIVACY_SHIELD_COOKIE } from "@/lib/privacy/constants";

/**
 * Whether the current request should render anonymized data: either the user
 * has anonymous mode on, or one of their shield options is enabled and the
 * client shield cookie is set (the cookie alone is not trusted — a stale
 * cookie must not anonymize for users who never enabled the shield).
 */
export async function shouldAnonymize(): Promise<boolean> {
  const session = await getSession();
  const user = session?.user;
  if (!user) return false;
  if (user.anonymousMode) return true;
  if (!user.shieldOnBlur && !user.shieldOnCapture) return false;
  const jar = await cookies();
  return jar.get(PRIVACY_SHIELD_COOKIE)?.value === "1";
}

/**
 * Anonymize a server-rendered page payload when privacy is active.
 *
 * Apply this exactly once, at the page/layout boundary, to data that is about
 * to be DISPLAYED. Never feed the result back into a mutation: values are
 * deterministic pseudonyms, not reversible.
 */
export async function anonymizeForDisplay<T>(data: T): Promise<T> {
  return (await shouldAnonymize()) ? anonymizeDeep(data) : data;
}
