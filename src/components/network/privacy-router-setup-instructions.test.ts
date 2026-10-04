import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MobilePrivacySetupDisclosure } from "@/components/mobile/pages/network-privacy/mobile-privacy-instructions";
import { VpnSetupDisclosure } from "./privacy-router-setup-instructions";
import {
  privacyRouterGatewayInstructions,
  privacyRouterInstallInstructions,
  privacySetupDisclosureDomId,
  type VpnSetupInstructions,
} from "./privacy-router-presentation";

/**
 * The privacy router walkthroughs open CLOSED — on both surfaces, in every
 * state of the router.
 *
 * This test exists because the rule was written down, agreed, and then lost:
 * the desktop disclosure grew a `defaultOpen` prop and the Setup tab passed
 * `!provisionedAt` to it, so a freshly added router opened on two expanded
 * walkthroughs with no focal point anywhere. The review was "I really couldn't
 * get my bearings on the page as a user where I was supposed to look."
 *
 * A collapsed Radix `CollapsibleContent` renders nothing at all, so static
 * markup is enough to tell open from closed — and the `defaultOpen`-shaped hole
 * cannot be reopened without this failing, because a walkthrough that renders
 * its own steps on first paint renders their text.
 */

const STEP_TITLE = "A step nobody should see before opening this";
const NOTE = "A note nobody should see before opening this";

function instructions(): VpnSetupInstructions {
  return {
    id: "walkthrough",
    title: "The walkthrough headline",
    summary: "The summary that is always visible.",
    stepsLabel: "steps",
    steps: [
      { id: "one", title: STEP_TITLE, path: null, detail: null, fields: [], footnote: null },
    ],
    notes: [NOTE],
  };
}

/** A router that has done NOTHING yet — the state that used to force them open. */
const freshInstall = {
  routerName: "Lab privacy router",
  sshUsername: "polysiem-vpn",
  host: "10.0.3.70",
  port: 22,
  bootstrapCommand: "curl -fsSL https://polysiem.example/bootstrap.sh | sudo sh -s -- --key AAAA",
  hostKeyFingerprint: null,
  provisionedAt: null,
};

describe("the setup walkthroughs are collapsed by default", () => {
  it("renders the desktop disclosure closed, headline visible and steps hidden", () => {
    const html = renderToStaticMarkup(createElement(VpnSetupDisclosure, { instructions: instructions() }));

    expect(html).toContain("The walkthrough headline");
    expect(html).toContain("The summary that is always visible.");
    expect(html).toContain("Show steps");
    expect(html).not.toContain(STEP_TITLE);
    expect(html).not.toContain(NOTE);
  });

  it("renders the phone disclosure closed, from the identical instructions", () => {
    const html = renderToStaticMarkup(
      createElement(MobilePrivacySetupDisclosure, { instructions: instructions() }),
    );

    expect(html).toContain("The walkthrough headline");
    expect(html).toContain("Show steps");
    expect(html).not.toContain(STEP_TITLE);
    expect(html).not.toContain(NOTE);
  });

  it("stays closed for a router that has not been provisioned", () => {
    // The exact state the regression keyed on: no host key, no agent, nothing
    // applied. Expected setup is still not an emergency.
    const install = privacyRouterInstallInstructions(freshInstall);
    expect(install.steps.length).toBeGreaterThan(0);

    for (const element of [
      createElement(VpnSetupDisclosure, { instructions: install }),
      createElement(MobilePrivacySetupDisclosure, { instructions: install }),
    ]) {
      const html = renderToStaticMarkup(element);
      expect(html).toContain(install.summary);
      for (const step of install.steps) expect(html).not.toContain(step.title);
    }
  });

  it("keeps the gateway walkthrough closed too", () => {
    const gateway = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    expect(gateway.steps.length).toBeGreaterThan(0);

    for (const element of [
      createElement(VpnSetupDisclosure, { instructions: gateway }),
      createElement(MobilePrivacySetupDisclosure, { instructions: gateway }),
    ]) {
      const html = renderToStaticMarkup(element);
      for (const step of gateway.steps) expect(html).not.toContain(step.title);
    }
  });

  it("offers no way to open itself: neither disclosure takes a defaultOpen prop", () => {
    // A type-level rule is not enough on its own — this is the prop whose
    // reintroduction caused the regression, so it is asserted at runtime as
    // well. React drops unknown props on a component, so the check is that
    // passing it changes NOTHING about what renders.
    const props = { instructions: instructions() } as Record<string, unknown>;
    const forced = { ...props, defaultOpen: true, open: true };

    for (const component of [VpnSetupDisclosure, MobilePrivacySetupDisclosure]) {
      const html = renderToStaticMarkup(
        createElement(component as never, forced as never),
      );
      expect(html).not.toContain(STEP_TITLE);
    }
  });

  it("stays closed for every mounting value of openRequest", () => {
    // The next-step card CAN open the gateway walkthrough, which is the one
    // narrow path in. It is a request, not a default: `useDisclosureOpenRequest`
    // seeds its ref with the mounting value, so no value a parent passes at
    // mount opens anything — only a later CHANGE, which can only come from an
    // operator clicking while the disclosure is already on screen. That is what
    // stops `openRequest` becoming `defaultOpen` by another name.
    for (const openRequest of [0, 1, 7, undefined]) {
      for (const component of [VpnSetupDisclosure, MobilePrivacySetupDisclosure]) {
        const html = renderToStaticMarkup(
          createElement(component as never, { instructions: instructions(), openRequest } as never),
        );
        expect(html).toContain("The walkthrough headline");
        expect(html).not.toContain(STEP_TITLE);
        expect(html).not.toContain(NOTE);
      }
    }
  });

  it("carries the element id the next-step card scrolls to", () => {
    // Opening a disclosure the reader cannot see is not taking them anywhere.
    const gateway = privacyRouterGatewayInstructions({
      routerName: "Lab privacy router",
      lanAddress: "10.0.3.70",
      lanCidr: "10.0.3.0/24",
      lanInterface: "eth0",
      clientNetworks: ["10.0.4.0/24"],
    });
    const domId = privacySetupDisclosureDomId(gateway.id);

    for (const component of [VpnSetupDisclosure, MobilePrivacySetupDisclosure]) {
      const html = renderToStaticMarkup(createElement(component as never, { instructions: gateway } as never));
      expect(html).toContain(`id="${domId}"`);
    }
  });
});
