import { describe, expect, it } from "vitest";
import { formatUptime, INSTANCE_ART_STYLES, renderInstanceArt } from "./instance-art";

describe("instance art", () => {
  const style = INSTANCE_ART_STYLES[0];

  it("renders five equally sized rows", () => {
    const art = renderInstanceArt("Lab 7", style);
    expect(art.rows).toHaveLength(5);
    expect(art.rows.every((row) => row.length === art.width)).toBe(true);
    expect(art.signature).toContain("Lab 7");
  });

  it("normalizes unsafe whitespace and falls back for empty names", () => {
    expect(renderInstanceArt(" Lab\n\tName ", style).signature).toContain("Lab Name");
    expect(renderInstanceArt("\u0000\u007f", style).signature).toContain("PolySIEM");
  });

  it("formats uptime without empty units", () => {
    expect(formatUptime(59)).toBe("0m");
    expect(formatUptime(90_060)).toBe("1d 1h 1m");
  });
});
