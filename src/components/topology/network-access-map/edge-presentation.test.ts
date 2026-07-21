import { describe, expect, it } from "vitest";
import { createEdgeOpacity } from "./edge-presentation";

describe("createEdgeOpacity", () => {
  it("uses the normal resting opacity without a selection", () => {
    expect(createEdgeOpacity(null, null)("edge", "source", "target")).toBe(0.85);
  });

  it("prioritizes an edge selection over node selection", () => {
    const opacity = createEdgeOpacity("selected", "source");

    expect(opacity("selected", "other", "other")).toBe(1);
    expect(opacity("other", "source", "other")).toBe(0.1);
  });

  it("emphasizes edges incident to the selected node", () => {
    const opacity = createEdgeOpacity(null, "selected");

    expect(opacity("one", "selected", "other")).toBe(1);
    expect(opacity("two", "other", "selected")).toBe(1);
    expect(opacity("three", "other", "another")).toBe(0.08);
  });
});
