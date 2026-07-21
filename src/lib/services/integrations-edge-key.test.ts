import { describe, expect, it } from "vitest";
import { edgeNatDocumentedKeyData } from "./integrations";

describe("edgeNatDocumentedKeyData", () => {
  it("documents the generated public key and explains its restricted purpose", () => {
    const data = edgeNatDocumentedKeyData(
      { name: "Residential edge", baseUrl: "ssh://edge.example.test:2222" },
      {
        publicKeyLine: "ssh-ed25519 AAAApublic polysiem-edge@polysiem",
        fingerprint: "SHA256:edge-key-fingerprint",
      },
    );

    expect(data).toMatchObject({
      name: "Residential edge Edge NAT service key",
      keyType: "ssh-ed25519",
      publicKey: "ssh-ed25519 AAAApublic polysiem-edge@polysiem",
      fingerprint: "SHA256:edge-key-fingerprint",
      bits: 256,
      comment: "polysiem-edge@polysiem",
      ownerLabel: "PolySIEM",
      source: "EDGE_NAT_SERVER",
    });
    expect(data.purpose).toContain("Residential edge");
    expect(data.purpose).toContain("ssh://edge.example.test:2222");
    expect(data.purpose).toContain("restricted polysiem-edge account");
    expect(JSON.stringify(data)).not.toContain("PRIVATE KEY");
  });
});
