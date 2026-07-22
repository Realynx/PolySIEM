"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { cn } from "@/lib/utils";
import { RouteLoadingSkeleton } from "./route-loading-skeleton";
import { NAVIGATION_START_EVENT, type NavigationStartDetail } from "./navigation-feedback";

/** Auto-hide the bar if a navigation never completes (aborted, error page…). */
const SAFETY_TIMEOUT_MS = 15_000;

function modifiedClick(event: MouseEvent | PointerEvent | KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey;
}

function navigationTarget(event: MouseEvent | PointerEvent | KeyboardEvent): URL | null {
  if (event.defaultPrevented) return null;
  if ("button" in event && event.button !== 0) return null;
  if (modifiedClick(event)) return null;
  const anchor = (event.target as Element | null)?.closest?.("a[href]");
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  try {
    const url = new URL(anchor.href, window.location.href);
    const current = new URL(window.location.href);
    const samePage = url.pathname === current.pathname && url.search === current.search;
    if (url.origin !== current.origin || samePage) return null;
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
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);
  const [targetPathname, setTargetPathname] = useState(pathname);
  const safetyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const routeKey = `${pathname}?${searchParams}`;
  const standalonePath = navigating ? targetPathname : pathname;
  const hasDashboardShell = !["/login", "/setup", "/update"].includes(standalonePath);

  // The route (or its loading boundary) rendered — navigation is done.
  useEffect(() => {
    setNavigating(false);
    if (safetyTimer.current !== null) {
      clearTimeout(safetyTimer.current);
      safetyTimer.current = null;
    }
  }, [routeKey]);

  useEffect(() => {
    function beginNavigation(nextPathname = window.location.pathname) {
      setTargetPathname(nextPathname);
      setNavigating(true);
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
      safetyTimer.current = setTimeout(() => setNavigating(false), SAFETY_TIMEOUT_MS);
    }

    function onPointerDown(event: PointerEvent) {
      const target = navigationTarget(event);
      if (!target) return;
      beginNavigation(target.pathname);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Enter") return;
      const target = navigationTarget(event);
      if (!target) return;
      beginNavigation(target.pathname);
    }

    function onProgrammaticNavigation(event: Event) {
      beginNavigation((event as CustomEvent<NavigationStartDetail>).detail?.pathname);
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener(NAVIGATION_START_EVENT, onProgrammaticNavigation);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener(NAVIGATION_START_EVENT, onProgrammaticNavigation);
      if (safetyTimer.current !== null) clearTimeout(safetyTimer.current);
    };
  }, []);

  if (!navigating) return null;

  return (
    <>
      <div
        role="progressbar"
        aria-label="Loading page"
        className={cn(
          "pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5 overflow-hidden",
          hasDashboardShell && "md:left-60",
        )}
      >
        <div className="h-full w-1/3 rounded-full bg-primary [animation:polysiem-nav-progress_1.2s_ease-in-out_infinite]" />
        <style>{`@keyframes polysiem-nav-progress { from { transform: translateX(-100%); } to { transform: translateX(300%); } }`}</style>
      </div>
      <div
        role="status"
        aria-live="polite"
        aria-label="Loading the next page"
        className={cn(
          "pointer-events-none fixed z-20 overflow-hidden",
          hasDashboardShell
            ? "inset-x-0 top-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] bg-background px-4 py-5 md:bottom-0 md:left-60 md:top-14 md:px-6"
            : "inset-0 bg-muted/40 p-4",
        )}
      >
        <span className="sr-only">Loading the next page</span>
        <RouteLoadingSkeleton pathname={targetPathname} />
      </div>
    </>
  );
}
