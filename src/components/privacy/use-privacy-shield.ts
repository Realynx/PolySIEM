"use client";

/**
 * Privacy shield for LabDash: blurs the UI the instant the screen is likely
 * being captured, the window loses focus, or PrintScreen is pressed.
 *
 * The CSS class and cookie are applied synchronously inside the raw event
 * handlers — before any React setState — so the visual shield never waits on
 * a re-render. React state exists only for consumers that want to react to
 * the shield (e.g. swapping real values for anonymized ones).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createCaptureDetector,
  detectHardwareAcceleration,
  type CaptureState,
  type HardwareAccelStatus,
} from "@/lib/privacy/capture-detection";
import {
  PRIVACY_SHIELD_CLASS,
  PRIVACY_SHIELD_COOKIE,
} from "@/lib/privacy/constants";

export { PRIVACY_SHIELD_CLASS, PRIVACY_SHIELD_COOKIE };

export type ShieldReason =
  | "blur"
  | "hidden"
  | "printscreen"
  | "capture"
  | "manual";

export interface UsePrivacyShieldOptions {
  /** Blur / visibility / PrintScreen triggers. */
  shieldOnBlur: boolean;
  /** Capture-detector trigger. */
  shieldOnCapture: boolean;
  onEngage?: (reasons: ShieldReason[]) => void;
  onRelease?: () => void;
}

export interface UsePrivacyShieldResult {
  shielded: boolean;
  reasons: ShieldReason[];
  captureState: CaptureState;
  /** Resolves async after mount; null until then and on the server. */
  hardwareAccel: HardwareAccelStatus | null;
  /** Manual engage. */
  engage(reason: ShieldReason): void;
  /** Clears all reasons, including sticky ones. */
  release(): void;
}

/**
 * Adds or removes a reason without duplicates, preserving insertion order.
 * Returns the input array unchanged (same reference) when nothing changed.
 * Same semantics as reduceSignals in capture-detection.ts; kept pure so the
 * state math is testable without a DOM.
 */
export function nextReasons(
  current: ShieldReason[],
  reason: ShieldReason,
  active: boolean,
): ShieldReason[] {
  const present = current.includes(reason);
  if (active) return present ? current : [...current, reason];
  return present ? current.filter((entry) => entry !== reason) : current;
}

const IDLE_CAPTURE_STATE: CaptureState = { capturing: false, signals: [] };

/** Synchronous DOM shield — must run before any React setState. */
function engageDom(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.add(PRIVACY_SHIELD_CLASS);
  document.cookie = `${PRIVACY_SHIELD_COOKIE}=1; path=/; SameSite=Lax`;
}

function releaseDom(): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.remove(PRIVACY_SHIELD_CLASS);
  document.cookie = `${PRIVACY_SHIELD_COOKIE}=; path=/; Max-Age=0; SameSite=Lax`;
}

export function usePrivacyShield(
  options: UsePrivacyShieldOptions,
): UsePrivacyShieldResult {
  const { shieldOnBlur, shieldOnCapture, onEngage, onRelease } = options;

  const [shielded, setShielded] = useState(false);
  const [reasons, setReasons] = useState<ShieldReason[]>([]);
  const [captureState, setCaptureState] =
    useState<CaptureState>(IDLE_CAPTURE_STATE);
  const [hardwareAccel, setHardwareAccel] =
    useState<HardwareAccelStatus | null>(null);

  // Refs keep the raw event handlers stable and synchronous.
  const reasonsRef = useRef<ShieldReason[]>([]);
  const appliedDomRef = useRef(false);
  const onEngageRef = useRef(onEngage);
  const onReleaseRef = useRef(onRelease);

  useEffect(() => {
    onEngageRef.current = onEngage;
    onReleaseRef.current = onRelease;
  }, [onEngage, onRelease]);

  const applyReason = useCallback(
    (reason: ShieldReason, active: boolean) => {
      if (typeof document === "undefined") return; // server no-op
      const current = reasonsRef.current;
      const next = nextReasons(current, reason, active);
      if (next === current) return; // nextReasons is referentially stable
      reasonsRef.current = next;
      if (next.length > 0) {
        // DOM first: the blur must not wait on a React re-render.
        engageDom();
        appliedDomRef.current = true;
        if (active) onEngageRef.current?.(next);
      } else {
        releaseDom();
        appliedDomRef.current = false;
        onReleaseRef.current?.();
      }
      setReasons(next);
      setShielded(next.length > 0);
    },
    [],
  );

  const engage = useCallback(
    (reason: ShieldReason) => applyReason(reason, true),
    [applyReason],
  );

  const release = useCallback(() => {
    if (typeof document === "undefined") return;
    if (reasonsRef.current.length === 0) return;
    reasonsRef.current = [];
    releaseDom();
    appliedDomRef.current = false;
    onReleaseRef.current?.();
    setReasons([]);
    setShielded(false);
  }, []);

  // Blur / visibility / PrintScreen trigger group.
  useEffect(() => {
    if (!shieldOnBlur) return;
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const onBlur = () => applyReason("blur", true);
    const onFocus = () => applyReason("blur", false);
    const onVisibilityChange = () =>
      applyReason("hidden", document.visibilityState === "hidden");
    const onKeyUp = (event: KeyboardEvent) => {
      // PrintScreen only surfaces on keyup in most browsers. Sticky: a
      // screenshot burst must not re-expose data the moment focus returns.
      if (event.key === "PrintScreen") applyReason("printscreen", true);
    };

    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("keyup", onKeyUp);

    return () => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keyup", onKeyUp);
      // Auto-clearing reasons owned by this group cannot clear themselves
      // once the listeners are gone. "printscreen" stays: sticky by design.
      applyReason("blur", false);
      applyReason("hidden", false);
    };
  }, [shieldOnBlur, applyReason]);

  // Capture-detector trigger group.
  useEffect(() => {
    if (!shieldOnCapture) return;
    if (typeof window === "undefined") return;

    const detector = createCaptureDetector({
      onChange: (state) => {
        // applyReason engages the DOM synchronously before setState.
        applyReason("capture", state.capturing);
        setCaptureState(state);
      },
    });
    detector.start();

    return () => {
      detector.stop();
      applyReason("capture", false);
      setCaptureState(IDLE_CAPTURE_STATE);
    };
  }, [shieldOnCapture, applyReason]);

  // Hardware-acceleration probe (informational; the detector gates itself).
  useEffect(() => {
    let cancelled = false;
    void detectHardwareAcceleration().then((status) => {
      if (!cancelled) setHardwareAccel(status);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Unmount safety net: drop the class only if this hook added it and no
  // reasons remain (an active sticky reason keeps the shield up on purpose).
  useEffect(
    () => () => {
      if (appliedDomRef.current && reasonsRef.current.length === 0) {
        releaseDom();
        appliedDomRef.current = false;
      }
    },
    [],
  );

  return {
    shielded,
    reasons,
    captureState,
    hardwareAccel,
    engage,
    release,
  };
}
