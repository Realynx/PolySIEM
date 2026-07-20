import { describe, expect, it } from "vitest";
import { actionCatalog, getAction } from "@/lib/workflows/registry";
import { ES_TRIGGER_KINDS } from "@/lib/workflows/es-trigger-logic";

describe("registry smoke", () => {
  it("registers all four Elasticsearch triggers with usable metadata", () => {
    const byKind = new Map(actionCatalog().map((m) => [m.kind, m]));
    for (const kind of ES_TRIGGER_KINDS) {
      const meta = byKind.get(kind);
      expect(meta, `${kind} missing from catalog`).toBeTruthy();
      expect(meta!.category).toBe("trigger");
      expect(meta!.inputs.length).toBeGreaterThan(0);
      expect(meta!.outputs.map((o) => o.key)).toContain("matchCount");
      expect(getAction(kind)).toBeTruthy();
    }
  });
});

describe("threat trigger", () => {
  it("registers the threat ticket trigger", () => {
    const meta = actionCatalog().find((m) => m.kind === "trigger.threat-ticket");
    expect(meta).toBeTruthy();
    expect(meta!.category).toBe("trigger");
    expect(meta!.inputs.map((i) => i.key)).toContain("severity");
    expect(meta!.outputs.map((o) => o.key)).toContain("ticketId");
    expect(getAction("trigger.threat-ticket")).toBeTruthy();
  });
});

describe("logs category", () => {
  it("registers the log action nodes with usable metadata", () => {
    const byKind = new Map(actionCatalog().map((m) => [m.kind, m]));
    const kinds = ["logs.search", "logs.stats", "logs.metric", "logs.digest", "logs.asset-activity"];
    for (const kind of kinds) {
      const meta = byKind.get(kind);
      expect(meta, `${kind} missing from catalog`).toBeTruthy();
      expect(meta!.category).toBe("logs");
      expect(meta!.outputs.length).toBeGreaterThan(0);
      expect(getAction(kind)).toBeTruthy();
    }
  });
});

describe("SecurityTrails workflow surface", () => {
  it("registers lookup plus complete and changed event nodes", () => {
    const byKind = new Map(actionCatalog().map((m) => [m.kind, m]));
    const lookup = byKind.get("securitytrails.lookup");
    expect(lookup).toBeTruthy();
    expect(lookup!.inputs.map((input) => input.key)).toEqual(
      expect.arrayContaining(["lookupKind", "query", "forceRefresh"]),
    );
    expect(lookup!.outputs.map((output) => output.key)).toEqual(
      expect.arrayContaining(["data", "usage"]),
    );

    for (const kind of [
      "trigger.securitytrails-lookup-complete",
      "trigger.securitytrails-result-changed",
    ]) {
      const trigger = byKind.get(kind);
      expect(trigger, `${kind} missing from catalog`).toBeTruthy();
      expect(trigger!.category).toBe("trigger");
      expect(trigger!.outputs.map((output) => output.key)).toEqual(
        expect.arrayContaining(["lookupKind", "query", "data"]),
      );
      expect(getAction(kind)).toBeTruthy();
    }
  });
});
