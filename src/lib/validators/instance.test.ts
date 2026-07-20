import { describe, expect, it } from "vitest";
import { INSTANCE_ACTION_CONFIRMATIONS, instanceActionSchema } from "./instance";

describe("instance action validator", () => {
  it("requires the action-specific exact confirmation phrase", () => {
    expect(() =>
      instanceActionSchema.parse({
        action: "reset",
        password: "correct horse battery staple",
        confirmation: INSTANCE_ACTION_CONFIRMATIONS.reset,
      }),
    ).not.toThrow();
    expect(() =>
      instanceActionSchema.parse({
        action: "reset",
        password: "correct horse battery staple",
        confirmation: INSTANCE_ACTION_CONFIRMATIONS.reinstall,
      }),
    ).toThrow();
  });

  it("does not accept an empty administrator password", () => {
    expect(() =>
      instanceActionSchema.parse({
        action: "reinstall",
        password: "",
        confirmation: INSTANCE_ACTION_CONFIRMATIONS.reinstall,
      }),
    ).toThrow();
  });
});
