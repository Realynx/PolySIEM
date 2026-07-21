import { describe, expect, it } from "vitest";
import { extractRunId } from "@/lib/integrations/sync-engine";
import { extractRunId as extractRunIdFromLegacyMcpPath } from "@/lib/mcp/engine";

describe("sync engine contract", () => {
  it.each([
    ["run-1", "run-1"],
    [{ runId: "run-2" }, "run-2"],
    [{ id: "run-3" }, "run-3"],
    [{ run: { id: "run-4" } }, "run-4"],
    [{ run: {} }, null],
    [null, null],
  ])("extracts supported run ids from %j", (result, expected) => {
    expect(extractRunId(result)).toBe(expected);
  });

  it("preserves the legacy MCP export", () => {
    expect(extractRunIdFromLegacyMcpPath).toBe(extractRunId);
  });
});
