import { describe, expect, it } from "vitest";
import { expandEvidenceReferences, type ResearchEvidenceReference } from "./research-evidence-links";

const evidence: ResearchEvidenceReference[] = [{
  id: "ev-1",
  provider: "dns",
  kind: "resolution",
  status: "success",
  title: "Current DNS records",
  summary: "3 DNS records captured.",
  capturedAt: "2026-07-21T10:00:00.000Z",
}];

describe("expandEvidenceReferences", () => {
  it("turns an evidence citation into an in-page link", () => {
    expect(expandEvidenceReferences("See [[evidence:ev-1|DNS snapshot]].", evidence))
      .toBe("See [DNS snapshot](#evidence-ev-1).");
  });

  it("expands an evidence embed into a summarized preview card", () => {
    const result = expandEvidenceReferences("![[evidence:ev-1|DNS snapshot]]", evidence);
    expect(result).toContain("> **Evidence · [DNS snapshot](#evidence-ev-1)**");
    expect(result).toContain("3 DNS records captured.");
    expect(result).toContain("dns · resolution");
  });

  it("keeps a useful link when referenced evidence is unavailable", () => {
    expect(expandEvidenceReferences("![[evidence:gone|Old result]]", evidence))
      .toContain("**Evidence unavailable:** [Old result](#evidence-gone)");
  });
});
