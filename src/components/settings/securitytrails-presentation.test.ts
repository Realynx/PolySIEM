import { describe, expect, it } from "vitest";
import {
  DEFAULT_SECURITYTRAILS_AI_DAILY_LIMIT,
  securityTrailsAiDailyLimit,
  securityTrailsBudgetLabel,
} from "./securitytrails-presentation";

describe("SecurityTrails integration presentation", () => {
  it("uses the configured rolling AI/MCP allowance", () => {
    expect(securityTrailsAiDailyLimit({ aiDailyCallLimit: 24 })).toBe(24);
    expect(securityTrailsBudgetLabel(24)).toBe("AI/MCP · 24 live / 24h");
  });

  it("presents zero as cache-only and rejects invalid stored values", () => {
    expect(securityTrailsBudgetLabel(0)).toBe("AI/MCP cache-only");
    expect(securityTrailsAiDailyLimit({ aiDailyCallLimit: 101 })).toBe(DEFAULT_SECURITYTRAILS_AI_DAILY_LIMIT);
    expect(securityTrailsAiDailyLimit(null)).toBe(DEFAULT_SECURITYTRAILS_AI_DAILY_LIMIT);
  });
});
