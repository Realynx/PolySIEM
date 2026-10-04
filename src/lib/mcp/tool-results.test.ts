import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "@/lib/api";
import { describeError } from "./tool-results";

describe("describeError", () => {
  it("adds hints to known API errors", () => {
    expect(describeError(new ApiError(404, "not_found", "Device not found"))).toMatchObject({
      code: "not_found",
      message: "Device not found",
      hint: expect.stringContaining("search"),
    });
  });

  it("flattens zod issues into readable lines", () => {
    const result = z.object({ limit: z.number().max(5) }).safeParse({ limit: 9 });
    const payload = describeError(result.error);
    expect(payload.code).toBe("validation_error");
    expect(payload.issues?.[0]).toMatch(/^limit: /);
  });

  it("maps Prisma error codes", () => {
    expect(describeError(Object.assign(new Error("x"), { code: "P2025" })).code).toBe("not_found");
    expect(describeError(Object.assign(new Error("x"), { code: "P2002" })).code).toBe("conflict");
  });

  it("never leaks stack traces or credentials from unexpected errors", () => {
    const err = new Error("connect failed password=hunter2\n    at Socket.connect (net.js:1:1)");
    const payload = describeError(err);
    expect(payload.code).toBe("internal_error");
    expect(payload.message).not.toContain("hunter2");
    expect(payload.message).not.toContain("Socket.connect");
  });
});
