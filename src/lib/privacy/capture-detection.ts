/**
 * Best-effort screen-capture detection for the LabDash privacy shield.
 *
 * Browsers cannot reliably observe OS-level recording, so this module layers
 * explicit heuristics: an in-page `getDisplayMedia` intercept (the only
 * authoritative signal) plus a hidden-tab render-rate probe that is gated on a
 * hardware-acceleration check because timing heuristics are meaningless on
 * software rasterizers. Every browser touch is SSR-guarded; the pure decision
 * logic lives in exported functions with co-located tests.
 */

import {
  detectHardwareAcceleration,
  type HardwareAccelStatus,
} from "@/lib/render/hardware-accel";

// Re-exported for back-compat: these moved to @/lib/render/hardware-accel once
// reduced-effects mode became a second consumer.
export {
  classifyRenderer,
  detectHardwareAcceleration,
  type HardwareAccelStatus,
} from "@/lib/render/hardware-accel";

export type CaptureSignal = "display-media" | "hidden-render";
export type CaptureState = { capturing: boolean; signals: CaptureSignal[] };

/**
 * Browsers throttle or fully stop requestAnimationFrame in hidden tabs;
 * Chromium keeps compositing at full rate while the tab is being captured, so
 * a hidden tab that still renders at ~60fps is a strong capture signal. We
 * require a minimum observation window so a couple of straggler frames fired
 * right after hiding do not count.
 */
export function classifyHiddenFrameRate(
  framesObserved: number,
  elapsedMs: number,
): boolean {
  if (elapsedMs < 700 || framesObserved <= 0) return false;
  const framesPerSecond = (framesObserved / elapsedMs) * 1000;
  return framesPerSecond >= 20;
}

/**
 * Adds or removes a signal without duplicates, preserving insertion order.
 * Returns the input array unchanged (same reference) when nothing changed.
 */
export function reduceSignals(
  current: CaptureSignal[],
  signal: CaptureSignal,
  active: boolean,
): CaptureSignal[] {
  const present = current.includes(signal);
  if (active) return present ? current : [...current, signal];
  return present ? current.filter((entry) => entry !== signal) : current;
}

export interface CaptureDetectorOptions {
  /** Default true — the timing heuristic is unreliable on software rendering. */
  requireHardwareAccel?: boolean;
  onChange: (state: CaptureState) => void;
}

export interface CaptureDetector {
  start(): void;
  stop(): void;
  getState(): CaptureState;
}

const HIDDEN_SAMPLE_WINDOW_MS = 1500;

