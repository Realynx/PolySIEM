"use client";

import { useEffect } from "react";
import { useTheme } from "next-themes";
import { MODE_COOKIE } from "@/lib/theme";

/**
 * Keeps the SSR mode cookie in step with the client-resolved theme.
 *
 * next-themes owns dark/light via localStorage, but only the server can paint
 * the right mode on first load (PWA cold starts) and survive RSC refreshes:
 * a router.refresh() rewrites <html className> from the server value whenever
 * any server-computed class changed, silently dropping a client-added "dark"
 * (the "shield flash turns the app light" bug). With the cookie synced, the
 * server string always carries the mode itself.
 */
export function ThemeModeSync() {
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    if (resolvedTheme !== "dark" && resolvedTheme !== "light") return;
    document.cookie = `${MODE_COOKIE}=${resolvedTheme}; path=/; max-age=31536000; samesite=lax`;
    // Heal a stale server-rendered mode class (cookie said dark, storage says
    // light, or vice versa) — idempotent alongside next-themes' own writes.
    document.documentElement.classList.remove(resolvedTheme === "dark" ? "light" : "dark");
    document.documentElement.classList.add(resolvedTheme);
  }, [resolvedTheme]);

  return null;
}
