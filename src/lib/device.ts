import { cookies, headers } from "next/headers";
import { MOBILE_UA_PATTERN, VIEW_MODE_COOKIE } from "@/lib/view-mode";

/**
 * Whether this request should render the phone UI.
 *
 * The single branch point for the mobile experience: layouts and pages call
 * this once (after fetching data) and pick a presentation tree. A cookie set
 * by the in-app switcher wins over user-agent sniffing, so "request desktop
 * site" style toggles work in both directions.
 */
export async function isMobileView(): Promise<boolean> {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const override = cookieStore.get(VIEW_MODE_COOKIE)?.value;
  if (override === "desktop") return false;
  if (override === "mobile") return true;
  return MOBILE_UA_PATTERN.test(headerStore.get("user-agent") ?? "");
}
