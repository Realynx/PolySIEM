import { describe, expect, it } from "vitest";
import {
  emptySnapshot,
  type SecuritySnapshot,
  type SnapshotGuest,
  type SnapshotHost,
  type SnapshotService,
  type SnapshotWirelessNetwork,
} from "../types";
import { checkHardening } from "./hardening";

const NOW = "2026-07-17T12:00:00.000Z";

let seq = 0;
function host(partial: Partial<SnapshotHost>): SnapshotHost {
  seq += 1;
  return {
    id: `h${seq}`,
    name: `host-${seq}`,
    kind: "hypervisor",
    source: "PROXMOX",
    status: "ACTIVE",
    lastSeenAt: NOW,
    hasDescription: true,
    sshKeyCount: 1,
    ...partial,
  };
}

function guest(partial: Partial<SnapshotGuest>): SnapshotGuest {
  seq += 1;
  return {
    id: `g${seq}`,
    kind: "container",
    name: `guest-${seq}`,
    source: "PROXMOX",
    status: "ACTIVE",
    powerState: "RUNNING",
    lastSeenAt: NOW,
    hasDescription: true,
    firewallPresent: true,
    firewallEnabled: true,
    sshKeyCount: 1,
    ...partial,
  };
}

function wifi(partial: Partial<SnapshotWirelessNetwork>): SnapshotWirelessNetwork {
  seq += 1;
  return {
    id: `w${seq}`,
    name: `ssid-${seq}`,
    enabled: true,
    status: "ACTIVE",
    security: "wpapsk",
    wpaMode: "wpa2",
    ...partial,
  };
}

function service(partial: Partial<SnapshotService>): SnapshotService {
  seq += 1;
  return {
    id: `s${seq}`,
    name: `svc-${seq}`,
    status: "ACTIVE",
    port: 8080,
    protocol: "tcp",
    plaintextHttp: false,
    ...partial,
  };
}

function snap(partial: Partial<SecuritySnapshot>): SecuritySnapshot {
  return { ...emptySnapshot(NOW), ...partial };
}

function byId(findings: ReturnType<typeof checkHardening>, id: string) {
  return findings.find((f) => f.id === id);
}

