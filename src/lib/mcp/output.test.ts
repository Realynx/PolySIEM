import { describe, expect, it } from "vitest";
import { capText, formatJson, sanitizeOutput, sanitizeText } from "./output";
import { decodeCursor, encodeCursor, pageArray, pageWindow, toPage } from "./pagination";

describe("sanitizeOutput", () => {
  it("drops stored secrets and hashes but keeps public key material", () => {
    const out = sanitizeOutput({
      id: "c1",
      name: "edge",
      encryptedCredentials: "v1:abc",
      installTokenHash: "deadbeef",
      passwordHash: "$argon2",
      sshPublicKey: "ssh-ed25519 AAAA",
      publicKey: "wg-pub",
      fingerprint: "SHA256:xyz",
      metadata: { cipassword: "hunter2", x_passphrase: "wifi-pass", vmid: 101 },
      createdAt: new Date("2026-01-02T00:00:00Z"),
      size: BigInt(5),
    }) as Record<string, unknown>;
    expect(out).toMatchObject({ id: "c1", name: "edge", sshPublicKey: "ssh-ed25519 AAAA", publicKey: "wg-pub", fingerprint: "SHA256:xyz", createdAt: "2026-01-02T00:00:00.000Z", size: "5" });
    expect(out).not.toHaveProperty("encryptedCredentials");
    expect(out).not.toHaveProperty("installTokenHash");
    expect(out).not.toHaveProperty("passwordHash");
    expect(out.metadata).toEqual({ vmid: 101 });
  });

  it("redacts secrets embedded in free text", () => {
    const out = sanitizeOutput({
      note: "token=abc123 and Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y",
      pasted: "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
      apiToken: "ps_ABCDEFGHIJKLMNOPQRSTUV",
      inline: "use ps_ABCDEFGHIJKLMNOPQRSTUV here",
    }) as Record<string, string>;
    expect(out.note).not.toContain("abc123");
    expect(out.note).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out.pasted).toBe("[REDACTED]");
    expect(out.inline).not.toContain("ps_ABCDEF");
  });

  it("anonymizes names and addresses when the token owner uses anonymous mode, keeping ids", () => {
    const out = sanitizeOutput({ id: "dev1", name: "nas-01", ipAddress: "10.0.3.5" }, { anonymize: true }) as Record<string, string>;
    expect(out.id).toBe("dev1");
    expect(out.name).not.toBe("nas-01");
    expect(out.ipAddress).not.toBe("10.0.3.5");
  });

  it("passes secrets through only when explicitly allowed (audited credential tool)", () => {
    const out = sanitizeOutput({ secret: "s3cret" }, { allowSecrets: true }) as Record<string, string>;
    expect(out.secret).toBe("s3cret");
  });

  it("scrubs markdown text", () => {
    expect(sanitizeText("password: hunter2")).not.toContain("hunter2");
  });
});

describe("formatJson / capText", () => {
  it("emits compact JSON", () => {
    expect(formatJson({ a: 1, b: [1, 2] })).toBe('{"a":1,"b":[1,2]}');
  });

  it("caps very large output with an actionable note", () => {
    const capped = capText("x".repeat(100), 10);
    expect(capped.startsWith("xxxxxxxxxx\n")).toBe(true);
    expect(capped).toContain("cursor");
  });
});

describe("pagination", () => {
  it("round-trips cursors and rejects garbage", () => {
    expect(decodeCursor(encodeCursor(75))).toBe(75);
    expect(decodeCursor(undefined)).toBe(0);
    expect(() => decodeCursor("not-a-cursor")).toThrow(/Invalid cursor/);
  });

  it("over-fetches by one to detect more pages", () => {
    const window = pageWindow({ limit: 2 });
    expect(window).toEqual({ skip: 0, take: 3, limit: 2 });
    const page = toPage(["a", "b", "c"], window, 7);
    expect(page.items).toEqual(["a", "b"]);
    expect(page.total).toBe(7);
    expect(decodeCursor(page.nextCursor ?? undefined)).toBe(2);
    expect(toPage(["a"], window).nextCursor).toBeNull();
  });

  it("pages in-memory arrays", () => {
    const first = pageArray([1, 2, 3, 4, 5], { limit: 2 });
    expect(first.items).toEqual([1, 2]);
    const second = pageArray([1, 2, 3, 4, 5], { limit: 2, cursor: first.nextCursor ?? undefined });
    expect(second.items).toEqual([3, 4]);
    const third = pageArray([1, 2, 3, 4, 5], { limit: 2, cursor: second.nextCursor ?? undefined });
    expect(third).toMatchObject({ items: [5], nextCursor: null, total: 5 });
  });
});
