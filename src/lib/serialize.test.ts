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

  /**
   * A `Map` has no own enumerable properties, so the generic object branch used
   * to emit `{}` for a populated collection — the silent data loss that made
   * `GET /api/network/privacy-router/:id/status` return `probes: {}` however the
   * per-exit probes went.
   */
  describe("collections are carried, never flattened to an empty object", () => {
    it("serializes a Map to an object", () => {
      const probes = new Map([["proton-us", "ok"], ["proton-nl", "fail"]]);
      expect(toJsonSafe({ probes })).toEqual({ probes: { "proton-us": "ok", "proton-nl": "fail" } });
    });

    it("converts Map values and non-string Map keys", () => {
      const input = new Map<number, { bytes: bigint }>([[7, { bytes: BigInt(9) }]]);
      expect(toJsonSafe(input)).toEqual({ "7": { bytes: "9" } });
    });

    it("serializes a Set to an array", () => {
      expect(toJsonSafe({ keys: new Set(["a", "b", "a"]) })).toEqual({ keys: ["a", "b"] });
    });

    it("handles nested and empty collections", () => {
      const input = { outer: new Map([["inner", new Set([BigInt(1)])]]), empty: new Map() };
      expect(toJsonSafe(input)).toEqual({ outer: { inner: ["1"] }, empty: {} });
    });

    it("keeps a hostile Map key as an own data property rather than a prototype", () => {
      const result = toJsonSafe(new Map([["__proto__", "fail"]])) as Record<string, unknown>;
      expect(Object.hasOwn(result, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("round-trips through JSON.stringify with the data intact", () => {
      const json = JSON.stringify(toJsonSafe({ probes: new Map([["nl1", "skip"]]) }));
      expect(JSON.parse(json)).toEqual({ probes: { nl1: "skip" } });
    });
  });
});
