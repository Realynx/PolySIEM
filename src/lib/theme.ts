/** Cookie used to render the correct color theme on first paint (SSR). */
export const THEME_COOKIE = "polysiem_theme";
export const MODE_COOKIE = "polysiem_mode";

export function isThemeColor(value: string | undefined): value is import("@/lib/types").ThemeColor {
  return value === "blue" || value === "emerald" || value === "violet" || value === "amber" || value === "rose";
}
