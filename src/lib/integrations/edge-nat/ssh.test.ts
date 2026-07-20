import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import type { DriverConfig } from "../types";
import { runCommand, runVerifiedSsh, scanEdgeHostKeys, type CommandRunner } from "./ssh";

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
