import { describe, expect, it } from "vitest";
import { toJsonSafe } from "./serialize";

describe("toJsonSafe", () => {
  it("converts BigInt to string deeply", () => {
    const input = {
      memoryBytes: BigInt("8589934592"),
      nested: { list: [{ diskBytes: BigInt(1) }, { diskBytes: null }] },
    };
    expect(toJsonSafe(input)).toEqual({
      memoryBytes: "8589934592",
      nested: { list: [{ diskBytes: "1" }, { diskBytes: null }] },
    });
  });

  it("converts Dates to ISO strings and passes primitives through", () => {
    const d = new Date("2026-01-02T03:04:05.000Z");
    expect(toJsonSafe({ d, n: 4, s: "x", b: false, u: undefined })).toEqual({
      d: "2026-01-02T03:04:05.000Z",
      n: 4,
      s: "x",
      b: false,
      u: undefined,
    });
  });

  it("survives JSON.stringify afterwards", () => {
    expect(() => JSON.stringify(toJsonSafe({ big: BigInt("12345678901234567890") }))).not.toThrow();
  });
});
