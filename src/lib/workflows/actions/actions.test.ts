import { describe, expect, it } from "vitest";
import { firstLevelJson, isJsonBody, parseHeaderLines } from "./webhook";
import { buildNotifyPayload } from "./notify-message";

describe("parseHeaderLines", () => {
  it("parses one Name: value pair per line", () => {
    expect(parseHeaderLines("Authorization: Bearer abc\nX-Env: prod")).toEqual({
      Authorization: "Bearer abc",
      "X-Env": "prod",
    });
  });

  it("ignores blank lines and surrounding whitespace", () => {
    expect(parseHeaderLines("\n  Accept:  application/json  \n\r\n")).toEqual({
      Accept: "application/json",
    });
  });

  it("keeps colons inside the value", () => {
    expect(parseHeaderLines("X-Time: 12:34:56")).toEqual({ "X-Time": "12:34:56" });
  });

  it("allows an empty value", () => {
    expect(parseHeaderLines("X-Empty:")).toEqual({ "X-Empty": "" });
  });

  it("returns an empty record for empty input", () => {
    expect(parseHeaderLines("")).toEqual({});
  });

  it("throws an actionable error on a line without a colon", () => {
    expect(() => parseHeaderLines("not-a-header")).toThrow(/Name: value/);
  });

  it("throws when the header name is missing", () => {
    expect(() => parseHeaderLines(": oops")).toThrow(/header/i);
  });
});

describe("isJsonBody", () => {
  it("detects JSON objects, arrays, and primitives", () => {
    expect(isJsonBody('{"a": 1}')).toBe(true);
    expect(isJsonBody("[1, 2, 3]")).toBe(true);
    expect(isJsonBody('  {"padded": true}  ')).toBe(true);
    expect(isJsonBody("42")).toBe(true);
  });

  it("rejects plain text, malformed JSON, and empty bodies", () => {
    expect(isJsonBody("hello world")).toBe(false);
    expect(isJsonBody('{"broken": ')).toBe(false);
    expect(isJsonBody("")).toBe(false);
    expect(isJsonBody("   ")).toBe(false);
  });
});

describe("firstLevelJson", () => {
  it("keeps top-level primitives and collapses nested structures", () => {
    const text = JSON.stringify({ a: 1, b: "x", nested: { deep: true }, list: [1, 2] });
    const parsed = JSON.parse(firstLevelJson(text));
    expect(parsed).toEqual({ a: 1, b: "x", nested: '{"deep":true}', list: "[1,2]" });
  });

  it("returns '' for non-JSON text", () => {
    expect(firstLevelJson("<html>nope</html>")).toBe("");
    expect(firstLevelJson("")).toBe("");
  });

  it("handles top-level arrays", () => {
    expect(JSON.parse(firstLevelJson('[{"a":1}, 2]'))).toEqual(['{"a":1}', 2]);
  });
});

describe("buildNotifyPayload", () => {
  it("uses the Discord shape ({content, username?}) by default", () => {
    expect(
      buildNotifyPayload("https://discord.com/api/webhooks/1/abc", "hello", "PolySIEM"),
    ).toEqual({ content: "hello", username: "PolySIEM" });
  });

  it("omits username when absent or blank", () => {
    expect(buildNotifyPayload("https://example.com/hook", "hello")).toEqual({ content: "hello" });
    expect(buildNotifyPayload("https://example.com/hook", "hello", "  ")).toEqual({
      content: "hello",
    });
  });

  it("uses the Slack shape ({text}) for hooks.slack.com URLs", () => {
    expect(
      buildNotifyPayload("https://hooks.slack.com/services/T0/B0/xyz", "hello", "PolySIEM"),
    ).toEqual({ text: "hello" });
  });
});
