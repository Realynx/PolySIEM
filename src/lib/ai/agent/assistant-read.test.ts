import { describe, expect, it } from "vitest";
import type { InvestigationReport } from "@/lib/ai/agent/contract";
import type { FootprintGraph, FootprintMachine } from "@/lib/topology/footprint";
import type { SecurityTicketDto } from "@/lib/types";
import {
  compactFocusedTopology,
  compactSecurityTicketContext,
  securityTicketSummary,
} from "./assistant-read";

function machine(id: string, name = id): FootprintMachine {
  return {
    id,
    name,
    kind: "ct",
    ips: ["10.0.3.50"],
    hostId: "host-1",
    primaryNetworkId: "net-1",
    secondaryNetworkIds: [],
    inboundNat: 0,
    inboundTunnel: 1,
  };
}

function focusedGraph(): FootprintGraph {
  const subject = machine("ct-1", "fl-automate");
  return {
    lanes: [
      {
        id: "net-1",
        name: "Local servers",
        vlanId: 30,
        cidr: "10.0.3.0/24",
        category: "lan",
        machines: [subject],
        clients: [],
      },
    ],
    firewalls: [],
    switches: [],
    reachability: [
      {
        id: "reach-1",
        source: "internet",
        target: "net-1",
        label: "tcp 443",
        rules: [
          {
            ruleId: "rule-1",
            externalId: null,
            sequence: 1,
            description: "Published HTTPS",
            protocol: "tcp",
            ports: "443",
          },
        ],
      },
    ],
    inbound: [
      {
        id: "tunnel-edge",
        type: "tunnel",
        targetId: "ct-1",
        label: "fl-automate.com",
        enabled: true,
        sourceRestricted: false,
        detail: [{ primary: "fl-automate.com", secondary: "cloudflared" }],
      },
    ],
    unknownTargets: [],
    switchLinks: [],
    gateways: [],
    dyndns: [],
    tunnels: [
      {
        id: "tun-1",
        name: "cloudflared",
        provider: "cloudflare",
        targetId: "ct-1",
        hostnames: [],
      },
    ],
    routes: [
      {
        id: "route:fl-automate.com",
        hostname: "fl-automate.com",
        tunnelId: "tun-1",
        tunnelName: "cloudflared",
        provider: "cloudflare",
        classification: "proxied",
        resolvedIps: [],
        serviceTarget: "http://10.0.3.50:3001",
        targetId: "ct-1",
      },
    ],
    wanIp: null,
    stats: {
      openPorts: 1,
      tunnelHostnames: 1,
      dyndnsNames: 0,
      exposedHostnames: 0,
    },
    unmapped: [],
  };
}

function investigation(): InvestigationReport {
  return {
    summary: "Investigated the event.",
    verdict: "suspicious",
    confidence: 72,
    ips: [
      {
        ip: "203.0.113.42",
        scope: "external",
        identity: null,
        reverseDns: null,
        asn: "AS64500",
        reputation: "unknown",
        activity: "Requested the published route",
      },
    ],
    resolution: [
      {
        order: 1,
        action: "Review requests",
        rationale: "Confirm expected traffic",
        changesState: false,
      },
    ],
    meta: {
      model: "test-model",
      toolCalls: [],
      generatedAt: "2026-07-18T00:00:00.000Z",
      externalSourcesUsed: [],
    },
  };
}

function ticket(): SecurityTicketDto {
  return {
    id: "ticket-1",
    title: "Published route probing",
    summary: "Repeated requests reached the service.",
    severity: "MEDIUM",
    status: "OPEN",
    category: "recon",
    createdBy: "ai",
    suggestions: "Review and monitor.",
    refs: {
      srcIps: ["203.0.113.42"],
      destIps: ["10.0.3.50"],
      signatures: ["HTTP probe"],
      hosts: ["fl-automate.com"],
    },
    evidence: {
      scope: "cloudflared",
      samples: Array.from({ length: 15 }, (_, index) => ({
        timestamp: `2026-07-18T00:00:${String(index).padStart(2, "0")}.000Z`,
        index: "cloudflared-2026.07.18",
        message: `GET /probe/${index}`,
        raw: { authorization: "secret-cookie", huge: "x".repeat(10_000) },
      })),
    },
    investigation: investigation(),
    investigatedAt: "2026-07-18T01:00:00.000Z",
    investigationStatus: "success",
    investigationProgress: null,
    timesSeen: 15,
    lastSeenAt: "2026-07-18T00:00:14.000Z",
    scanRunId: "scan-1",
    closedAt: null,
    closedByName: null,
    resolution: null,
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T01:00:00.000Z",
  };
}

describe("compactFocusedTopology", () => {
  it("keeps the published tunnel route that makes an asset reachable", () => {
    const result = compactFocusedTopology(focusedGraph(), "ct-1");

    expect(result.subject.name).toBe("fl-automate");
    expect(result.publishedRoutes).toEqual([
      expect.objectContaining({
        hostname: "fl-automate.com",
        tunnelId: "tun-1",
        targetId: "ct-1",
        serviceTarget: "http://10.0.3.50:3001",
      }),
    ]);
    expect(result.inbound[0]).toMatchObject({
      type: "tunnel",
      targetId: "ct-1",
    });
    expect(result.truncated).toBe(false);
  });

  it("bounds relationship arrays", () => {
    const graph = focusedGraph();
    graph.routes = Array.from({ length: 40 }, (_, index) => ({
      ...graph.routes[0],
      id: `route:${index}.example.test`,
      hostname: `${index}.example.test`,
    }));

    const result = compactFocusedTopology(graph, "ct-1");
    expect(result.publishedRoutes).toHaveLength(24);
    expect(result.truncated).toBe(true);
  });
});

describe("security ticket assistant views", () => {
  it("keeps list rows small by omitting evidence and investigation bodies", () => {
    const result = securityTicketSummary(ticket());
    expect(result).not.toHaveProperty("evidence");
    expect(result).not.toHaveProperty("investigation");
    expect(result).toMatchObject({ verdict: "suspicious", confidence: 72 });
  });

  it("caps evidence samples and never returns raw evidence documents", () => {
    const result = compactSecurityTicketContext(ticket());
    expect(result.evidence?.samples).toHaveLength(12);
    expect(result.evidence?.truncated).toBe(true);
    expect(result.evidence?.sampleCount).toBe(15);
    expect(JSON.stringify(result)).not.toContain("secret-cookie");
    expect(result.investigation).not.toHaveProperty("toolCalls");
  });
});
