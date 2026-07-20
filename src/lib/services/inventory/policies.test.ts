import { describe, expect, it } from "vitest";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";
import { baseWhere, paging } from "./query";

describe("inventory ownership policies", () => {
  it("allows all manual edits and only user metadata on synced rows", () => {
    expect(() => assertSyncedEdit("MANUAL", { name: "renamed" })).not.toThrow();
    expect(() =>
      assertSyncedEdit("PROXMOX", {
        description: "operator note",
        location: undefined,
      }),
    ).not.toThrow();
    expect(() => assertSyncedEdit("PROXMOX", { name: "renamed" })).toThrow(
      /managed by the integration sync/,
    );
  });

  it("allows deletion only for manual rows", () => {
    expect(() => assertManualDelete("MANUAL")).not.toThrow();
    expect(() => assertManualDelete("OPNSENSE")).toThrow(
      /recreated on the next sync/,
    );
  });

  it("preserves the shared not-found API error", () => {
    expect(() => entityNotFound()).toThrow("Entity not found");
  });
});

describe("inventory list query helpers", () => {
  it("calculates stable offset paging", () => {
    expect(paging({ page: 3, pageSize: 25 })).toEqual({ skip: 50, take: 25 });
  });

  it("defaults to non-removed rows and preserves explicit filters", () => {
    expect(baseWhere({ page: 1, pageSize: 50 })).toEqual({
      status: { not: "REMOVED" },
    });
    expect(
      baseWhere({
        page: 1,
        pageSize: 50,
        q: "edge",
        source: "MANUAL",
        status: "REMOVED",
      }),
    ).toEqual({
      name: { contains: "edge", mode: "insensitive" },
      source: "MANUAL",
      status: "REMOVED",
    });
  });
});
