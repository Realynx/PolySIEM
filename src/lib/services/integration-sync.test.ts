import { describe, expect, it } from "vitest";
import { isSyncableIntegrationType } from "@/lib/services/integration-sync";

describe("integration sync policy", () => {
  it.each(["ELASTICSEARCH", "OTX", "CENSYS", "SECURITYTRAILS"])(
    "treats live-query integration %s as non-syncable",
    (type) => expect(isSyncableIntegrationType(type)).toBe(false),
  );

  it.each(["PROXMOX", "OPNSENSE", "UNIFI", "CLOUDFLARE", "TAILSCALE"])(
    "allows inventory integration %s to sync",
    (type) => expect(isSyncableIntegrationType(type)).toBe(true),
  );
});
