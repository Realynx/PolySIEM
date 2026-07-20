"use client";

import { useEffect } from "react";

/** Registers the PWA service worker — production only (it would fight dev HMR). */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failing (e.g. http:// without localhost) just means no PWA.
    });
  }, []);
  return null;
}
