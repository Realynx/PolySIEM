"use client";

import { useState } from "react";
import {
  formatPrivacyClientNetworks,
  parsePrivacyClientNetworks,
  privacyRouterTopologySummary,
} from "./privacy-router-presentation";
import { suggestPrivacyRouterTopology } from "@/lib/privacy-router/topology";
import type { PrivacyInterfaceInfo, PrivacyRouterDto } from "./privacy-router-types";

/**
 * The request bodies and the seeded form state behind the four-step add flow,
 * shared by the desktop dialog and the phone sheet.
 *
 * Copy does not live here — every sentence either surface prints comes from
 * `privacy-router-presentation.ts`, which is the module that exists because the
 * two have drifted before. What lives here is the other half of "the two cannot
 * disagree": the shape of what gets POSTed and PATCHed, and which value a field
 * starts out holding.
 *
 * This is also the ONE module that imports `@/lib/privacy-router/topology`, so
 * the suggestion rule has exactly one client in the UI and both surfaces are
 * seeded from the same call with the same arguments. `usePrivacyTopologyForm` lives
 * here for the same reason: mobile needs it, and importing it from a desktop
 * component module would be the first thread pulling those two surfaces back
 * into each other.
 */

/** Where PolySIEM reaches the box, plus the account it borrows once. */
export interface PrivacyRouterIdentityForm {
  name: string;
  host: string;
  port: string;
  /** The operator's OWN login. Held in memory for step 3; never stored. */
  adminUsername: string;
}

export const EMPTY_PRIVACY_ROUTER_IDENTITY: PrivacyRouterIdentityForm = {
  name: "",
  host: "",
  port: "22",
  adminUsername: "",
};

/**
 * The create body.
 *
 * It carries the three things a person can know before the box has been asked
 * anything. `lanCidr` and the two interface names are sent as null on purpose:
 * a router exists before its topology is confirmed, and the previous cut's
 * `eth0` defaults were a guess dressed up as a value. Step 4 fills them in from
 * what the box itself reported.
 */
export function privacyRouterCreateBody(form: PrivacyRouterIdentityForm) {
  return {
    name: form.name.trim(),
    host: form.host.trim(),
    port: Number(form.port.trim()) || 22,
    lanCidr: null,
    lanInterface: null,
    wanInterface: null,
    // Empty for the same reason the three above are null, and with the same
    // consequence: the apply refuses until step 4 fills it in. Empty is never
    // read as "every network".
    clientNetworks: [],
  };
}

/** Step 4's fields, as strings, coerced when they are saved. */
export interface PrivacyRouterTopologyForm {
  wanInterface: string;
  lanInterface: string;
  lanCidr: string;
  /**
   * Free text, one CIDR per line or comma separated, parsed on save.
   *
   * A string rather than an array because this is what the operator types, and
   * because half-typed input has to survive a re-render: an array would force
   * every keystroke through a parse that rejects "10.0." on the way to
   * "10.0.4.0/24".
   */
  clientNetworks: string;
}

export const EMPTY_PRIVACY_ROUTER_TOPOLOGY: PrivacyRouterTopologyForm = {
  wanInterface: "",
  lanInterface: "",
  lanCidr: "",
  clientNetworks: "",
};

/**
 * What step 4 starts out showing.
 *
 * Anything the router has already had confirmed wins — re-opening the form must
 * not offer to overwrite a stored value with a fresh guess. Otherwise the
 * suggestion fills the blanks, and where it cannot tell it leaves them blank
 * rather than picking something.
 *
 * CLIENT NETWORKS ARE THE ONE EXCEPTION to "no guess", and deliberately so. The
 * box cannot know them — they are a fact about OPNsense's firewall rule — so
 * there is nothing to detect and the field would otherwise open empty on every
 * router, which is both a refused apply and one more blank in a step that exists
 * to stop asking for blanks. Seeding it with the router's own subnet makes the
 * single-subnet deployment correct with no thought at all, and the field's copy
 * says plainly that anything on another VLAN has to be added. That is a
 * defensible default rather than a disguised measurement: it is the same value
 * the previous release used for this, so it cannot make anything worse.
 */
