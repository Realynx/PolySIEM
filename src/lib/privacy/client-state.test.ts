import { describe, expect, it } from "vitest";
import {
  isPrivacyActive,
  setPrivacyActive,
  shouldAnonymizeRequest,
  subscribePrivacy,
} from "./client-state";

describe("privacy client state", () => {
  it("toggles and notifies subscribers only on change", () => {
    setPrivacyActive(false);
    let calls = 0;
    const unsubscribe = subscribePrivacy(() => {
      calls += 1;
    });
    setPrivacyActive(true);
    expect(isPrivacyActive()).toBe(true);
    setPrivacyActive(true);
    expect(calls).toBe(1);
    setPrivacyActive(false);
    expect(calls).toBe(2);
    unsubscribe();
    setPrivacyActive(true);
    expect(calls).toBe(2);
    setPrivacyActive(false);
  });
});

describe("shouldAnonymizeRequest", () => {
  it("allows GET display endpoints", () => {
    expect(shouldAnonymizeRequest("/api/network/edge-networks")).toBe(true);
    expect(shouldAnonymizeRequest("/api/logs/insights?window=24h", "GET")).toBe(true);
    expect(shouldAnonymizeRequest("/api/inventory/hosts/abc123")).toBe(true);
    expect(shouldAnonymizeRequest("/api/workflows/runs")).toBe(true);
  });

  it("never anonymizes mutations", () => {
    expect(shouldAnonymizeRequest("/api/network/edge-networks", "POST")).toBe(false);
    expect(shouldAnonymizeRequest("/api/inventory/hosts/abc123", "PATCH")).toBe(false);
  });

  it("skips config and form endpoints", () => {
    expect(shouldAnonymizeRequest("/api/me")).toBe(false);
    expect(shouldAnonymizeRequest("/api/admin/settings")).toBe(false);
    expect(shouldAnonymizeRequest("/api/admin/integrations/xyz")).toBe(false);
    expect(shouldAnonymizeRequest("/api/logs/scan/config")).toBe(false);
    expect(shouldAnonymizeRequest("/api/workflows/wf-1")).toBe(false);
  });

  it("does not treat prefix-similar paths as matches", () => {
    expect(shouldAnonymizeRequest("/api/networking-else")).toBe(false);
    expect(shouldAnonymizeRequest("/api/logsmith")).toBe(false);
  });
});
