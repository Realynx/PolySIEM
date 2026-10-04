"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { privacyGatewayAckStorageKey, privacySetupDisclosureDomId } from "./privacy-router-presentation";

/**
 * The two client-side pieces of setup step 6 — "point some traffic at it in
 * OPNsense" — shared by the desktop Setup tab and the phone one.
 *
 * Both are here rather than at each surface for the reason
 * `docs/MAINTAINABILITY.md:54` gives for the copy: this feature has drifted
 * between its two surfaces before, and a tick that persists under one key on a
 * laptop and another on a phone is the same class of bug as two spellings of the
 * same sentence.
 *
 * Nothing in this file decides any WORDS. The label, the caveat and the storage
 * key all come from `privacy-router-presentation.ts`, which is where they are
 * tested.
 */

// localStorage must not be read during render: the server renders the tick
// unset, so a storage-seeded first client render would diverge and trip React's
// hydration check. Same constraint as `topology/use-refresh-interval.ts`.
const useClientLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Remember, per router and per browser, that the operator says they have pointed
 * traffic at this box in OPNsense.
 *
 * This is a record of a CLAIM about a firewall PolySIEM does not manage, not a
 * fact about the router, which is exactly why it lives in the presentation layer
 * rather than beside the things the box itself reports. Nothing derived from the
 * router's own state may ever set it — see `PRIVACY_GATEWAY_ACK_NOTE`.
 *
 * It starts false on every render, including the server's, and is corrected from
 * storage after mount.
 */
export function usePrivacyGatewayAck(routerId: string): readonly [boolean, (value: boolean) => void] {
  const [acknowledged, setAcknowledged] = useState(false);
  const storageKey = privacyGatewayAckStorageKey(routerId);

  useClientLayoutEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      // private mode — the step simply stays unticked this session
    }
    setAcknowledged(stored === "true");
  }, [storageKey]);

  const update = useCallback((value: boolean) => {
    setAcknowledged(value);
    try {
      if (value) window.localStorage.setItem(storageKey, "true");
      else window.localStorage.removeItem(storageKey);
    } catch {
      // storage full / privacy mode — the tick still applies this session
    }
  }, [storageKey]);

  return [acknowledged, update] as const;
}

/**
 * Bring a walkthrough disclosure into view after the next-step card has asked it
 * to open.
 *
 * Opening it is the disclosure's own business — see the `openRequest` prop on
 * `VpnSetupDisclosure`, which is deliberately NOT a `defaultOpen`. This only
 * moves the page, and does nothing at all when the element is not on screen,
 * because a scroll to nothing is better than a guess about layout.
 */
export function scrollToPrivacyWalkthrough(instructionsId: string): void {
  const element = document.getElementById(privacySetupDisclosureDomId(instructionsId));
  element?.scrollIntoView({ behavior: "smooth", block: "start" });
}
