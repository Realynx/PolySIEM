/**
 * Isomorphic view-mode facts shared by server detection (lib/device.ts) and
 * client switchers. Keep this module free of next/headers and DOM globals at
 * import time so both sides can use it.
 */

export type ViewMode = "mobile" | "desktop";

/** Cookie that force-overrides user-agent sniffing. */
export const VIEW_MODE_COOKIE = "polysiem_view";

/** Phone user agents. Android tablets (no "Mobile" token) get the desktop UI. */
export const MOBILE_UA_PATTERN = /Android.+Mobile|iPhone|iPod|Windows Phone/i;

/** Persist a view-mode override and reload so server components re-branch. */
export function setViewMode(mode: ViewMode): void {
  document.cookie = `${VIEW_MODE_COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax`;
  window.location.reload();
}
