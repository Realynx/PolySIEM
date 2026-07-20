import { describe, it, expect } from "vitest";
import { redactSecrets, redactValue, toResultPreview, REDACTED } from "@/lib/ai/agent/redact";

describe("redactSecrets", () => {
  it("redacts caller-supplied literal secrets", () => {
    const out = redactSecrets("the key is s3cr3t-value-123 ok", ["s3cr3t-value-123"]);
    expect(out).toBe(`the key is ${REDACTED} ok`);
  });

  it("ignores very short literals to avoid over-redaction", () => {
    expect(redactSecrets("abc def", ["ab"])).toBe("abc def");
  });

  it("redacts inline key: value credential shapes", () => {
    expect(redactSecrets("apiKey: abc123def")).toBe(`apiKey: ${REDACTED}`);
    expect(redactSecrets("password=hunter2")).toBe(`password=${REDACTED}`);
    expect(redactSecrets("AbuseIPDB-Key: ZZZ9990")).toBe(`AbuseIPDB-Key: ${REDACTED}`);
  });

  it("redacts Authorization scheme tokens", () => {
    expect(redactSecrets("Authorization: Bearer eyJhbGciOi.J9.sig")).toContain(`Bearer ${REDACTED}`);
    expect(redactSecrets("ApiKey abcdef123456")).toBe(`ApiKey ${REDACTED}`);
  });

  it("leaves ordinary text untouched", () => {
    const text = "10.0.3.16 talked to 1.1.1.1 on port 443";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("redactValue", () => {
  it("redacts sensitive object keys wholesale", () => {
    const out = redactValue({ user: "fox", password: "hunter2", nested: { apiKey: "xyz", ok: 1 } });
    expect(out).toEqual({ user: "fox", password: REDACTED, nested: { apiKey: REDACTED, ok: 1 } });
  });

  it("redacts sensitive terminal segments in flattened log-field paths", () => {
    const out = redactValue({
      "http.request.headers.authorization": "Bearer secret-value",
      "http.request.headers.cookie": "session=secret-value",
      "http.response.headers.set-cookie": "session=secret-value",
      "labels[password]": "secret-value",
      "labels['api key']": "secret-value",
      "metadata[private_key]": "secret-value",
      "oauth.access_token": "secret-value",
    });

    expect(out).toEqual({
      "http.request.headers.authorization": REDACTED,
      "http.request.headers.cookie": REDACTED,
      "http.response.headers.set-cookie": REDACTED,
      "labels[password]": REDACTED,
      "labels['api key']": REDACTED,
      "metadata[private_key]": REDACTED,
      "oauth.access_token": REDACTED,
    });
  });

  it("does not over-redact ordinary fields with security-related substrings", () => {
    const value = {
      "http.authorization_status": "allowed",
      "metrics.token_count": 42,
      "request.cookie_size": 128,
      authentication: "mTLS",
      secretive: "ordinary adjective",
    };

    expect(redactValue(value)).toEqual(value);
  });

  it("recurses into arrays and redacts string leaves", () => {
    const out = redactValue(["token=abcdef123", "plain"]);
    expect(out[0]).toBe(`token=${REDACTED}`);
    expect(out[1]).toBe("plain");
  });

  it("passes through numbers, booleans, null", () => {
    expect(redactValue({ a: 1, b: true, c: null })).toEqual({ a: 1, b: true, c: null });
  });
});

describe("toResultPreview", () => {
  it("stringifies and redacts objects", () => {
    const preview = toResultPreview({ secret: "abc", ip: "1.1.1.1" });
    expect(preview).toContain("1.1.1.1");
    expect(preview).toContain(REDACTED);
    expect(preview).not.toContain('"abc"');
  });

  it("caps long output", () => {
    const preview = toResultPreview("x".repeat(1000), 100);
    expect(preview.length).toBeLessThanOrEqual(101);
    expect(preview.endsWith("…")).toBe(true);
  });
});