describe("checkHardening", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(checkHardening(snap({}))).toEqual([]);
  });

  describe("SSH key coverage vs password auth (headline)", () => {
    it("flags ACTIVE hosts and RUNNING guests with no documented key as high", () => {
      const findings = checkHardening(
        snap({
          hosts: [host({ name: "pve1", sshKeyCount: 0 }), host({ name: "pve2", sshKeyCount: 2 })],
          guests: [
            guest({ name: "ct-nokey", sshKeyCount: 0 }),
            guest({ name: "vm-nokey", kind: "vm", sshKeyCount: 0 }),
            guest({ name: "ct-keyed", sshKeyCount: 1 }),
          ],
        }),
      );
      const f = byId(findings, "hardening-ssh-key-coverage");
      expect(f?.severity).toBe("high");
      expect(f?.category).toBe("hardening");
      expect(f?.affected.map((a) => a.name).sort()).toEqual(["ct-nokey", "pve1", "vm-nokey"]);
      // device + container + vm kinds preserved
      expect(f?.affected.find((a) => a.name === "pve1")?.kind).toBe("device");
      expect(f?.affected.find((a) => a.name === "vm-nokey")?.kind).toBe("vm");
    });

    it("scales weight by machine count, 6 each, capped at 30", () => {
      const one = checkHardening(snap({ hosts: [host({ sshKeyCount: 0 })] }));
      expect(byId(one, "hardening-ssh-key-coverage")?.weight).toBe(6);

      const three = checkHardening(
        snap({ hosts: [host({ sshKeyCount: 0 }), host({ sshKeyCount: 0 }), host({ sshKeyCount: 0 })] }),
      );
      expect(byId(three, "hardening-ssh-key-coverage")?.weight).toBe(18);

      const many = checkHardening(
        snap({ hosts: Array.from({ length: 10 }, () => host({ sshKeyCount: 0 })) }),
      );
      expect(byId(many, "hardening-ssh-key-coverage")?.weight).toBe(30); // capped
    });

    it("only judges fairly: skips non-ACTIVE hosts and non-RUNNING/non-ACTIVE guests", () => {
      const findings = checkHardening(
        snap({
          hosts: [
            host({ name: "stale-host", status: "STALE", sshKeyCount: 0 }),
          ],
          guests: [
            guest({ name: "stopped", powerState: "STOPPED", sshKeyCount: 0 }),
            guest({ name: "removed", status: "REMOVED", sshKeyCount: 0 }),
          ],
        }),
      );
      expect(byId(findings, "hardening-ssh-key-coverage")).toBeUndefined();
    });

    it("does not fire when every judged machine has a key", () => {
      const findings = checkHardening(
        snap({ hosts: [host({ sshKeyCount: 1 })], guests: [guest({ sshKeyCount: 3 })] }),
      );
      expect(byId(findings, "hardening-ssh-key-coverage")).toBeUndefined();
    });
  });

  describe("WiFi weak encryption", () => {
    it("flags WEP and WPA1-PSK, but not open/WPA2/WPA3/enterprise", () => {
      const findings = checkHardening(
        snap({
          wirelessNetworks: [
            wifi({ name: "wep-net", security: "wep", wpaMode: null }),
            wifi({ name: "wpa1-plain", security: "wpa", wpaMode: null }),
            wifi({ name: "wpa1-mode", security: "wpapsk", wpaMode: "wpa1" }),
            wifi({ name: "wpa2-net", security: "wpapsk", wpaMode: "wpa2" }),
            wifi({ name: "wpa3-net", security: "wpapsk", wpaMode: "wpa3" }),
            wifi({ name: "enterprise", security: "wpaeap", wpaMode: "wpa2" }),
            // open is owned by the exposure module — must NOT appear here
            wifi({ name: "guest-open", security: "open", wpaMode: null }),
          ],
        }),
      );
      const f = byId(findings, "hardening-wifi-weak-encryption");
      expect(f?.severity).toBe("medium");
      expect(f?.affected.map((a) => a.name).sort()).toEqual([
        "wep-net (WEP)",
        "wpa1-mode (WPA1)",
        "wpa1-plain (WPA1)",
      ]);
    });

    it("ignores disabled and non-ACTIVE weak networks and caps weight at 12", () => {
      const findings = checkHardening(
        snap({
          wirelessNetworks: [
            wifi({ name: "off", security: "wep", enabled: false }),
            wifi({ name: "removed", security: "wep", status: "REMOVED" }),
            wifi({ security: "wep" }),
            wifi({ security: "wep" }),
            wifi({ security: "wep" }),
          ],
        }),
      );
      const f = byId(findings, "hardening-wifi-weak-encryption");
      expect(f?.affected).toHaveLength(3);
      expect(f?.weight).toBe(12); // 6*3 = 18, capped at 12
    });
  });

  describe("plaintext HTTP services", () => {
    it("flags ACTIVE plaintext-http services as low, scaled and capped at 8", () => {
      const findings = checkHardening(
        snap({
          services: [
            service({ name: "grafana", plaintextHttp: true }),
            service({ name: "https-svc", plaintextHttp: false }),
            service({ name: "stale-http", plaintextHttp: true, status: "STALE" }),
          ],
        }),
      );
      const f = byId(findings, "hardening-plaintext-http-service");
      expect(f?.severity).toBe("low");
      expect(f?.affected.map((a) => a.name)).toEqual(["grafana"]);
      expect(f?.affected[0].kind).toBe("service");
      expect(f?.weight).toBe(2);

      const many = checkHardening(
        snap({ services: Array.from({ length: 6 }, (_, i) => service({ name: `p${i}`, plaintextHttp: true })) }),
      );
      expect(byId(many, "hardening-plaintext-http-service")?.weight).toBe(8); // 2*6=12, capped
    });
  });

  describe("SSH key modernity", () => {
    it("nudges toward ed25519 when keys exist but none are ed25519", () => {
      const findings = checkHardening(
        snap({
          sshKeys: [
            { id: "k1", name: "rsa", keyType: "ssh-rsa", bits: 4096, deploymentCount: 2 },
            { id: "k2", name: "ecdsa", keyType: "ecdsa-sha2-nistp256", bits: 256, deploymentCount: 1 },
          ],
        }),
      );
      const f = byId(findings, "hardening-ssh-no-ed25519");
      expect(f?.severity).toBe("info");
      expect(f?.weight).toBe(2);
      expect(f?.affected.map((a) => a.name).sort()).toEqual(["ecdsa", "rsa"]);
    });

    it("stays quiet when at least one ed25519 key is documented", () => {
      const findings = checkHardening(
        snap({
          sshKeys: [
            { id: "k1", name: "rsa", keyType: "ssh-rsa", bits: 4096, deploymentCount: 1 },
            { id: "k2", name: "modern", keyType: "ssh-ed25519", bits: 256, deploymentCount: 1 },
          ],
        }),
      );
      expect(byId(findings, "hardening-ssh-no-ed25519")).toBeUndefined();
    });

    it("stays quiet when there are no keys at all", () => {
      expect(byId(checkHardening(snap({ sshKeys: [] })), "hardening-ssh-no-ed25519")).toBeUndefined();
    });
  });
});
