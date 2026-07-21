import { describe, expect, it } from "vitest";
import {
  isUpdateAgentAuthorized,
  isWebUpdateCapable,
  resolveAutoUpdateConfig,
} from "./auto-update";

describe("auto-update configuration", () => {
  it("is off by default", () => {
    expect(resolveAutoUpdateConfig(false, {})).toEqual({
      enabled: false,
      capable: false,
      enforcedByDemo: false,
    });
  });

  it("honors an opt-in only on managed installations", () => {
    expect(
      resolveAutoUpdateConfig(true, { POLYSIEM_AUTO_UPDATE_CAPABLE: "true" }),
    ).toMatchObject({ enabled: true, capable: true, enforcedByDemo: false });
    expect(resolveAutoUpdateConfig(true, {})).toMatchObject({
      enabled: false,
      capable: false,
    });
  });

  it("forces updates for the locked public demo", () => {
    expect(
      resolveAutoUpdateConfig(false, {
        POLYSIEM_DEMO_MODE: "true",
        POLYSIEM_DEMO_LOCKED: "true",
      }),
    ).toEqual({ enabled: true, capable: true, enforcedByDemo: true });
  });
});

describe("browser update capability", () => {
  it("is limited to managed Linux Docker installs", () => {
    expect(isWebUpdateCapable({ POLYSIEM_AUTO_UPDATE_CAPABLE: "true", POLYSIEM_INSTALL_TYPE: "docker" })).toBe(true);
    expect(isWebUpdateCapable({ POLYSIEM_AUTO_UPDATE_CAPABLE: "true", POLYSIEM_INSTALL_TYPE: "native" })).toBe(false);
    expect(isWebUpdateCapable({ POLYSIEM_INSTALL_TYPE: "docker" })).toBe(false);
  });
});

describe("update-agent authorization", () => {
  it("accepts only the exact bearer token", () => {
    expect(isUpdateAgentAuthorized("Bearer secret-token", "secret-token")).toBe(true);
    expect(isUpdateAgentAuthorized("Bearer wrong-token", "secret-token")).toBe(false);
    expect(isUpdateAgentAuthorized(null, "secret-token")).toBe(false);
    expect(isUpdateAgentAuthorized("Bearer secret-token", undefined)).toBe(false);
  });
});
