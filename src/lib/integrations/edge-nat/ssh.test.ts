import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import type { DriverConfig } from "../types";
import { parseEdgeSshUrl, runCommand, runVerifiedSsh, scanEdgeHostKeys, type CommandRunner } from "./ssh";

const hostPair = generateEd25519Keypair("host");
const clientPair = generateEd25519Keypair("client");
const hostLine = `[edge.example.test]:2222 ${hostPair.publicKeyLine}`;

function cfg(fingerprint = hostPair.fingerprint): DriverConfig {
  return {
    id: "edge-1", type: "EDGE_NAT_SERVER", name: "Edge", baseUrl: "ssh://edge.example.test:2222",
    credentials: { username: "polysiem-edge", privateKey: clientPair.privateKeyPem }, verifyTls: true,
    settings: { hostKeyFingerprint: fingerprint, publicInterface: "eth0", outboundInterface: "tailscale0", enableIpForwarding: true },
  };
}

describe("Edge NAT SSH transport", () => {
  it("normalizes ssh-keyscan output to SHA256 fingerprints", async () => {
    const keys = await scanEdgeHostKeys(cfg().baseUrl, async () => ({ stdout: `${hostLine}\n`, stderr: "", code: 0 }));
    expect(keys).toMatchObject([{ algorithm: "ssh-ed25519", fingerprint: hostPair.fingerprint }]);
  });

  it.each([
    ["ssh://edge.example.test", "edge.example.test", 22],
    ["ssh://192.0.2.10:2200", "192.0.2.10", 2200],
    ["ssh://[2001:db8::10]:2200", "2001:db8::10", 2200],
  ])("parses %s for OpenSSH tools", (url, host, port) => {
    expect(parseEdgeSshUrl(url)).toEqual({ host, port });
  });

  it("scans an IPv6 literal without URL brackets and forces IPv6", async () => {
    let receivedArgs: string[] = [];
    await scanEdgeHostKeys("ssh://[2001:db8::10]:2222", async (_command, args) => {
      receivedArgs = args;
      return { stdout: `[2001:db8::10]:2222 ${hostPair.publicKeyLine}\n`, stderr: "", code: 0 };
    });
    expect(receivedArgs).toEqual(["-6", "-T", "5", "-p", "2222", "2001:db8::10"]);
  });

  it("gives an actionable error when ssh-keyscan is not installed without exposing the process error", async () => {
    const missing = Object.assign(new Error("spawn C:\\secret\\ssh-keyscan ENOENT"), { code: "ENOENT" });
    await expect(scanEdgeHostKeys(cfg().baseUrl, async () => { throw missing; })).rejects.toMatchObject({
      code: "ssh_keyscan_unavailable",
      message: "SSH host-key scanning is unavailable on the PolySIEM server. Install the OpenSSH client package, then try again.",
    });
  });

  it("turns scanner diagnostics into safe connection guidance", async () => {
    await expect(scanEdgeHostKeys(cfg().baseUrl, async () => ({
      stdout: "",
      stderr: "connect (`top-secret-internal-name'): Connection refused",
      code: 1,
    }))).rejects.toMatchObject({
      code: "ssh_host_unreachable",
      message: "The SSH service at edge.example.test:2222 refused the connection. Check the SSH port and that sshd is running.",
    });
  });

  it("falls back to a credential-free SSH handshake when ssh-keyscan returns no key", async () => {
    const commands: string[] = [];
    const keys = await scanEdgeHostKeys(cfg().baseUrl, async (command, args) => {
      commands.push(command);
      if (command === "ssh-keyscan") {
        return { stdout: "", stderr: "scanner probe rejected", code: 1 };
      }
      const knownHostsOption = args.find((arg) => arg.startsWith("UserKnownHostsFile="));
      expect(knownHostsOption).toBeDefined();
      expect(args).toContain("StrictHostKeyChecking=accept-new");
      expect(args).toContain("PubkeyAuthentication=no");
      expect(args).not.toContain("-i");
      await writeFile(knownHostsOption!.slice("UserKnownHostsFile=".length), `${hostLine}\n`, "utf8");
      return { stdout: "", stderr: "Permission denied (publickey).", code: 255 };
    });

    expect(commands).toEqual(["ssh-keyscan", "ssh"]);
    expect(keys).toMatchObject([{ algorithm: "ssh-ed25519", fingerprint: hostPair.fingerprint }]);
  });

  it("distinguishes runtime network policy denial from SSH authentication", async () => {
    await expect(scanEdgeHostKeys(cfg().baseUrl, async () => ({
      stdout: "",
      stderr: "connect (`edge.example.test'): Permission denied",
      code: 1,
    }))).rejects.toMatchObject({
      code: "ssh_runtime_network_denied",
      message: expect.stringContaining("container or service account"),
    });
  });

  it("reports scanner timeouts with the target and next checks", async () => {
    await expect(scanEdgeHostKeys(cfg().baseUrl, async () => { throw new Error("ssh-keyscan timed out"); }))
      .rejects.toMatchObject({
        code: "ssh_keyscan_timeout",
        message: "The SSH host-key scan for edge.example.test:2222 timed out. Check the address, SSH port, firewall, and that sshd is running.",
      });
  });

  it("refuses a changed host key before invoking ssh", async () => {
    const commands: string[] = [];
    const runner: CommandRunner = async (command) => {
      commands.push(command);
      return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
    };
    await expect(runVerifiedSsh(cfg("SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"), "STATUS", undefined, runner))
      .rejects.toThrow("host key changed");
    expect(commands).toEqual(["ssh-keyscan"]);
  });

  it("uses strict host-key checking, a transient identity, and a fixed command", async () => {
    let transientIdentity = "";
    const runner: CommandRunner = async (command, args) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      transientIdentity = args[args.indexOf("-i") + 1];
      expect(existsSync(transientIdentity)).toBe(true);
      expect(args).toContain("StrictHostKeyChecking=yes");
      expect(args).toContain("GlobalKnownHostsFile=none");
      expect(args.at(-1)).toBe("polysiem-edge-agent");
      return { stdout: "POLYSIEM_EDGE_STATUS_V1\n", stderr: "", code: 0 };
    };
    await runVerifiedSsh(cfg(), "STATUS", undefined, runner);
    expect(existsSync(transientIdentity)).toBe(false);
  });

  it("kills an untrusted process whose combined output exceeds 1 MiB", async () => {
    await expect(runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(1100000))"]))
      .rejects.toThrow("output exceeded 1 MiB");
  });
});
