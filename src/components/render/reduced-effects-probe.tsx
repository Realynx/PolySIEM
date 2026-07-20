"use client";

import { useEffect } from "react";
import {
  detectHardwareAcceleration,
  shouldDegradeEffects,
} from "@/lib/render/hardware-accel";
import {
  REDUCED_EFFECTS_CLASS,
  RENDER_MODE_COOKIE,
  RENDER_MODE_COOKIE_MAX_AGE,
  type RenderMode,
} from "@/lib/render/constants";

function persist(mode: RenderMode) {
  // Lax is enough: this is a rendering hint, never an auth or privacy signal.
  document.cookie = `${RENDER_MODE_COOKIE}=${mode}; path=/; max-age=${RENDER_MODE_COOKIE_MAX_AGE}; SameSite=Lax`;
}

/**
 * Probes the GPU once per load and records the answer so the server can render
 * the next visit already degraded. Renders nothing.
 *
 * The class is toggled here too, so the very first visit on a software
 * rasterizer still drops the expensive effects — one frame late rather than not
 * at all.
 */
export function ReducedEffectsProbe() {
  useEffect(() => {
    let cancelled = false;

    void detectHardwareAcceleration().then((status) => {
      if (cancelled) return;
      // An unprobeable browser leaves the full experience alone, so only flip
      // the cookie when the answer is conclusive either way.
      if (!status.supported) return;

      const degrade = shouldDegradeEffects(status);
      document.documentElement.classList.toggle(REDUCED_EFFECTS_CLASS, degrade);
      persist(degrade ? "software" : "gpu");
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
