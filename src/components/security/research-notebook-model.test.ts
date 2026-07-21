import { describe, expect, it } from "vitest";
import {
  buildResearchTree,
  filterResearchTree,
  flattenResearchTree,
  groupResearchEvidence,
  researchAncestorChain,
  researchDescendantIds,
  type ResearchEvidence,
  type ResearchPage,
} from "./research-notebook-model";

function page(id: string, parentId: string | null = null, title = id): ResearchPage {
  return {
    id,
    parentId,
    title,
    subject: `${id}.example`,
    subjectType: "domain",
    status: "open",
    verdict: "unknown",
    notes: null,
    createdAt: "2026-07-20T12:00:00.000Z",
    updatedAt: "2026-07-20T12:00:00.000Z",
    lastResearchedAt: null,
    createdBy: null,
    evidence: [],
  };
}

function evidence(id: string, runId: string, capturedAt: string): ResearchEvidence {
  return {
    id,
    runId,
    capturedAt,
    provider: "dns",
    kind: "lookup",
    status: "success",
    title: id,
    summary: null,
    query: null,
    sourceUrl: null,
    data: null,
  };
}

describe("research notebook model", () => {
  it("groups evidence by run while preserving first-seen order", () => {
    const grouped = groupResearchEvidence([
      evidence("one", "run-a", "2026-07-20T12:00:00.000Z"),
      evidence("two", "run-b", "2026-07-20T13:00:00.000Z"),
      evidence("three", "run-a", "2026-07-20T12:01:00.000Z"),
    ]);

    expect(grouped.map((run) => [run.runId, run.capturedAt, run.items.length])).toEqual([
      ["run-a", "2026-07-20T12:00:00.000Z", 2],
      ["run-b", "2026-07-20T13:00:00.000Z", 1],
    ]);
  });

  it("builds, filters, and flattens the same page hierarchy for both layouts", () => {
    const pages = [page("root", null, "Root"), page("child", "root", "Needle"), page("orphan", "missing", "Orphan")];
    const tree = buildResearchTree(pages);

    expect(tree.map((node) => node.page.id)).toEqual(["root", "orphan"]);
    expect(filterResearchTree(tree, "needle")[0]).toMatchObject({
      page: { id: "root" },
      children: [{ page: { id: "child" } }],
    });
    expect(flattenResearchTree(pages).map(({ page: item, depth }) => [item.id, depth])).toEqual([
      ["root", 0],
      ["child", 1],
      ["orphan", 0],
    ]);
  });

  it("finds ancestors and descendants without looping on malformed cycles", () => {
    const root = page("root");
    const child = page("child", "root");
    const grandchild = page("grandchild", "child");
    expect(researchAncestorChain(grandchild, [root, child, grandchild]).map((item) => item.id)).toEqual(["root", "child"]);
    expect([...researchDescendantIds("root", [root, child, grandchild])]).toEqual(["child", "grandchild"]);

    const a = page("a", "b");
    const b = page("b", "a");
    expect(researchAncestorChain(a, [a, b]).map((item) => item.id)).toEqual(["b"]);
    expect([...researchDescendantIds("a", [a, b])]).toEqual(["b"]);
  });
});
