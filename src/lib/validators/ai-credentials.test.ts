import { describe, expect, it } from "vitest";
import { createAiCredentialSchema, updateAiCredentialSchema } from "./ai-credentials";

const valid = { name: "grafana-admin", secret: "s3cret" };

describe("createAiCredentialSchema", () => {
  it("accepts a minimal credential", () => {
    const parsed = createAiCredentialSchema.parse(valid);
    expect(parsed.name).toBe("grafana-admin");
    expect(parsed.secret).toBe("s3cret");
  });

  it("accepts slug names with digits, '-', '_' and '.'", () => {
    for (const name of ["a", "0db", "pve-node.1", "svc_backup", "a.b-c_d9"]) {
      expect(() => createAiCredentialSchema.parse({ ...valid, name })).not.toThrow();
    }
  });

  it("rejects non-slug names", () => {
    for (const name of [
      "",
      "Grafana", // uppercase
      "-leading-dash", // must start with a-z/0-9
      ".leading-dot",
      "_leading-underscore",
      "has space",
      "café",
      "slash/name",
      "a".repeat(65), // too long
    ]) {
      expect(() => createAiCredentialSchema.parse({ ...valid, name })).toThrow();
    }
  });

  it("bounds the secret length (1-4096)", () => {
    expect(() => createAiCredentialSchema.parse({ ...valid, secret: "" })).toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, secret: "x" })).not.toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, secret: "x".repeat(4096) })).not.toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, secret: "x".repeat(4097) })).toThrow();
  });

  it("requires a secret on create", () => {
    expect(() => createAiCredentialSchema.parse({ name: "grafana-admin" })).toThrow();
  });

  it("bounds the optional fields", () => {
    expect(() =>
      createAiCredentialSchema.parse({
        ...valid,
        description: "d".repeat(500),
        username: "u".repeat(128),
        url: "h".repeat(512),
      }),
    ).not.toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, description: "d".repeat(501) })).toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, username: "u".repeat(129) })).toThrow();
    expect(() => createAiCredentialSchema.parse({ ...valid, url: "h".repeat(513) })).toThrow();
  });
});

describe("updateAiCredentialSchema", () => {
  it("accepts an empty patch (all fields optional)", () => {
    expect(updateAiCredentialSchema.parse({})).toEqual({});
  });

  it("keeps absent keys absent — an omitted secret means keep the stored one", () => {
    const patch = updateAiCredentialSchema.parse({ description: "rotated docs" });
    expect("secret" in patch).toBe(false);
    expect("name" in patch).toBe(false);
    expect(patch.description).toBe("rotated docs");
  });

  it("rejects an explicitly empty secret instead of treating it as 'keep'", () => {
    expect(() => updateAiCredentialSchema.parse({ secret: "" })).toThrow();
    expect(() => updateAiCredentialSchema.parse({ secret: "new-value" })).not.toThrow();
  });

  it("still enforces the name slug rules on update", () => {
    expect(() => updateAiCredentialSchema.parse({ name: "ok-name" })).not.toThrow();
    expect(() => updateAiCredentialSchema.parse({ name: "Not OK" })).toThrow();
  });

  it("allows nulling the clearable fields", () => {
    const patch = updateAiCredentialSchema.parse({ description: null, username: null, url: null });
    expect(patch.description).toBeNull();
    expect(patch.username).toBeNull();
    expect(patch.url).toBeNull();
  });
});
