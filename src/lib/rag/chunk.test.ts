import { describe, expect, it } from "vitest";
import { chunkText, entityToBlob, normalizeText } from "./chunk";

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");

describe("chunkText", () => {
  it("returns no chunks for empty / whitespace text", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\t ")).toEqual([]);
  });

  it("returns a single normalized chunk for short text", () => {
    expect(chunkText("  hello   world \n foo ")).toEqual([{ index: 0, content: "hello world foo" }]);
  });

  it("keeps text at exactly the window size as one chunk", () => {
    const chunks = chunkText(words(10), { maxWords: 10, overlapWords: 2 });
    expect(chunks).toHaveLength(1);
  });

  it("splits long text into overlapping windows with sequential indexes", () => {
    const chunks = chunkText(words(25), { maxWords: 10, overlapWords: 2 });
    // step = 8 ⇒ starts at 0, 8, 16 (24 covers to the end).
    expect(chunks.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(chunks[0].content.split(" ")).toHaveLength(10);
    // Overlap: last 2 words of chunk 0 equal the first 2 of chunk 1.
    const end0 = chunks[0].content.split(" ").slice(-2);
    const start1 = chunks[1].content.split(" ").slice(0, 2);
    expect(start1).toEqual(end0);
  });

  it("does not emit a tiny trailing duplicate chunk", () => {
    const chunks = chunkText(words(20), { maxWords: 10, overlapWords: 0 });
    // step = 10 ⇒ exactly two full windows, no empty third.
    expect(chunks).toHaveLength(2);
  });

  it("clamps overlap so the step is always positive", () => {
    const chunks = chunkText(words(30), { maxWords: 5, overlapWords: 99 });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.content.length > 0)).toBe(true);
  });
});

describe("normalizeText", () => {
  it("collapses whitespace runs and trims", () => {
    expect(normalizeText("  a\n\n b   c ")).toBe("a b c");
  });
});

describe("entityToBlob", () => {
  it("builds a header with the subtitle qualifier and includes non-empty facts", () => {
    const blob = entityToBlob({
      kind: "device",
      name: "dixie",
      subtitle: "hypervisor",
      facts: [
        { label: "Memory", value: "64.0 GiB" },
        { label: "CPU cores", value: 16 },
      ],
      description: "Primary Proxmox node.",
    });
    expect(blob).toContain("dixie — device (hypervisor)");
    expect(blob).toContain("Memory: 64.0 GiB");
    expect(blob).toContain("CPU cores: 16");
    expect(blob).toContain("Description: Primary Proxmox node.");
  });

  it("skips null/undefined/empty facts and omits an absent description", () => {
    const blob = entityToBlob({
      kind: "network",
      name: "LocalServers",
      subtitle: "VLAN 10",
      facts: [
        { label: "CIDR", value: "10.10.0.0/24" },
        { label: "Gateway", value: null },
        { label: "Domain", value: undefined },
        { label: "Purpose", value: "" },
      ],
    });
    expect(blob).toBe("LocalServers — network (VLAN 10)\nCIDR: 10.10.0.0/24");
  });

  it("drops the parenthetical when there is no subtitle", () => {
    expect(entityToBlob({ kind: "service", name: "gitea" })).toBe("gitea — service");
  });
});
