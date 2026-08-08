"use client";

import { useCallback, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { apiFetch } from "@/components/shared/api-client";
import { THEME_MODES, type ThemeMode } from "@/lib/types";

function isThemeMode(value: string | undefined): value is ThemeMode {
  return THEME_MODES.some((mode) => mode === value);
}

/**
 * Applies a mode immediately, persists it to the user profile, and rolls the
 * preview back if persistence fails. The in-flight guard also prevents rapid
 * toggles from racing and leaving local storage and the profile out of sync.
 */
export function usePersistedThemeMode() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);

  const setMode = useCallback(
    async (next: ThemeMode): Promise<boolean> => {
      if (savingRef.current) return false;

      const previous: ThemeMode = isThemeMode(theme) ? theme : "system";
      savingRef.current = true;
      setIsSaving(true);
      setTheme(next);

      try {
        await apiFetch("/api/me", {
          method: "PATCH",
          body: JSON.stringify({ themeMode: next }),
        });
        return true;
      } catch (err) {
        setTheme(previous);
        toast.error(err instanceof Error ? err.message : "Failed to save theme mode");
        return false;
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [setTheme, theme],
  );

  return { theme, resolvedTheme, setMode, isSaving };
}
