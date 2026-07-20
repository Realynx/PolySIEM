import { describe, expect, it } from "vitest";
import { normalizeCensysCreditBalance } from "./client";

describe("normalizeCensysCreditBalance", () => {
  it("normalizes a personal balance-only response", () => {
    expect(normalizeCensysCreditBalance({ result: { balance: 99 } }, "user")).toEqual({
      remaining: 99,
      limit: null,
      used: null,
      expiresAt: null,
      scope: "user",
    });
  });

  it("derives used credits when the provider returns a limit and remaining balance", () => {
    expect(normalizeCensysCreditBalance({
      result: { credits_remaining: 73, monthly_limit: 100, expires_at: "2026-08-01T00:00:00Z" },
    }, "organization")).toEqual({
      remaining: 73,
      limit: 100,
      used: 27,
      expiresAt: "2026-08-01T00:00:00Z",
      scope: "organization",
    });
  });

  it("handles nested account envelopes and explicit usage", () => {
    expect(normalizeCensysCreditBalance({ result: { wallets: [{
      available_credits: "48",
      total_credits: "80",
      credits_used: "32",
    }] } }, "user")).toMatchObject({ remaining: 48, limit: 80, used: 32 });
  });
});
