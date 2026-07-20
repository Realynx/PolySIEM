import { describe, expect, it } from "vitest";

import {
  isTriggerKind,
  isTriggerParamType,
  TRIGGER_KIND_PREFIX,
  TRIGGER_PARAM_TYPES,
} from "./types";

describe("workflow trigger contract", () => {
  it("recognizes every trigger flavor by the canonical prefix", () => {
    expect(TRIGGER_KIND_PREFIX).toBe("trigger.");
    expect(isTriggerKind("trigger.manual")).toBe(true);
    expect(isTriggerKind("trigger.webhook")).toBe(true);
    expect(isTriggerKind("control.trigger")).toBe(false);
  });

  it("recognizes only the canonical trigger parameter types", () => {
    for (const type of TRIGGER_PARAM_TYPES) {
      expect(isTriggerParamType(type)).toBe(true);
    }
    expect(isTriggerParamType("workflow")).toBe(false);
    expect(isTriggerParamType(null)).toBe(false);
  });
});
