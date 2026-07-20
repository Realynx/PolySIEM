/**
 * Reduced-effects mode. Mirrors the privacy-shield constants: the class is a
 * single flag on <html>, and the cookie lets the server stamp it into the
 * initial HTML so there is no flash of expensive effects on repeat visits.
 */

/** Applied to <html> when compositing-heavy effects should be skipped. */
export const REDUCED_EFFECTS_CLASS = "no-gpu";

/** Remembers the last probe so the next page load can render pre-degraded. */
export const RENDER_MODE_COOKIE = "polysiem_render";

export const RENDER_MODE_VALUES = ["gpu", "software"] as const;
export type RenderMode = (typeof RENDER_MODE_VALUES)[number];

export function isRenderMode(value: unknown): value is RenderMode {
  return (
    typeof value === "string" &&
    (RENDER_MODE_VALUES as readonly string[]).includes(value)
  );
}

/** One year — the answer only changes when hardware or browser flags change. */
export const RENDER_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
