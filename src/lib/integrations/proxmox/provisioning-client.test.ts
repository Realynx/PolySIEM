import { afterEach, describe, expect, it, vi } from "vitest";
import type { DriverConfig } from "../types";
import { createPveContainer, getPveContainerOptions } from "./client";

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

describe("Proxmox container provisioning client", () => {
  it("discovers VMID, root storage, downloaded templates, and active bridges", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      let data: unknown;
      if (url.endsWith("/cluster/nextid")) data = "321";
      else if (url.endsWith("/nodes/pve1/storage")) {
        data = [
          { storage: "local", content: "iso,vztmpl,backup", active: 1, avail: 100 },
          { storage: "local-zfs", content: "images,rootdir", active: 1, avail: 200 },
          { storage: "offline", content: "rootdir", active: 0, avail: 300 },
        ];
      } else if (url.endsWith("/nodes/pve1/network")) {
        data = [
          { iface: "vmbr0", type: "bridge", active: 1 },
          { iface: "vmbr9", type: "bridge", active: 0 },
          { iface: "eno1", type: "eth", active: 1 },
        ];
      } else if (url.includes("/storage/local/content?content=vztmpl")) {
        data = [{ volid: "local:vztmpl/debian-12.tar.zst" }];
      } else throw new Error(`Unexpected URL ${url}`);
      return new Response(JSON.stringify({ data }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(getPveContainerOptions(cfg, "pve1")).resolves.toEqual({
      nextVmid: 321,
      storages: [{ id: "local-zfs", availableBytes: 200 }],
      templates: [{ id: "local:vztmpl/debian-12.tar.zst", label: "debian-12.tar.zst" }],
      networks: [{ id: "vmbr0" }],
    });
  });

  it("submits only the reviewed LXC fields and injects the public SSH key", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: "UPID:pve1:task" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createPveContainer(cfg, {
        node: "pve1",
        vmid: 321,
        hostname: "app-01",
        template: "local:vztmpl/debian-12.tar.zst",
        rootStorage: "local-zfs",
        diskGiB: 8,
        cores: 2,
        memoryMiB: 1024,
        swapMiB: 256,
        bridge: "vmbr0",
        ipv4Mode: "static",
        ipv4Address: "10.0.20.50/24",
        gateway: "10.0.20.1",
        vlanTag: 20,
        publicKey: "ssh-ed25519 AAAATEST polysiem",
        unprivileged: true,
        start: true,
        firewall: true,
      }),
    ).resolves.toBe("UPID:pve1:task");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://pve.example:8006/api2/json/nodes/pve1/lxc");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "PVEAPIToken=polysiem@pve!api=secret",
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toMatchObject({
      vmid: "321",
      hostname: "app-01",
      ostemplate: "local:vztmpl/debian-12.tar.zst",
      rootfs: "local-zfs:8",
      net0: "name=eth0,bridge=vmbr0,ip=10.0.20.50/24,firewall=1,gw=10.0.20.1,tag=20",
      "ssh-public-keys": "ssh-ed25519 AAAATEST polysiem",
      unprivileged: "1",
      start: "1",
    });
    expect(body.has("password")).toBe(false);
  });
});
