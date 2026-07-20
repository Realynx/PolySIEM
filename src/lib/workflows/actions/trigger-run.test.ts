import { describe, expect, it } from "vitest";

import type { RunContext } from "../registry";
import { triggerManual } from "./trigger";
import { executeParameterizedTrigger } from "./trigger-run";
import { triggerWebhook } from "./trigger-webhook";

const params = [
  { key: "name", label: "Name", type: "string", required: true },
  { key: "count", label: "Count", type: "number", required: false },
  { key: "enabled", label: "Enabled", type: "boolean", required: false },
];

function context(input: Record<string, unknown>): RunContext {
  return { input } as RunContext;
}

describe("executeParameterizedTrigger", () => {
  it("keeps the validated and coerced output behavior", () => {
    expect(
      executeParameterizedTrigger(
        { params },
        { name: "demo", count: "4", enabled: "true" },
        "Invalid run input",
      ),
    ).toEqual({ name: "demo", count: 4, enabled: true });
  });

  it("keeps the shared trigger-declaration error prefix", () => {
    expect(() =>
      executeParameterizedTrigger(
        { params: [{ key: "bad", type: "jpeg" }] },
        {},
        "Ignored input prefix",
      ),
    ).toThrow('Invalid trigger params: Param "bad" has an invalid type "jpeg"');
  });
});

describe("parameterized trigger actions", () => {
  it("keeps the manual trigger input-error prefix", async () => {
    await expect(
      triggerManual.run({
        config: { params },
        ctx: context({ count: "many" }),
      }),
    ).rejects.toThrow(
      'Invalid run input: Missing required input "Name" (name); Input "count" must be a number (got "many")',
    );
  });

  it("keeps the webhook trigger input-error prefix", async () => {
    await expect(
      triggerWebhook.run({
        config: { params, token: "whk_test" },
        ctx: context({ count: "many" }),
      }),
    ).rejects.toThrow(
      'Invalid webhook payload: Missing required input "Name" (name); Input "count" must be a number (got "many")',
    );
  });

  it("keeps webhook token defaults and metadata unchanged", () => {
    expect(triggerWebhook.configSchema.parse({ params: [] })).toEqual({
      params: [],
      token: "",
    });
    expect(triggerWebhook.meta).toMatchObject({
      kind: "trigger.webhook",
      category: "trigger",
      inputs: [],
      outputs: [],
    });
  });
});
