import { describe, expect, it } from "vitest";
import { emptySnapshot, type SecuritySnapshot, type SnapshotPortForward } from "../types";
import { checkExposure } from "./exposure";

const NOW = "2026-07-17T12:00:00.000Z";

let seq = 0;
function forward(partial: Partial<SnapshotPortForward>): SnapshotPortForward {
  seq += 1;
  return {
    id: `pf${seq}`,
    enabled: true,
    status: "ACTIVE",
    interfaceName: "WAN",
    protocol: "tcp",
    sourceSpec: null,
    destSpec: "wanip",
    destPort: "443",
    targetIp: "10.0.3.10",
    targetPort: null,
    description: null,
    ...partial,
  };
}

function snap(partial: Partial<SecuritySnapshot>): SecuritySnapshot {
  return { ...emptySnapshot(NOW), ...partial };
}

function ids(findings: ReturnType<typeof checkExposure>) {
  return findings.map((f) => f.id);
}

describe("checkExposure", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(checkExposure(snap({}))).toEqual([]);
  });

  it("raises a critical per sensitive port forward open to the world", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ id: "ssh", destPort: "22", targetIp: "10.0.1.5" }),
          forward({ id: "rdp", destPort: "3389", targetIp: "10.0.1.6" }),
        ],
      }),
    );
    const crits = findings.filter((f) => f.severity === "critical");
    expect(crits).toHaveLength(2);
    expect(ids(findings)).toContain("exposure-sensitive-forward:ssh");
    expect(ids(findings)).toContain("exposure-sensitive-forward:rdp");
    expect(crits[0].category).toBe("exposure");
  });

  it("matches sensitive ports inside ranges and via the target port", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ id: "range", destPort: "3300-3400" }), // covers 3306 and 3389
          forward({ id: "remap", destPort: "50022", targetPort: "22" }),
        ],
      }),
    );
    expect(ids(findings)).toContain("exposure-sensitive-forward:range");
    expect(ids(findings)).toContain("exposure-sensitive-forward:remap");
  });

  it("downgrades source-restricted sensitive forwards to a grouped medium", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ destPort: "22", sourceSpec: "203.0.113.7" }),
          forward({ destPort: "5432", sourceSpec: "TrustedPeers" }),
        ],
      }),
    );
    expect(findings.filter((f) => f.severity === "critical")).toHaveLength(0);
    const f = findings.find((x) => x.id === "exposure-sensitive-forward-restricted");
    expect(f?.severity).toBe("medium");
    expect(f?.affected).toHaveLength(2);
  });

  it("lists non-sensitive internet-open forwards as a grouped low", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ destPort: "25565", description: "minecraft" }),
          forward({ destPort: "443" }),
          // restricted source — no finding at all
          forward({ destPort: "52820", protocol: "udp", sourceSpec: "CumZone" }),
          // disabled — ignored
          forward({ destPort: "4950", enabled: false }),
          // LAN-side redirect (not WAN) — ignored
          forward({ destPort: "443", interfaceName: "LocalWGVpn", destSpec: "" }),
        ],
      }),
    );
    expect(ids(findings)).toEqual(["exposure-open-forward"]);
    const f = findings[0];
    expect(f.severity).toBe("low");
    expect(f.affected).toHaveLength(2);
    expect(f.affected[0].name).toContain("minecraft");
  });

  it("flags enabled dyndns hostnames that resolve to the WAN, skipping unresolved ones", () => {
    const findings = checkExposure(
      snap({
        dyndnsHosts: [
          { id: "d1", hostname: "vs1.example.com", enabled: true, status: "ACTIVE", matchesWan: true },
          { id: "d2", hostname: "proxied.example.com", enabled: true, status: "ACTIVE", matchesWan: false },
          { id: "d3", hostname: "unknown.example.com", enabled: true, status: "ACTIVE", matchesWan: null },
          { id: "d4", hostname: "off.example.com", enabled: false, status: "ACTIVE", matchesWan: true },
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-dyndns-unproxied");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name)).toEqual(["vs1.example.com"]);
  });

  it("flags unproxied tunnel ingress hostnames as high", () => {
    const findings = checkExposure(
      snap({
        tunnelHostnames: [
          { id: "t1", tunnelName: "main", hostname: "app.example.com", classification: "proxied" },
          { id: "t2", tunnelName: "main", hostname: "leak.example.com", classification: "unproxied-wan-exposed" },
          { id: "t3", tunnelName: "main", hostname: "elsewhere.example.com", classification: "unproxied-other" },
          { id: "t4", tunnelName: "main", hostname: "new.example.com", classification: null },
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-tunnel-hostname-unproxied");
    expect(f?.severity).toBe("high");
    expect(f?.affected.map((a) => a.name)).toEqual(["leak.example.com (main)"]);
  });

  it("flags open WiFi networks", () => {
    const findings = checkExposure(
      snap({
        wirelessNetworks: [
          { id: "w1", name: "lab-open", enabled: true, status: "ACTIVE", security: "open", wpaMode: null },
          { id: "w2", name: "lab", enabled: true, status: "ACTIVE", security: "wpapsk", wpaMode: "wpa3" },
          { id: "w3", name: "old-open", enabled: false, status: "ACTIVE", security: "open", wpaMode: null },
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-open-wifi");
    expect(f?.severity).toBe("high");
    expect(f?.affected.map((a) => a.name)).toEqual(["lab-open"]);
  });

  it("treats the newly-added sensitive ports (redis, mongo, elastic) as critical", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ id: "redis", destPort: "6379", targetIp: "10.0.1.20" }),
          forward({ id: "mongo", destPort: "27017", targetIp: "10.0.1.21" }),
          forward({ id: "elastic", destPort: "9200", targetIp: "10.0.1.22" }),
        ],
      }),
    );
    expect(ids(findings)).toContain("exposure-sensitive-forward:redis");
    expect(ids(findings)).toContain("exposure-sensitive-forward:mongo");
    expect(ids(findings)).toContain("exposure-sensitive-forward:elastic");
    expect(findings.filter((f) => f.severity === "critical")).toHaveLength(3);
  });

  it("flags a high volume of WAN forwards with a count-scaled, capped weight", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ destPort: "8001" }),
          forward({ destPort: "8002" }),
          forward({ destPort: "8003" }),
          forward({ destPort: "8004" }),
          forward({ destPort: "8005" }),
          forward({ destPort: "8006" }),
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-wan-forward-volume");
    expect(f?.severity).toBe("medium");
    expect(f?.affected).toHaveLength(6);
    // 6 forwards → weight 6 (below the cap of 8).
    expect(f?.weight).toBe(6);
  });

  it("caps the WAN-forward-volume weight at 8", () => {
    const findings = checkExposure(
      snap({
        portForwards: Array.from({ length: 12 }, (_, i) => forward({ destPort: `${9000 + i}` })),
      }),
    );
    expect(findings.find((x) => x.id === "exposure-wan-forward-volume")?.weight).toBe(8);
  });

  it("does not flag WAN-forward volume at or below the threshold of four", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ destPort: "8001" }),
          forward({ destPort: "8002" }),
          forward({ destPort: "8003" }),
          forward({ destPort: "8004" }),
        ],
      }),
    );
    expect(ids(findings)).not.toContain("exposure-wan-forward-volume");
  });

  it("flags forwards that expose a wide port range, ignoring narrow ranges", () => {
    const findings = checkExposure(
      snap({
        portForwards: [
          forward({ id: "wide", destPort: "8000-9000" }), // span 1001
          forward({ id: "narrow", destPort: "8000-8020" }), // span 21
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-wide-port-range");
    expect(f?.severity).toBe("low");
    expect(f?.affected.map((a) => a.id)).toEqual(["wide"]);
    // 1 wide forward → weight 2 (below the cap of 5).
    expect(f?.weight).toBe(2);
  });

  it("notes dyndns hostnames that have never resolved as an info-level unknown", () => {
    const findings = checkExposure(
      snap({
        dyndnsHosts: [
          { id: "d1", hostname: "known.example.com", enabled: true, status: "ACTIVE", matchesWan: true },
          { id: "d2", hostname: "new1.example.com", enabled: true, status: "ACTIVE", matchesWan: null },
          { id: "d3", hostname: "new2.example.com", enabled: true, status: "ACTIVE", matchesWan: null },
          // disabled — ignored
          { id: "d4", hostname: "off.example.com", enabled: false, status: "ACTIVE", matchesWan: null },
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-dyndns-unresolved");
    expect(f?.severity).toBe("info");
    expect(f?.affected.map((a) => a.name)).toEqual(["new1.example.com", "new2.example.com"]);
    // 2 unknown names → ceil(2/2) = 1 info point.
    expect(f?.weight).toBe(1);
  });

  it("tallies internet-reachable tunnel ingress as an info surface count once past the floor", () => {
    const findings = checkExposure(
      snap({
        tunnelHostnames: [
          { id: "t1", tunnelName: "main", hostname: "a.example.com", classification: "proxied" },
          { id: "t2", tunnelName: "main", hostname: "b.example.com", classification: "proxied" },
          { id: "t3", tunnelName: "main", hostname: "c.example.com", classification: "unproxied-wan-exposed" },
          // not internet-reachable — excluded from the tally
          { id: "t4", tunnelName: "main", hostname: "d.example.com", classification: "unproxied-other" },
          { id: "t5", tunnelName: "main", hostname: "e.example.com", classification: null },
        ],
      }),
    );
    const f = findings.find((x) => x.id === "exposure-tunnel-ingress-volume");
    expect(f?.severity).toBe("info");
    expect(f?.affected.map((a) => a.id)).toEqual(["t1", "t2", "t3"]);
    // 3 reachable → ceil(3/3) = 1 info point.
    expect(f?.weight).toBe(1);
  });

  it("does not tally tunnel ingress surface below the floor of three", () => {
    const findings = checkExposure(
      snap({
        tunnelHostnames: [
          { id: "t1", tunnelName: "main", hostname: "a.example.com", classification: "proxied" },
          { id: "t2", tunnelName: "main", hostname: "b.example.com", classification: "proxied" },
        ],
      }),
    );
    expect(ids(findings)).not.toContain("exposure-tunnel-ingress-volume");
  });
});
