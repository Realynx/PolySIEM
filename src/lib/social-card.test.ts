import { describe, expect, it } from "vitest";
import { createSocialCard } from "./social-card";

describe("social card", () => {
  it("renders a large PNG preview", async () => {
    const response = createSocialCard();
    const bytes = new Uint8Array(await response.arrayBuffer());

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Array.from(bytes.slice(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    expect(bytes.byteLength).toBeGreaterThan(10_000);
  });
});
