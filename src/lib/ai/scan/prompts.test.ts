import { describe, expect, it } from "vitest";
import {
  buildScanPrompt,
  EXISTING_TICKET_CAP,
  renderExistingTickets,
  scoreTicketRelevance,
  type ExistingTicketContext,
} from "./prompts";
import { parseFindings } from "./parse";
import { mockGenerateJson } from "@/lib/ai/mock";
import type { ScopeDigest } from "./collect";

const digest = (text: string): ScopeDigest => ({ scope: "suricata", text, samples: [], docCount: 1 });

const closedTicket: ExistingTicketContext = {
  handle: "T1",
  title: "Outbound DNS to .top TLD",
  status: "CLOSED",
  severity: "MEDIUM",
  summary: "A trusted host queried a .top domain.",
  refs: { srcIps: ["10.0.1.42"], signatures: ["ET INFO Observed DNS Query to .top TLD"] },
  resolution: "Benign: pihole update job, dismissed.",
};

const openTicket: ExistingTicketContext = {
  handle: "T2",
  title: "ET SCAN mySQL sweep",
  status: "OPEN",
  severity: "HIGH",
  summary: "External host sweeping port 3306.",
  refs: { srcIps: ["185.220.101.34"], destIps: ["10.0.20.15"] },
  resolution: null,
};

describe("renderExistingTickets", () => {
  it("includes a closed ticket's resolution text and refs", () => {
    const out = renderExistingTickets([closedTicket]);
    expect(out).toContain("Benign: pihole update job");
    expect(out).toContain("10.0.1.42");
    expect(out).toContain("[T1]");
    expect(out).toContain("CLOSED");
  });

  it("omits a resolution line for open tickets", () => {
    const out = renderExistingTickets([openTicket]);
    expect(out).not.toContain("resolution:");
    expect(out).toContain("[T2]");
  });

  it("respects the cap on rendered tickets", () => {
    const many: ExistingTicketContext[] = Array.from({ length: EXISTING_TICKET_CAP + 5 }, (_, i) => ({
      ...openTicket,
      handle: `T${i + 1}`,
    }));
    const lines = renderExistingTickets(many).split("\n");
    expect(lines).toHaveLength(EXISTING_TICKET_CAP);
  });

  it("handles an empty list", () => {
    expect(renderExistingTickets([])).toBe("No existing tickets.");
  });
});

describe("scoreTicketRelevance", () => {
  it("scores tickets whose refs appear in the digest higher", () => {
    const text = "alerts from 185.220.101.34 toward 10.0.20.15";
    expect(scoreTicketRelevance(openTicket.refs, text)).toBeGreaterThan(scoreTicketRelevance(closedTicket.refs, text));
  });

  it("is zero for null refs or no overlap", () => {
    expect(scoreTicketRelevance(null, "anything")).toBe(0);
    expect(scoreTicketRelevance(openTicket.refs, "unrelated text")).toBe(0);
  });
});

describe("buildScanPrompt", () => {
  it("embeds the existing-ticket context including closed resolutions", () => {
    const prompt = buildScanPrompt(digest("Suricata IDS alerts for the window"), [], [closedTicket, openTicket]);
    expect(prompt).toContain("Existing tickets");
    expect(prompt).toContain("Benign: pihole update job");
    expect(prompt).toContain("[T1]");
    expect(prompt).toContain("[T2]");
    expect(prompt).toContain("Digest:");
  });

  it("degrades gracefully when there are no existing tickets", () => {
    const prompt = buildScanPrompt(digest("d"), []);
    expect(prompt).toContain("No existing tickets.");
  });
});

describe("mock scan findings", () => {
  it("still parse against the schema for every scope", async () => {
    for (const scope of ["suricata", "cloudflared", "general"]) {
      const raw = await mockGenerateJson(`Log scope: ${scope}\nDigest: ...`);
      const findings = parseFindings(raw);
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) expect(f.matchesExisting == null).toBe(true);
    }
  });
});
