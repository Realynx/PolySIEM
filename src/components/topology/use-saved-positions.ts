"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import type { XYPosition } from "@xyflow/react";

type PositionMap = Record<string, XYPosition>;

function readSaved(storageKey: string): PositionMap {
  try {
    const raw = window.localStorage.getItem(storageKey);
    return raw ? (JSON.parse(raw) as PositionMap) : {};
  } catch {
    return {};
  }
}

// localStorage must not be read during render: the server renders default
// positions, so a storage-seeded first client render would diverge and trip
// React's hydration check. Layout-effect timing still applies saved positions
// before the browser paints, so there's no visible jump.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function samePositions(a: PositionMap, b: PositionMap): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => key in b && a[key]?.x === b[key]?.x && a[key]?.y === b[key]?.y);
}

/**
 * Remember user-dragged node positions in localStorage so a hand-tuned map
 * layout survives reloads. Positions win over the automatic layout until the
 * user resets them.
 *
 * `clientOnly` maps (never server-rendered) read storage on their first render
 * so an expensive layout keyed on `positions` runs once instead of twice.
 */
export function useSavedPositions(storageKey: string, { clientOnly = false } = {}) {
  const [positions, setPositions] = useState<PositionMap>(() =>
    clientOnly && typeof window !== "undefined" ? readSaved(storageKey) : {},
  );

  useClientLayoutEffect(() => {
    const saved = readSaved(storageKey);
    // Keep the current object when nothing changed: consumers memoise layout
    // work on its identity.
    setPositions((current) => (samePositions(current, saved) ? current : saved));
  }, [storageKey]);

  const savePosition = useCallback(
    (id: string, position: XYPosition) => {
      setPositions((current) => {
        const next = { ...current, [id]: position };
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // storage full / privacy mode — dragging still works for the session
        }
        return next;
      });
    },
    [storageKey],
  );

  const clearPositions = useCallback(() => {
    setPositions({});
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
  }, [storageKey]);

  const hasSaved = Object.keys(positions).length > 0;
  return { positions, savePosition, clearPositions, hasSaved };
}
