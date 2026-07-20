import { describe, expect, it } from "vitest";
import { getSitePresentation } from "./site-presentation";

describe("site presentation", () => {
  it("uses APP_URL for ordinary instance cards", () => {
    const site = getSitePresentation({ APP_URL: "https://siem.example.test" });

    expect(site.baseUrl.href).toBe("https://siem.example.test/");
    expect(site.title).toBe("PolySIEM");
    expect(site.cardLabel).toBe("SELF-HOSTED · SIEM.EXAMPLE.TEST");
    expect(site.isPublicDemo).toBe(false);
  });

  it("labels a locked deployment as the public demo", () => {
    const site = getSitePresentation({
      APP_URL: "https://demo.example.test",
      POLYSIEM_DEMO_MODE: "true",
      POLYSIEM_DEMO_LOCKED: "true",
    });

    expect(site.title).toBe("PolySIEM Public Demo");
    expect(site.cardLabel).toBe("PUBLIC DEMO · READ ONLY");
    expect(site.description).toContain("read-only");
  });

  it("falls back safely when APP_URL is invalid", () => {
    expect(getSitePresentation({ APP_URL: "not a url" }).baseUrl.href).toBe(
      "http://localhost:3000/",
    );
  });
});
