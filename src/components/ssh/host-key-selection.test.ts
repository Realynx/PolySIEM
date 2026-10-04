import { describe, expect, it } from "vitest";
import { preferredHostKeyFingerprint } from "./host-key-selection";

/**
 * The rule that decides which key a single click would pin.
 *
 * It is tested here rather than in each enrollment screen because the whole
 * reason this module exists is that those screens each carried their own copy
 * and the copies had diverged.
 */
describe("which host key a scan preselects", () => {
  const keys = [
    { algorithm: "ssh-ed25519", fingerprint: "SHA256:aaa" },
    { algorithm: "ssh-rsa", fingerprint: "SHA256:bbb" },
  ];

  it("lets an explicit pick beat everything else", () => {
    // The operator compared this one out of band. Nothing overrides that.
    expect(preferredHostKeyFingerprint("SHA256:bbb", "SHA256:aaa", keys)).toBe("SHA256:bbb");
  });

  it("offers the already-enrolled key rather than a different one", () => {
    expect(preferredHostKeyFingerprint("", "SHA256:bbb", keys)).toBe("SHA256:bbb");
  });

  it("takes a lone observed key, because there is nothing to choose between", () => {
    expect(preferredHostKeyFingerprint("", null, [keys[0]])).toBe("SHA256:aaa");
  });

  it("refuses to guess between several unknown keys", () => {
    // A default here would be a guess about which host identity to trust.
    expect(preferredHostKeyFingerprint("", null, keys)).toBe("");
  });

  it("returns an empty string, never undefined, so callers can gate a button on it", () => {
    expect(preferredHostKeyFingerprint("", undefined, [])).toBe("");
  });
});
