import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import type { DriverConfig } from "../types";
import type { CommandRunner } from "./ssh";
import { runEdgeNatProvisioning } from "./provision";

const hostPair = generateEd25519Keypair("host");
const clientPair = generateEd25519Keypair("client");
const hostLine = `[edge.example.test]:2222 ${hostPair.publicKeyLine}`;

function cfg(): DriverConfig {
  return {
    id: "edge-1",
    type: "EDGE_NAT_SERVER",
    name: "Edge",
    baseUrl: "ssh://edge.example.test:2222",
    credentials: { username: "polysiem-edge", privateKey: clientPair.privateKeyPem },
    verifyTls: true,
    settings: {
      publicKey: clientPair.publicKeyLine,
      hostKeyFingerprint: hostPair.fingerprint,
      publicInterface: "eth0",
      outboundInterface: "tailscale0",
      enableIpForwarding: true,
    },
  };
}

describe("automatic Edge NAT provisioning", () => {
  it("pins the host key and sends the installer through the transient admin account", async () => {
    let identityPath = "";
    const runner: CommandRunner = async (command, args, input, timeout) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      identityPath = args[args.indexOf("-i") + 1];
      expect(existsSync(identityPath)).toBe(true);
      expect(args).toContain("StrictHostKeyChecking=yes");
      expect(args).toContain("GlobalKnownHostsFile=none");
      expect(args.at(-2)).toBe("ubuntu@edge.example.test");
      expect(args.at(-1)).toBe("polysiem-edge-bootstrap");
      expect(input).toContain("ADMIN_NAME='ubuntu'");
      expect(input).toContain("grep -Fvx -- \"$BOOTSTRAP_KEY\"");
      expect(timeout).toBe(90_000);
      return { stdout: "PolySIEM Edge NAT helper installed.\n", stderr: "", code: 0 };
    };

    await expect(runEdgeNatProvisioning(cfg(), "ubuntu", runner)).resolves.toEqual({
      stdout: "PolySIEM Edge NAT helper installed.",
    });
    expect(existsSync(identityPath)).toBe(false);
  });

  it("warns that the temporary key may remain when installation fails", async () => {
    const runner: CommandRunner = async (command) => command === "ssh-keyscan"
      ? { stdout: `${hostLine}\n`, stderr: "", code: 0 }
      : { stdout: "", stderr: "sudo: a password is required", code: 1 };
    await expect(runEdgeNatProvisioning(cfg(), "ubuntu", runner)).rejects.toThrow(
      "temporary admin authorization may still be present",
    );
  });
});
