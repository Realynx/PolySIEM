import { describe, expect, it } from "vitest";
import {
  focusedTunnelTraceIdentity,
  type TraceTunnelIdentityInput,
} from "./log-trace-identity";

const tunnel: TraceTunnelIdentityInput = {
  id: "tunnel-1",
  name: "ObsidianCloudflared",
  originIp: "10.0.3.59",
  ingressHostnames: [
    "fl-automate.com",
    "ai.fl-automate.com",
    "unrelated.example.com",
  ],
  deviceId: null,
  vmId: null,
  containerId: "cloudflared-container",
  hostnames: [
    {
      hostname: "fl-automate.com",
      metadata: { serviceTarget: "http://10.0.3.50:3001" },
    },
    {
      hostname: "ai.fl-automate.com",
      metadata: { serviceTarget: "http://10.0.3.51:3002" },
    },
    {
      hostname: "unrelated.example.com",
      metadata: { serviceTarget: "http://10.0.3.99:8080" },
    },
  ],
};

describe("focusedTunnelTraceIdentity", () => {
  it("associates the published hostname whose service target is the asset", () => {
    expect(
      focusedTunnelTraceIdentity(
        { type: "containers", id: "fl-automate", ips: ["10.0.3.50"] },
        [tunnel],
      ),
    ).toEqual({
      names: [],
      ips: [],
      domains: ["fl-automate.com"],
    });
  });

  it("does not pull unrelated hostnames from the same shared tunnel", () => {
    const identity = focusedTunnelTraceIdentity(
      { type: "containers", id: "fl-automate", ips: ["10.0.3.50"] },
      [tunnel],
    );
    expect(identity.names).not.toContain("ObsidianCloudflared");
    expect(identity.ips).not.toContain("10.0.3.59");
    expect(identity.domains).not.toContain("ai.fl-automate.com");
    expect(identity.domains).not.toContain("unrelated.example.com");
  });

  it("keeps all ingress hostnames when the asset owns the tunnel connector", () => {
    const identity = focusedTunnelTraceIdentity(
      {
        type: "containers",
        id: "cloudflared-container",
        ips: ["10.0.3.59"],
      },
      [tunnel],
    );
    expect(identity.domains).toEqual(tunnel.ingressHostnames);
  });
});
