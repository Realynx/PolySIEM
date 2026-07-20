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

/**
 * Remember user-dragged node positions in localStorage so a hand-tuned map
 * layout survives reloads. Positions win over the automatic layout until the
 * user resets them.
 */
export function useSavedPositions(storageKey: string) {
  const [positions, setPositions] = useState<PositionMap>({});

  useClientLayoutEffect(() => {
    const saved = readSaved(storageKey);
    setPositions((current) => (Object.keys(saved).length > 0 || Object.keys(current).length > 0 ? saved : current));
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
