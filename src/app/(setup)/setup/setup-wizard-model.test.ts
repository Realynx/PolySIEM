import { describe, expect, it } from "vitest";
import { setupInitialStep, validateAdministrator } from "./setup-wizard-model";

describe("setup wizard model", () => {
  it("resumes at the persisted setup stage", () => {
    expect(setupInitialStep("welcome")).toBe(0);
    expect(setupInitialStep("complete")).toBe(0);
    expect(setupInitialStep("ai")).toBe(3);
    expect(setupInitialStep("integrations")).toBe(4);
    expect(setupInitialStep("tutorial")).toBe(5);
  });

  it("validates administrator credentials in the expected order", () => {
    expect(validateAdministrator("ab", "password", "password")).toBe("Username must be at least 3 characters");
    expect(validateAdministrator("bad user", "password", "password")).toContain("letters, numbers");
    expect(validateAdministrator("admin", "short", "short")).toBe("Password must be at least 8 characters");
    expect(validateAdministrator("admin", "password-one", "password-two")).toBe("Passwords do not match");
    expect(validateAdministrator("admin.name", "password", "password")).toBeNull();
  });
});