export function seedPrivacyRouterTopologyForm(
  interfaces: readonly PrivacyInterfaceInfo[],
  sshHost: string,
  router?: Pick<PrivacyRouterDto, "lanCidr" | "lanInterface" | "wanInterface" | "clientNetworks"> | null,
): PrivacyRouterTopologyForm {
  const suggestion = suggestPrivacyRouterTopology(interfaces, sshHost);
  const lanCidr = router?.lanCidr ?? suggestion.lanCidr ?? "";
  return {
    wanInterface: router?.wanInterface ?? suggestion.wanInterface ?? "",
    lanInterface: router?.lanInterface ?? suggestion.lanInterface ?? "",
    lanCidr,
    clientNetworks: router?.clientNetworks?.length
      ? formatPrivacyClientNetworks(router.clientNetworks)
      : lanCidr,
  };
}

/** True when the box reported one interface doing both jobs — the normal case here. */
export function isPrivacyRouterOneArmed(
  interfaces: readonly PrivacyInterfaceInfo[],
  sshHost: string,
): boolean {
  return suggestPrivacyRouterTopology(interfaces, sshHost).oneArmed;
}

/** The PATCH that confirms the topology. Trimmed, never defaulted. */
export function privacyRouterTopologyBody(form: PrivacyRouterTopologyForm) {
  return {
    lanCidr: form.lanCidr.trim(),
    lanInterface: form.lanInterface.trim(),
    wanInterface: form.wanInterface.trim(),
    // The typed text as a list. `privacyRouterTopologyError` has already refused
    // anything that would not parse, so this cannot silently drop a token.
    clientNetworks: parsePrivacyClientNetworks(form.clientNetworks).networks,
  };
}

/**
 * The seeded, editable topology form, plus the sentence describing what the box
 * reported.
 *
 * Seeding is recomputed whenever what it is seeded FROM changes — keyed on a
 * string rather than on array identity, because the interfaces arrive from a
 * query whose result is a new object on every read. An edit the operator has
 * made survives re-renders and is dropped only when a genuinely different scan
 * lands.
 */
export function usePrivacyTopologyForm(
  interfaces: readonly PrivacyInterfaceInfo[],
  sshHost: string,
  router?: Pick<PrivacyRouterDto, "lanCidr" | "lanInterface" | "wanInterface" | "clientNetworks"> | null,
) {
  const seedKey = topologySeedKey(interfaces, sshHost, router);
  const [edited, setEdited] = useState<{ key: string; value: PrivacyRouterTopologyForm } | null>(null);
  const form = edited?.key === seedKey
    ? edited.value
    : seedPrivacyRouterTopologyForm(interfaces, sshHost, router);
  const summary = privacyRouterTopologySummary({
    interfaceCount: interfaces.length,
    oneArmed: isPrivacyRouterOneArmed(interfaces, sshHost),
    wanInterface: form.wanInterface || null,
    lanInterface: form.lanInterface || null,
    lanCidr: form.lanCidr || null,
  });
  const setForm = (patch: Partial<PrivacyRouterTopologyForm>) =>
    setEdited({ key: seedKey, value: { ...form, ...patch } });
  return { form, setForm, summary };
}

function topologySeedKey(
  interfaces: readonly PrivacyInterfaceInfo[],
  sshHost: string,
  router?: Pick<PrivacyRouterDto, "lanCidr" | "lanInterface" | "wanInterface" | "clientNetworks"> | null,
): string {
  const observed = interfaces.map((one) => `${one.name}|${one.addrCidr ?? ""}|${one.defaultRoute ? 1 : 0}`).join(",");
  const clients = (router?.clientNetworks ?? []).join(",");
  const stored = `${router?.lanCidr ?? ""}/${router?.lanInterface ?? ""}/${router?.wanInterface ?? ""}/${clients}`;
  return `${sshHost}#${stored}#${observed}`;
}
