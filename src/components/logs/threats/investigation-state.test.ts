import { describe, expect, it } from "vitest";
import type { InvestigationStatus } from "@/lib/ai/agent/contract";
import type { SecurityTicketDto } from "@/lib/types";
import {
  hasActiveInvestigation,
  investigationStatusMeta,
  isInvestigationActive,
} from "./investigation-state";

/** Minimal ticket stub — the selectors only read `investigationStatus`. */
const ticket = (status: InvestigationStatus | null): SecurityTicketDto =>
  ({ id: status ?? "none", investigationStatus: status } as unknown as SecurityTicketDto);

describe("isInvestigationActive", () => {
  it("is true only for queued/running", () => {
    expect(isInvestigationActive("queued")).toBe(true);
    expect(isInvestigationActive("running")).toBe(true);
  });

  it("is false for terminal or absent states", () => {
    expect(isInvestigationActive("success")).toBe(false);
    expect(isInvestigationActive("failed")).toBe(false);
    expect(isInvestigationActive(null)).toBe(false);
    expect(isInvestigationActive(undefined)).toBe(false);
  });
});

describe("hasActiveInvestigation", () => {
  it("is true when at least one ticket is queued/running", () => {
    expect(hasActiveInvestigation([ticket("success"), ticket("running"), ticket(null)])).toBe(true);
    expect(hasActiveInvestigation([ticket("queued")])).toBe(true);
  });

  it("is false when every ticket is terminal or never investigated", () => {
    expect(hasActiveInvestigation([ticket("success"), ticket("failed"), ticket(null)])).toBe(false);
  });

  it("is false for an empty or missing list", () => {
    expect(hasActiveInvestigation([])).toBe(false);
    expect(hasActiveInvestigation(undefined)).toBe(false);
    expect(hasActiveInvestigation(null)).toBe(false);
  });
});

describe("investigationStatusMeta", () => {
  it("maps each status to a label + tone, with active set for live states", () => {
    expect(investigationStatusMeta("queued")).toMatchObject({ label: "queued", active: true });
    expect(investigationStatusMeta("running")).toMatchObject({ label: "investigating", active: true });
    expect(investigationStatusMeta("success")).toMatchObject({ active: false });
    expect(investigationStatusMeta("failed")).toMatchObject({ label: "failed", active: false });
  });

  it("uses app tone tokens per status", () => {
    expect(investigationStatusMeta("running")?.className).toContain("primary");
    expect(investigationStatusMeta("success")?.className).toContain("success");
    expect(investigationStatusMeta("failed")?.className).toContain("destructive");
  });

  it("returns null when there's nothing to show", () => {
    expect(investigationStatusMeta(null)).toBeNull();
    expect(investigationStatusMeta(undefined)).toBeNull();
  });
});
