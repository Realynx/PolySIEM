import { describe, expect, it } from "vitest";
import {
  describeSeverityFilter,
  severityRank,
  threatTicketConfigSchema,
  ticketMatches,
} from "./threat-trigger-logic";

const ticket = (over: Partial<{ severity: string; category: string; createdBy: string }> = {}) => ({
  severity: "HIGH",
  category: "ids-alert",
  createdBy: "ai",
  ...over,
});

const config = (over: Record<string, unknown> = {}) => threatTicketConfigSchema.parse(over);

describe("severityRank", () => {
  it("orders the bands low to high", () => {
    expect(severityRank("INFO")).toBeLessThan(severityRank("LOW"));
    expect(severityRank("LOW")).toBeLessThan(severityRank("MEDIUM"));
    expect(severityRank("MEDIUM")).toBeLessThan(severityRank("HIGH"));
    expect(severityRank("HIGH")).toBeLessThan(severityRank("CRITICAL"));
  });

  it("treats an unknown severity as the lowest band rather than throwing", () => {
    expect(severityRank("NONSENSE")).toBe(severityRank("INFO"));
  });
});

describe("ticketMatches — severity", () => {
  it("at-or-above fires for the selected band and everything above it", () => {
    const cfg = config({ severity: "HIGH" });
    expect(ticketMatches(ticket({ severity: "HIGH" }), cfg)).toBe(true);
    expect(ticketMatches(ticket({ severity: "CRITICAL" }), cfg)).toBe(true);
  });

  it("at-or-above ignores everything below the selected band", () => {
    const cfg = config({ severity: "HIGH" });
    for (const severity of ["MEDIUM", "LOW", "INFO"]) {
      expect(ticketMatches(ticket({ severity }), cfg), severity).toBe(false);
    }
  });

  it("exactly fires for one band only", () => {
    const cfg = config({ severity: "HIGH", severityMatch: "exactly" });
    expect(ticketMatches(ticket({ severity: "HIGH" }), cfg)).toBe(true);
    expect(ticketMatches(ticket({ severity: "CRITICAL" }), cfg)).toBe(false);
    expect(ticketMatches(ticket({ severity: "MEDIUM" }), cfg)).toBe(false);
  });

  it("INFO at-or-above lets everything through", () => {
    const cfg = config({ severity: "INFO" });
    for (const severity of ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"]) {
      expect(ticketMatches(ticket({ severity }), cfg), severity).toBe(true);
    }
  });
});

describe("ticketMatches — category and source", () => {
  it("defaults to any category and any author", () => {
    const cfg = config({ severity: "INFO" });
    expect(ticketMatches(ticket({ category: "auth", createdBy: "user" }), cfg)).toBe(true);
  });

  it("filters by category when one is chosen", () => {
    const cfg = config({ severity: "INFO", category: "auth" });
    expect(ticketMatches(ticket({ category: "auth" }), cfg)).toBe(true);
    expect(ticketMatches(ticket({ category: "traffic" }), cfg)).toBe(false);
  });

  it("filters by who opened the ticket", () => {
    const cfg = config({ severity: "INFO", createdBy: "ai" });
    expect(ticketMatches(ticket({ createdBy: "ai" }), cfg)).toBe(true);
    expect(ticketMatches(ticket({ createdBy: "user" }), cfg)).toBe(false);
  });

  it("requires every active filter to pass", () => {
    const cfg = config({ severity: "HIGH", category: "auth", createdBy: "ai" });
    expect(ticketMatches(ticket({ severity: "HIGH", category: "auth", createdBy: "ai" }), cfg)).toBe(true);
    // Right severity and category, wrong author.
    expect(ticketMatches(ticket({ severity: "HIGH", category: "auth", createdBy: "user" }), cfg)).toBe(false);
  });
});

describe("config schema", () => {
  it("defaults to MEDIUM and above, any category, any author", () => {
    const cfg = config();
    expect(cfg.severity).toBe("MEDIUM");
    expect(cfg.severityMatch).toBe("at-or-above");
    expect(cfg.category).toBe("any");
    expect(cfg.createdBy).toBe("any");
    expect(cfg.params).toEqual([]);
  });

  it("rejects a severity outside the known bands", () => {
    expect(() => threatTicketConfigSchema.parse({ severity: "URGENT" })).toThrow();
  });

  it("describes the filter in words", () => {
    expect(describeSeverityFilter(config({ severity: "HIGH" }))).toBe("severity HIGH or higher");
    expect(describeSeverityFilter(config({ severity: "LOW", severityMatch: "exactly" }))).toBe(
      "severity exactly LOW",
    );
  });
});
