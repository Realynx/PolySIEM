"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Auto-hide the bar if a navigation never completes (aborted, error page…). */
const SAFETY_TIMEOUT_MS = 15_000;

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
      // Only plain left-clicks that will trigger an in-app navigation.
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;

      let url: URL;
      try {
        url = new URL(anchor.href, window.location.href);
      } catch {
        return;
      }
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;

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
