"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Auto-hide the bar if a navigation never completes (aborted, error page…). */
const SAFETY_TIMEOUT_MS = 15_000;

function modifiedClick(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function navigationTarget(event: MouseEvent): URL | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (modifiedClick(event)) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  try {
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Slim indeterminate progress bar shown at the top of the content area during
 * client-side route transitions. Starts on any left-click of a same-origin
 * internal link that targets a different pathname, and stops as soon as the
 * pathname actually changes (i.e. the new route — or its loading.tsx
 * boundary — has rendered).
 */
export function NavigationProgress() {
  const pathname = usePathname();
  const [navigating, setNavigating] = useState(false);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The route (or its loading boundary) rendered — navigation is done.
  useEffect(() => {
    setNavigating(false);
    if (safetyTimer.current !== null) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  }, [pathname]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (!navigationTarget(event)) return;

      setNavigating(true);
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setNavigating(false), SAFETY_TIMEOUT_MS);
    }

    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
    };
  }, []);

  if (!navigating) return null;

  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden md:left-60"
    >
      <div className="h-full w-1/3 rounded-full bg-primary [animation:polysiem-nav-progress_1.2s_ease-in-out_infinite]" />
      <style>{`@keyframes polysiem-nav-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }`}</style>
    </div>
  );
}
