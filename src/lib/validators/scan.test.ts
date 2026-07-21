import { describe, expect, it } from "vitest";
import { ticketPatchSchema } from "./scan";

describe("ticketPatchSchema", () => {
  it("requires rationale when closing a ticket", () => {
    expect(ticketPatchSchema.safeParse({ status: "CLOSED" }).success).toBe(false);
    expect(ticketPatchSchema.safeParse({ status: "CLOSED", resolution: "  " }).success).toBe(false);
  });

  it("trims and accepts a useful closure rationale", () => {
    const result = ticketPatchSchema.parse({
      status: "CLOSED",
      resolution: "  Benign scheduled backup traffic.  ",
    });
    expect(result.resolution).toBe("Benign scheduled backup traffic.");
  });

  it("does not require rationale for unrelated edits or reopening", () => {
    expect(ticketPatchSchema.safeParse({ severity: "HIGH" }).success).toBe(true);
    expect(ticketPatchSchema.safeParse({ status: "OPEN" }).success).toBe(true);
  });
});
