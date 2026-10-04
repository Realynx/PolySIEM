"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A disclosure that starts CLOSED and can be opened by an explicit request from
 * elsewhere on the page — but never by a prop it happened to mount with.
 *
 * The privacy router walkthroughs regressed once already by growing a
 * `defaultOpen` prop that the Setup tab wired to router state, which produced a
 * screen opening on two expanded walkthroughs and no focal point: "I really
 * couldn't get my bearings on the page as a user where I was supposed to look."
 * `privacy-router-setup-instructions.test.ts` pins that closed.
 *
 * The next-step card still has a real need to send an operator INTO the OPNsense
 * walkthrough, so this is the narrow shape that serves it without reopening that
 * hole. The distinction is mount versus change:
 *
 *  - The first render is always closed, whatever `request` holds. The ref is
 *    seeded with the mounting value, so it is already "seen".
 *  - Only a CHANGE opens it, and a change can only come from something the
 *    operator did while this component was already on screen.
 *
 * That makes "start opened because of state" unexpressible: there is no value a
 * parent can pass at mount that opens anything, so the regression cannot come
 * back through this door. Closing it again stays entirely the reader's business.
 */
export function useDisclosureOpenRequest(
  request: number | undefined,
): readonly [boolean, Dispatch<SetStateAction<boolean>>] {
  const [open, setOpen] = useState(false);
  const seen = useRef(request);

  useEffect(() => {
    if (request === seen.current) return;
    seen.current = request;
    setOpen(true);
  }, [request]);

  return [open, setOpen] as const;
}
