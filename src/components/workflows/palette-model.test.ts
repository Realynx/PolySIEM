import { describe, expect, it } from "vitest";
import type { NodeTypeMeta } from "@/lib/workflows/types";
import { filterNodeCatalog, groupNodeCatalog } from "./palette-model";

const catalog: NodeTypeMeta[] = [
  {
    kind: "http.request",
    title: "Send HTTP request",
    description: "Call a remote web endpoint.",
    category: "http",
    inputs: [],
    outputs: [],
  },
  {
    kind: "trigger.schedule",
    title: "On schedule",
    description: "Run at a regular interval.",
    category: "trigger",
    inputs: [],
    outputs: [],
  },
  {
    kind: "inventory.allocate-ip",
    title: "Allocate IP address",
    description: "Find an available address in a network.",
    category: "inventory",
    inputs: [],
    outputs: [],
  },
];

describe("filterNodeCatalog", () => {
  it("searches human descriptions and technical kinds case-insensitively", () => {
    expect(filterNodeCatalog(catalog, "REMOTE endpoint", "all").map((item) => item.kind)).toEqual([
      "http.request",
    ]);
    expect(filterNodeCatalog(catalog, "ALLOCATE-IP", "all").map((item) => item.kind)).toEqual([
      "inventory.allocate-ip",
    ]);
  });

  it("searches category labels and combines search terms", () => {
    expect(filterNodeCatalog(catalog, "trigger interval", "all").map((item) => item.kind)).toEqual([
      "trigger.schedule",
    ]);
  });

  it("applies the selected category before text search", () => {
    expect(filterNodeCatalog(catalog, "network", "http")).toEqual([]);
    expect(filterNodeCatalog(catalog, "network", "inventory").map((item) => item.kind)).toEqual([
      "inventory.allocate-ip",
    ]);
  });
});

describe("groupNodeCatalog", () => {
  it("uses the stable workflow category order", () => {
    expect(groupNodeCatalog(catalog).map((group) => group.category)).toEqual([
      "trigger",
      "inventory",
      "http",
    ]);
  });
});
