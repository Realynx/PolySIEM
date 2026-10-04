import { describe, expect, it } from "vitest";
import { createTunnelSchema, updateTunnelSchema } from "./tunnels";

describe("createTunnelSchema", () => {
  it("applies provider and ingressHostnames defaults on create", () => {
    expect(createTunnelSchema.parse({ name: "home" })).toEqual({
      name: "home",
      provider: "cloudflare",
      ingressHostnames: [],
    });
  });
});

describe("updateTunnelSchema", () => {
  /**
   * The PATCH route spreads the parsed body straight into `prisma.tunnel.update`.
   * Built as `.partial()`, a notes-only PATCH carried `provider: "cloudflare"`
   * and `ingressHostnames: []` — resetting a non-Cloudflare tunnel's provider and
   * wiping its hostname list (which then cascades into reconcileTunnelHostnames,
   * because `"ingressHostnames" in input` was always true).
   */
  it("returns ONLY the field that was sent", () => {
    expect(Object.keys(updateTunnelSchema.parse({ notes: "moved to rack 2" }))).toEqual(["notes"]);
  });

  it("does not invent provider or ingressHostnames", () => {
    const patch = updateTunnelSchema.parse({ name: "home" }) as Record<string, unknown>;
    expect("provider" in patch).toBe(false);
    expect("ingressHostnames" in patch).toBe(false);
  });

  it("still accepts and validates the fields it is given", () => {
    expect(updateTunnelSchema.parse({ ingressHostnames: ["app.example.com"] }))
      .toEqual({ ingressHostnames: ["app.example.com"] });
    expect(updateTunnelSchema.safeParse({ name: "" }).success).toBe(false);
  });
});
