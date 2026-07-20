import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import {
  assertEdgeBootstrapUsername,
  buildEdgeBootstrapCommand,
  edgeBootstrapAuthorizedKey,
} from "./bootstrap";

describe("Edge NAT bootstrap authorization", () => {
  const publicKey = generateEd25519Keypair("edge@test").publicKeyLine;

  it("creates a short forced installer authorization instead of a general shell key", () => {
    const line = edgeBootstrapAuthorizedKey(publicKey);
    expect(line).toContain('restrict,command="');
    expect(line).toContain("sudo -n sh -s");
    expect(line).toContain(publicKey);
    const command = buildEdgeBootstrapCommand(publicKey);
    expect(command).toContain("authorized_keys");
    expect(command.split(line)).toHaveLength(2);
    expect(command.length).toBeLessThan(500);
  });

  it("accepts normal admin names but rejects the service account and shell syntax", () => {
    expect(assertEdgeBootstrapUsername(" ubuntu ")).toBe("ubuntu");
    expect(() => assertEdgeBootstrapUsername("polysiem-edge")).toThrow("existing administrator");
    expect(() => assertEdgeBootstrapUsername("root; reboot")).toThrow("Linux administrator username");
  });
});
