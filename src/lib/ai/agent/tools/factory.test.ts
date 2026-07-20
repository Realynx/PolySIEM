import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ApiError } from "@/lib/api";
import type { ToolContext } from "@/lib/ai/agent/types";
import { makeTool } from "./factory";

function context(secrets: string[] = []): ToolContext {
  return {
    role: "USER",
    mode: "chat",
    secrets,
    externalSources: new Set<string>(),
  };
}

describe("makeTool", () => {
  it("keeps the JSON-safe, redacted result contract", async () => {
    const wrapped = makeTool(
      context(["top-secret-value"]),
      "test_tool",
      "A test tool",
      z.object({ value: z.string() }),
      async ({ value }) => ({
        value,
        count: BigInt(9),
        createdAt: new Date("2026-07-18T12:00:00.000Z"),
        apiKey: "top-secret-value",
        message: "received top-secret-value",
      }),
    );

    await expect(wrapped.invoke({ value: "ok" })).resolves.toBe(
      JSON.stringify({
        value: "ok",
        count: "9",
        createdAt: "2026-07-18T12:00:00.000Z",
        apiKey: "[REDACTED]",
        message: "received [REDACTED]",
      }),
    );
  });

  it("keeps the redacted error payload contract", async () => {
    const wrapped = makeTool(
      context(["top-secret-value"]),
      "test_error_tool",
      "A failing test tool",
      z.object({}),
      async () => {
        throw new ApiError(502, "upstream_error", "Failed with top-secret-value");
      },
    );

    await expect(wrapped.invoke({})).resolves.toBe(
      JSON.stringify({ error: "Failed with [REDACTED]" }),
    );
  });

  it("stringifies non-Error failures", async () => {
    const wrapped = makeTool(
      context(),
      "test_unknown_error_tool",
      "A failing test tool",
      z.object({}),
      async () => {
        throw "unexpected failure";
      },
    );

    await expect(wrapped.invoke({})).resolves.toBe(
      JSON.stringify({ error: "unexpected failure" }),
    );
  });
});
