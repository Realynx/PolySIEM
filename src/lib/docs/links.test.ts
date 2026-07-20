import { describe, expect, it } from "vitest";
import { canonicalizeMarkdownDocLinks, normalizeDocHref } from "./links";

describe("normalizeDocHref", () => {
  it.each([
    ["/docs/parent/backup-recovery", "/docs/backup-recovery"],
    ["docs/parent/network-access", "/docs/network-access"],
    ["./operations.md", "/docs/operations"],
    ["../troubleshooting", "/docs/troubleshooting"],
    ["service-overview", "/docs/service-overview"],
    ["/docs/backup-recovery#restore", "/docs/backup-recovery#restore"],
  ])("maps %s to the canonical docs route", (input, expected) => {
    expect(normalizeDocHref(input)).toBe(expected);
  });

  it.each([
    "https://example.test/docs/page",
    "mailto:operator@example.test",
    "#restore",
    "/inventory/devices/one",
  ])("leaves non-doc links unchanged: %s", (href) => {
    expect(normalizeDocHref(href)).toBe(href);
  });
});

describe("canonicalizeMarkdownDocLinks", () => {
  const docs = new Map([
    ["child-id", { slug: "backup-recovery" }],
    ["network-access", { slug: "network-access" }],
  ]);
  const resolve = async (key: string) => docs.get(key) ?? null;

  it("rewrites valid inline and reference links to saved slugs", async () => {
    const result = await canonicalizeMarkdownDocLinks(
      "[Backup](/docs/parent/child-id) and [Network][network].\n\n[network]: ./network-access.md#firewall",
      resolve,
    );
    expect(result.missing).toEqual([]);
    expect(result.content).toContain("[Backup](/docs/backup-recovery)");
    expect(result.content).toContain(
      "[network]: /docs/network-access#firewall",
    );
  });

  it("reports nonexistent targets without inventing a replacement", async () => {
    const result = await canonicalizeMarkdownDocLinks(
      "See [Imaginary child](/docs/does-not-exist).",
      resolve,
    );
    expect(result.missing).toEqual(["/docs/does-not-exist"]);
    expect(result.content).toContain("/docs/does-not-exist");
  });
});
