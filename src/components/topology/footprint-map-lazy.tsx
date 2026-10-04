"use client";

import { lazy, Suspense, useSyncExternalStore, type ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { FootprintMap as FootprintMapImpl } from "@/components/topology/footprint-map";

export const FOOTPRINT_MAP_HEIGHT = "h-[clamp(600px,72vh,820px)]";

const FootprintMap = lazy(() =>
  import("@/components/topology/footprint-map").then((mod) => ({ default: mod.FootprintMap })),
);

const subscribeNever = () => () => {};

/**
 * Client-only footprint map. The layout pass (dagre + obstacle routing) is the
 * single most expensive thing on the dashboard and scales with lab size;
 * rendering the map during SSR ran it on the server (blocking the whole page's
 * first byte) and then again on hydration. Rendering it only in the browser
 * lets the rest of the page stream immediately, runs the layout once, and lets
 * the map read saved positions/refresh rate on its first render.
 */
export function FootprintMapLazy(props: ComponentProps<typeof FootprintMapImpl>) {
  const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);
  const fallback = (
    <Skeleton className={cn("w-full rounded-xl", props.heightClassName ?? FOOTPRINT_MAP_HEIGHT)} />
  );
  if (!mounted) return fallback;
  return (
    <Suspense fallback={fallback}>
      <FootprintMap {...props} />
    </Suspense>
  );
}