export function createCaptureDetector(
  options: CaptureDetectorOptions,
): CaptureDetector {
  const requireHardwareAccel = options.requireHardwareAccel ?? true;
  const onChange = options.onChange;
  let state: CaptureState = { capturing: false, signals: [] };

  if (typeof window === "undefined" || typeof document === "undefined") {
    // SSR: inert detector so callers never need their own guards.
    return {
      start() {},
      stop() {},
      getState: () => state,
    };
  }

  let started = false;
  let hwProbe: Promise<HardwareAccelStatus> | null = null;

  const setSignal = (signal: CaptureSignal, active: boolean) => {
    const next = reduceSignals(state.signals, signal, active);
    if (next === state.signals) return; // reduceSignals is referentially stable
    state = { capturing: next.length > 0, signals: next };
    onChange(state);
  };

  // --- Signal 1: getDisplayMedia intercept ---------------------------------

  type GetDisplayMedia = MediaDevices["getDisplayMedia"];
  let originalGetDisplayMedia: GetDisplayMedia | null = null;
  let patchedGetDisplayMedia: GetDisplayMedia | null = null;
  const activeStreams = new Set<MediaStream>();

  const releaseStream = (stream: MediaStream) => {
    if (!activeStreams.delete(stream)) return;
    if (activeStreams.size === 0) setSignal("display-media", false);
  };

  const trackStream = (stream: MediaStream) => {
    activeStreams.add(stream);
    setSignal("display-media", true);
    const onTrackEnded = () => {
      const anyLive = stream
        .getTracks()
        .some((track) => track.readyState === "live");
      if (!anyLive) releaseStream(stream);
    };
    for (const track of stream.getTracks()) {
      track.addEventListener("ended", onTrackEnded);
    }
    stream.addEventListener("inactive", () => releaseStream(stream));
  };

  const patchDisplayMedia = () => {
    const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
    if (!mediaDevices || typeof mediaDevices.getDisplayMedia !== "function") {
      return;
    }
    // Guard against double-patching (start() called twice, or our patch is
    // already installed).
    if (
      patchedGetDisplayMedia &&
      mediaDevices.getDisplayMedia === patchedGetDisplayMedia
    ) {
      return;
    }
    const original = mediaDevices.getDisplayMedia;
    originalGetDisplayMedia = original;
    const patched = ((...args: Parameters<GetDisplayMedia>) =>
      original.apply(mediaDevices, args).then((stream) => {
        trackStream(stream);
        return stream;
      })) as GetDisplayMedia;
    patchedGetDisplayMedia = patched;
    mediaDevices.getDisplayMedia = patched;
  };

  const unpatchDisplayMedia = () => {
    const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
    if (
      mediaDevices &&
      patchedGetDisplayMedia &&
      originalGetDisplayMedia &&
      mediaDevices.getDisplayMedia === patchedGetDisplayMedia
    ) {
      mediaDevices.getDisplayMedia = originalGetDisplayMedia;
    }
    patchedGetDisplayMedia = null;
    originalGetDisplayMedia = null;
    activeStreams.clear();
  };

  // --- Signal 2: hidden-tab render-rate heuristic ---------------------------

  let sampleGeneration = 0;
  let rafId: number | null = null;
  let sampleTimer: ReturnType<typeof setTimeout> | null = null;

  const stopSampling = () => {
    sampleGeneration += 1;
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (sampleTimer !== null) {
      clearTimeout(sampleTimer);
      sampleTimer = null;
    }
  };

  const beginSampling = () => {
    stopSampling();
    const generation = sampleGeneration;
    const startedAt = performance.now();
    let frames = 0;
    let done = false;

    const finish = () => {
      if (done || generation !== sampleGeneration) return;
      done = true;
      const elapsed = performance.now() - startedAt;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      if (sampleTimer !== null) {
        clearTimeout(sampleTimer);
        sampleTimer = null;
      }
      setSignal("hidden-render", classifyHiddenFrameRate(frames, elapsed));
    };

    const tick = () => {
      rafId = null;
      if (done || generation !== sampleGeneration) return;
      frames += 1;
      if (performance.now() - startedAt >= HIDDEN_SAMPLE_WINDOW_MS) {
        finish();
        return;
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);
    // rAF may never fire in a hidden tab (that is the expected, uncaptured
    // case) — finalize via timer so 0 frames resolves to "not capturing".
    sampleTimer = setTimeout(finish, HIDDEN_SAMPLE_WINDOW_MS + 250);
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      const generation = ++sampleGeneration;
      void (async () => {
        if (requireHardwareAccel) {
          hwProbe ??= detectHardwareAcceleration();
          const hw = await hwProbe;
          if (!hw.accelerated) return;
        }
        if (
          !started ||
          generation !== sampleGeneration ||
          document.visibilityState !== "hidden"
        ) {
          return;
        }
        beginSampling();
      })();
    } else {
      stopSampling();
      setSignal("hidden-render", false);
    }
  };

  return {
    start() {
      if (started) return;
      started = true;
      try {
        patchDisplayMedia();
      } catch {
        // getDisplayMedia may be locked down (permissions policy); the
        // hidden-render heuristic still works.
      }
      document.addEventListener("visibilitychange", onVisibilityChange);
    },
    stop() {
      if (!started) return;
      started = false;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      stopSampling();
      try {
        unpatchDisplayMedia();
      } catch {
        // Never throw from teardown.
      }
      if (state.signals.length > 0) {
        state = { capturing: false, signals: [] };
        onChange(state);
      }
    },
    getState: () => state,
  };
}
