import { describe, expect, it } from "vitest";
import { decodeEvidenceRaw, formatEvidenceSample, recoverTruncatedObject } from "./evidence-format";

describe("evidence formatting", () => {
  it("decodes string-encapsulated Suricata JSON into readable alert fields", () => {
    const original = JSON.stringify({
      source: { ip: "198.51.100.8", port: 4242 },
      destination: { ip: "10.0.3.50", port: 443 },
      network: { transport: "tcp" },
      suricata: {
        eve: {
          alert: {
            signature: "ET SCAN Suspicious inbound request",
            category: "Attempted Information Leak",
            severity: 2,
          },
        },
      },
    });
    const event = formatEvidenceSample(
      {
        timestamp: "2026-07-18T12:00:00.000Z",
        message: "fallback message",
        raw: { event: { original } },
      },
      "suricata",
    );

    expect(event.title).toBe("ET SCAN Suspicious inbound request");
    expect(event.route).toBe("198.51.100.8:4242 → 10.0.3.50:443");
    expect(event.badges).toContain("Medium (2)");
    expect(event.sections.find((section) => section.title === "Alert")?.fields).toContainEqual(
      expect.objectContaining({ label: "Category", value: "Attempted Information Leak" }),
    );
    expect(event.decodedRaw).toMatchObject({ event: { original: { source: { ip: "198.51.100.8" } } } });
  });

  it("recovers complete fields from the old truncated JSON-string wrapper", () => {
    const truncated =
      '{"source":{"ip":"203.0.113.9"},"destination":{"ip":"10.0.0.5","port":3306},"network":{"transport":"tcp"},"payload":"unfinished';
    expect(recoverTruncatedObject(`${truncated}…`)).toEqual({
      source: { ip: "203.0.113.9" },
      destination: { ip: "10.0.0.5", port: 3306 },
      network: { transport: "tcp" },
    });
    expect(decodeEvidenceRaw({ _truncated: `${truncated}…` }).truncated).toBe(true);
  });

  it("formats ordinary structured HTTP evidence without labeling it Suricata", () => {
    const event = formatEvidenceSample({
      timestamp: "2026-07-18T12:00:00.000Z",
      message: "Request rejected",
      raw: {
        source: { ip: "203.0.113.10" },
        http: { request: { method: "POST" }, response: { status_code: 403 } },
        url: { full: "https://app.example.test/admin" },
        user_agent: { original: "Mozilla/5.0" },
      },
    });

    expect(event.kind).toBe("HTTP event");
    expect(event.sections.find((section) => section.title === "Application")?.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Method", value: "POST" }),
        expect.objectContaining({ label: "Status", value: "403" }),
      ]),
    );
  });
});
