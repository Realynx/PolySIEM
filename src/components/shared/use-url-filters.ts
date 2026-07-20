"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * URL-synced list filtering shared by the desktop TableToolbar and the mobile
 * search/filter controls. Server components re-query when the URL changes;
 * changing any filter resets pagination.
 */
export function useUrlFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const apply = useCallback(
    (updates: Record<string, string | null>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === "") params.delete(key);
        else params.set(key, value);
      }
      params.delete("page");
      router.replace(params.size > 0 ? `${pathname}?${params}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  return { searchParams, apply };
}

/** Debounced text input state bound to one query param (default `q`). */
export function useDebouncedSearchParam(
  apply: (updates: Record<string, string | null>) => void,
  urlValue: string,
  delayMs = 300,
) {
  const [value, setValue] = useState(urlValue);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep local state in sync when the URL changes externally (back button).
  useEffect(() => setValue(urlValue), [urlValue]);

  const onChange = useCallback(
    (next: string) => {
      setValue(next);
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => apply({ q: next }), delayMs);
    },
    [apply, delayMs],
  );

  return [value, onChange] as const;
}
