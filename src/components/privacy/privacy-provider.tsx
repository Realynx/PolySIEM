"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { EyeOff, ShieldAlert, X } from "lucide-react";
import {
  usePrivacyShield,
  type ShieldReason,
} from "@/components/privacy/use-privacy-shield";
import type {
  CaptureState,
  HardwareAccelStatus,
} from "@/lib/privacy/capture-detection";
import { setPrivacyActive } from "@/lib/privacy/client-state";
import { PRIVACY_SHIELD_CLASS } from "@/lib/privacy/constants";

export interface PrivacySettings {
  anonymousMode: boolean;
  shieldOnCapture: boolean;
  shieldOnBlur: boolean;
}

export interface PrivacyContextValue {
  /** True when displayed data is (or is being) anonymized. */
  anonymize: boolean;
  reasons: ShieldReason[];
  settings: PrivacySettings;
  hardwareAccel: HardwareAccelStatus | null;
  captureState: CaptureState;
  /** Clear shield-triggered anonymization (does not affect the setting). */
  release(): void;
}

const PrivacyContext = createContext<PrivacyContextValue | null>(null);

export function usePrivacy(): PrivacyContextValue | null {
  return useContext(PrivacyContext);
}

export function PrivacyProvider({
  settings,
  children,
}: {
  settings: PrivacySettings;
  children: ReactNode;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [isPending, startTransition] = useTransition();
  const shield = usePrivacyShield({
    shieldOnBlur: settings.shieldOnBlur,
    shieldOnCapture: settings.shieldOnCapture,
  });

  const anonymize = settings.anonymousMode || shield.reasons.length > 0;
  const [veiled, setVeiled] = useState(false);
  const [mounted, setMounted] = useState(false);
  const prevAnonymize = useRef(anonymize);

  // Sync the module flag before the first queries fire, not in an effect —
  // apiFetch reads it synchronously during initial data fetching.
  useState(() => {
    setPrivacyActive(anonymize);
    return null;
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (prevAnonymize.current === anonymize) return;
    prevAnonymize.current = anonymize;
    setPrivacyActive(anonymize);
    void queryClient.invalidateQueries();
    // The shield cookie is already set by the hook, so this server render
    // comes back anonymized.
    startTransition(() => router.refresh());
  }, [anonymize, queryClient, router]);

  useEffect(() => {
    setVeiled(shield.reasons.length > 0);
  }, [shield.reasons]);

  // Lift the blur once anonymized data has replaced the real values — the
  // anonymization, not the blur, is the steady-state protection (a blurred
  // dashboard would make recording a demo pointless).
  useEffect(() => {
    if (!veiled || !anonymize || isPending) return;
    const timer = window.setTimeout(() => {
      document.documentElement.classList.remove(PRIVACY_SHIELD_CLASS);
      setVeiled(false);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [veiled, anonymize, isPending]);

  const value: PrivacyContextValue = {
    anonymize,
    reasons: shield.reasons,
    settings,
    hardwareAccel: shield.hardwareAccel,
    captureState: shield.captureState,
    release: shield.release,
  };

  const overlay =
    mounted && (veiled || anonymize)
      ? createPortal(
          <div
            data-privacy-overlay
            className="pointer-events-none fixed inset-0 z-[200]"
          >
            {veiled && (
              <div className="flex h-full items-center justify-center">
                <div className="flex items-center gap-2 rounded-full border bg-background/95 px-4 py-2 text-sm font-medium shadow-lg">
                  <ShieldAlert className="size-4 text-primary" />
                  Privacy shield engaged
                </div>
              </div>
            )}
            {anonymize && !veiled && (
              <div className="pointer-events-auto absolute right-4 bottom-4 flex items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs font-medium shadow-md">
                <EyeOff className="size-3.5 text-primary" />
                {settings.anonymousMode
                  ? "Anonymous mode"
                  : "Anonymized — capture shield"}
                {!settings.anonymousMode && (
                  <button
                    type="button"
                    aria-label="Restore real values"
                    onClick={shield.release}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <PrivacyContext.Provider value={value}>
      {children}
      {overlay}
    </PrivacyContext.Provider>
  );
}
