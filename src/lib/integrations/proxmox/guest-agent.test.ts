import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import { fetchProxmoxSnapshotFromApi, mergeGuestAgentAddresses } from "./client";

const cfg: DriverConfig = {
  id: "pve-1",
  type: "PROXMOX",
  name: "PVE",
  baseUrl: "https://pve.example:8006",
  credentials: { tokenId: "polysiem@pve!api", tokenSecret: "secret" },
  verifyTls: true,
  settings: {},
};

afterEach(() => vi.unstubAllGlobals());

describe("Proxmox guest-agent address discovery", () => {
  it("matches a usable IPv4 address to the configured NIC by MAC", () => {
    const result = mergeGuestAgentAddresses(
      [{ name: "net0", mac: "BC:24:11:12:34:56", bridge: "vmbr0", vlanTag: 20, ip: null }],
      [{
        name: "eth0",
        "hardware-address": "bc:24:11:12:34:56",
        "ip-addresses": [
          { "ip-address": "fe80::1", "ip-address-type": "ipv6", prefix: 64 },
          { "ip-address": "10.0.20.15", "ip-address-type": "ipv4", prefix: 24 },
        ],
      }],
    );
    expect(result[0].ip).toBe("10.0.20.15");
  });

  it("ignores loopback and link-local addresses", () => {
    const result = mergeGuestAgentAddresses(
      [{ name: "net0", mac: "BC:24:11:12:34:56", bridge: "vmbr0", vlanTag: null, ip: null }],
      [{
        "hardware-address": "BC:24:11:12:34:56",
        "ip-addresses": [
          { "ip-address": "127.0.0.1", "ip-address-type": "ipv4" },
          { "ip-address": "169.254.1.2", "ip-address-type": "ipv4" },
        ],
      }],
    );
    expect(result[0].ip).toBeNull();
  });
});

describe("Proxmox snapshot guest collection", () => {
  it("fetches each guest request chain sequentially", async () => {
    let activeConfigRequests = 0;
    let maxActiveConfigRequests = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (/\/qemu\/\d+\/config$/.test(url)) {
        activeConfigRequests += 1;
        maxActiveConfigRequests = Math.max(maxActiveConfigRequests, activeConfigRequests);
        await Promise.resolve();
        activeConfigRequests -= 1;
        return jsonResponse({ memory: 512 });
      }
      if (url.endsWith("/firewall/options")) {
        return new Response("not configured", { status: 404 });
      }
      if (url.endsWith("/nodes")) return jsonResponse([{ node: "pve1", status: "online" }]);
      if (url.endsWith("/nodes/pve1/status")) return jsonResponse({});
      if (url.endsWith("/nodes/pve1/network")) return jsonResponse([]);
      if (url.endsWith("/nodes/pve1/qemu")) {
        return jsonResponse([
          { vmid: 101, status: "stopped" },
          { vmid: 102, status: "stopped" },
          { vmid: 103, status: "stopped" },
        ]);
      }
      if (url.endsWith("/nodes/pve1/lxc") || url.endsWith("/nodes/pve1/storage")) return jsonResponse([]);
      if (url.includes("/cluster/firewall/")) return jsonResponse([]);
      throw new Error(`Unexpected URL ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const snapshot = await fetchProxmoxSnapshotFromApi(cfg);

    expect(snapshot.guests.map((guest) => guest.vmid)).toEqual([101, 102, 103]);
    expect(maxActiveConfigRequests).toBe(1);
  });
});

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
