import { describe, expect, it } from "vitest";
import { joinKey, sanitizeKeySegment } from "./keys";

describe("joinKey", () => {
  it("joins a prefix and filename with a single separator", () => {
    expect(joinKey("polysiem/backups/", "f.gz")).toBe("polysiem/backups/f.gz");
    expect(joinKey("polysiem/backups", "f.gz")).toBe("polysiem/backups/f.gz");
  });

  it("returns the filename alone when the prefix is empty", () => {
    expect(joinKey("", "f.gz")).toBe("f.gz");
    expect(joinKey(undefined, "f.gz")).toBe("f.gz");
    expect(joinKey(null, "f.gz")).toBe("f.gz");
  });

  it("drops leading slashes from both parts", () => {
    expect(joinKey("/polysiem/", "/f.gz")).toBe("polysiem/f.gz");
  });
});

describe("sanitizeKeySegment", () => {
  it("normalises back-slashes to forward-slashes", () => {
    expect(sanitizeKeySegment("a\\b\\c")).toBe("a/b/c");
  });

  it("strips control characters", () => {
    const withControls = "a" + String.fromCharCode(1) + "b" + String.fromCharCode(127) + "cd";
    expect(sanitizeKeySegment(withControls)).toBe("abcd");
  });
});
