import { describe, expect, it } from "vitest";
import { z } from "zod";
import { patchSchema } from "./patch";
import { updateEdgeNatRuleSchema } from "./edge-nat";
import {
  updateContainerSchema,
  updateDeviceSchema,
  updateIpSchema,
  updateNetworkSchema,
  updateServiceSchema,
  updateStorageSchema,
  updateVmSchema,
} from "./inventory";
import { updateTunnelSchema } from "./tunnels";
import { updateWorkflowSchema } from "@/lib/workflows/schemas";

describe("patchSchema", () => {
  const base = z.object({
    name: z.string(),
    enabled: z.boolean().default(true),
    tags: z.array(z.string()).default([]),
    notes: z.string().nullish(),
  });

  /**
   * The behaviour the helper exists to neutralise. If this ever starts failing,
   * zod changed and `patchSchema` may be able to go away — until then, every
   * PATCH schema built with a bare `.partial()` is silently injecting values.
   */
  it("documents the zod v4 trap: .partial() does NOT strip .default()", () => {
    expect(Object.keys(base.partial().parse({}))).toEqual(["enabled", "tags"]);
  });

  it("produces no keys at all for an empty body", () => {
    expect(Object.keys(patchSchema(base).parse({}))).toEqual([]);
  });

  it("returns only the keys the client actually sent", () => {
    expect(Object.keys(patchSchema(base).parse({ name: "x" }))).toEqual(["name"]);
  });

  it("still validates the fields that are sent", () => {
    expect(patchSchema(base).safeParse({ enabled: "yes" }).success).toBe(false);
    expect(patchSchema(base).parse({ enabled: false })).toEqual({ enabled: false });
  });

  it("leaves the create schema's defaults alone", () => {
    expect(base.parse({ name: "x" })).toEqual({ name: "x", enabled: true, tags: [] });
  });

  it("makes a min-one-field guard able to fail, which .partial() cannot", () => {
    const guarded = patchSchema(base).refine((v) => Object.keys(v).length > 0, "Provide at least one field");
    expect(guarded.safeParse({}).success).toBe(false);
    expect(guarded.safeParse({ name: "x" }).success).toBe(true);
    // The same guard on a `.partial()` schema is dead code: the injected
    // defaults always populate keys, so the count is never zero.
    const broken = base.partial().refine((v) => Object.keys(v).length > 0, "Provide at least one field");
    expect(broken.safeParse({}).success).toBe(true);
  });
});

/**
 * Regression net for the whole repo: every PATCH schema derived from a create
 * schema must return exactly the keys the client sent. A future `.default()`
 * added to any create schema below — or a PATCH schema rebuilt with a bare
 * `.partial()` — fails here rather than silently overwriting stored data.
 *
 * The list is explicit and hand-maintained on purpose: adding a new PATCH schema
 * means adding a line here, which is the moment to notice the trap.
 */
describe("PATCH schemas never invent keys", () => {
  const PATCH_SCHEMAS: Array<[string, z.ZodType, Record<string, unknown>]> = [
    ["updateDeviceSchema", updateDeviceSchema, { name: "nas-01" }],
    ["updateVmSchema", updateVmSchema, { name: "vm-01" }],
    ["updateContainerSchema", updateContainerSchema, { name: "ct-01" }],
    ["updateNetworkSchema", updateNetworkSchema, { name: "lan" }],
    ["updateIpSchema", updateIpSchema, { address: "10.0.20.5" }],
    ["updateServiceSchema", updateServiceSchema, { name: "grafana" }],
    ["updateStorageSchema", updateStorageSchema, { name: "tank" }],
    ["updateTunnelSchema", updateTunnelSchema, { name: "home" }],
    ["updateWorkflowSchema", updateWorkflowSchema, { name: "nightly" }],
    ["updateEdgeNatRuleSchema", updateEdgeNatRuleSchema, { name: "Palworld" }],
  ];

  it.each(PATCH_SCHEMAS)("%s returns only the sent key", (_name, schema, body) => {
    // Object.keys, not toMatchObject: toMatchObject passes on extra keys and so
    // would not have caught the injected defaults this suite exists to prevent.
    expect(Object.keys(schema.parse(body) as object)).toEqual(Object.keys(body));
  });
});
