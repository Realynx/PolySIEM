import { describe, expect, it } from "vitest";
import { buildTrafficResult, mockTunnelTraffic, type TunnelTrafficInput } from "./tunnel-traffic";

const TUNNELS: TunnelTrafficInput[] = [
  { id: "t1", name: "ObsidianCloudflared", originIp: "10.0.3.59", ingressHostnames: ["f0x.app", "canopydoc.com", "yeen.f0x.app"] },
  { id: "t2", name: "CloudflareConsult", originIp: "10.0.3.41", ingressHostnames: ["elucidations.net", "legacylanduse.com"] },
];

describe("buildTrafficResult — hostname mode", () => {
  it("attributes per-hostname buckets to the owning tunnel", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 100,
      hostnameBuckets: [
        { key: "f0x.app", doc_count: 50 },
        { key: "canopydoc.com", doc_count: 20 },
        { key: "elucidations.net", doc_count: 30 },
      ],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.mode).toBe("hostname");
    const t1 = result.tunnels.find((t) => t.tunnelId === "t1")!;
    const t2 = result.tunnels.find((t) => t.tunnelId === "t2")!;
    expect(t1.total).toBe(70);
    expect(t1.byHostname).toEqual([
      { hostname: "f0x.app", count: 50 },
      { hostname: "canopydoc.com", count: 20 },
    ]);
    expect(t2.total).toBe(30);
    expect(result.unattributed).toBe(0);
  });

  it("counts hostnames matching no tunnel as unattributed", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 40,
      hostnameBuckets: [
        { key: "f0x.app", doc_count: 25 },
        { key: "stranger.example.com", doc_count: 15 },
      ],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.unattributed).toBe(15);
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(25);
  });

  it("matches hostnames case-insensitively", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 10,
      hostnameBuckets: [{ key: "F0X.APP", doc_count: 10 }],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(10);
  });

  it("normalizes URL-shaped hostname buckets", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 10,
      hostnameBuckets: [{ key: "https://F0X.APP:443/path", doc_count: 10 }],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(10);
  });

  it("uses Cloudflared hostname buckets when the configured field cannot be attributed", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 10,
      hostnameBuckets: [{ key: "unknown.example.com", doc_count: 10 }],
      fallbackHostnameBuckets: [{ key: "f0x.app", doc_count: 10 }],
      hostBuckets: [],
      tunnels: TUNNELS,
    });

    expect(result.mode).toBe("hostname");
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(10);
  });

  it("sorts tunnels by total desc", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 100,
      hostnameBuckets: [
        { key: "f0x.app", doc_count: 10 },
        { key: "elucidations.net", doc_count: 90 },
      ],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.tunnels[0].tunnelId).toBe("t2");
  });
});

describe("buildTrafficResult — tunnel fallback mode", () => {
  it("falls back to per-host buckets when no hostname buckets exist", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 79,
      hostnameBuckets: [],
      hostBuckets: [
        { key: "obsidiancloudflared", doc_count: 49 },
        { key: "cloudflareconsult", doc_count: 30 },
      ],
      tunnels: TUNNELS,
    });
    expect(result.mode).toBe("tunnel");
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(49);
    expect(result.tunnels.find((t) => t.tunnelId === "t2")!.total).toBe(30);
    expect(result.tunnels[0].byHostname).toBeUndefined();
  });

  it("matches connector hosts by origin IP and discovered aliases", () => {
    const tunnels = [
      { ...TUNNELS[0], connectorAliases: ["cloudflared-edge"] },
      TUNNELS[1],
    ];
    const byIp = buildTrafficResult({
      window: "24h",
      total: 20,
      hostnameBuckets: [],
      hostBuckets: [{ key: "10.0.3.59", doc_count: 20 }],
      tunnels,
    });
    const byAlias = buildTrafficResult({
      window: "24h",
      total: 30,
      hostnameBuckets: [],
      hostBuckets: [{ key: "CLOUDFLARED-EDGE", doc_count: 30 }],
      tunnels,
    });

    expect(byIp.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(20);
    expect(byAlias.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(30);
  });

  it("uses connector attribution when hostname buckets do not match", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 79,
      hostnameBuckets: [{ key: "unknown.example.com", doc_count: 79 }],
      hostBuckets: [{ key: "obsidiancloudflared", doc_count: 79 }],
      tunnels: TUNNELS,
    });

    expect(result.mode).toBe("tunnel");
    expect(result.tunnels.find((t) => t.tunnelId === "t1")!.total).toBe(79);
  });

  it("does not present wholly unattributed events as zero traffic", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 79,
      hostnameBuckets: [{ key: "unknown.example.com", doc_count: 79 }],
      hostBuckets: [{ key: "unknown-connector", doc_count: 79 }],
      tunnels: TUNNELS,
    });

    expect(result.mode).toBe("unavailable");
    expect(result.total).toBe(79);
    expect(result.unattributed).toBe(79);
    expect(result.reason).toContain("could not be attributed");
  });

  it("is unavailable when there are no buckets at all", () => {
    const result = buildTrafficResult({
      window: "24h",
      total: 0,
      hostnameBuckets: [],
      hostBuckets: [],
      tunnels: TUNNELS,
    });
    expect(result.mode).toBe("unavailable");
    expect(result.reason).toBeTruthy();
  });
});

describe("mockTunnelTraffic", () => {
  it("produces stable, positive per-hostname counts", () => {
    const a = mockTunnelTraffic(TUNNELS, "24h");
    const b = mockTunnelTraffic(TUNNELS, "24h");
    expect(a).toEqual(b); // deterministic
    expect(a.mode).toBe("hostname");
    expect(a.total).toBeGreaterThan(0);
    expect(a.tunnels.every((t) => t.total > 0)).toBe(true);
  });
});
