import { describe, expect, it } from "vitest";
import { isActiveUpdateRequest, type UpdateRequest } from "./request";

const request = (status: UpdateRequest["status"]): UpdateRequest => ({
  id: "request-1",
  targetVersion: "2.0.0",
  status,
  requestedAt: "2026-07-21T12:00:00.000Z",
  updatedAt: "2026-07-21T12:00:00.000Z",
  requestedBy: "admin-1",
});

describe("update requests", () => {
  it.each(["queued", "installing"] as const)("treats %s as active", (status) => {
    expect(isActiveUpdateRequest(request(status))).toBe(true);
  });

  it.each(["completed", "failed"] as const)("treats %s as terminal", (status) => {
    expect(isActiveUpdateRequest(request(status))).toBe(false);
  });
});
