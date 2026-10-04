import { describe, expect, it, vi } from "vitest";

vi.mock("@prisma/client", () => ({ PrismaClient: class {} }));

const { withConnectionFloor } = await import("./db");

describe("withConnectionFloor", () => {
  it("adds a pool floor when the URL doesn't set one", () => {
    expect(withConnectionFloor("postgresql://u:p@db:5432/polysiem?schema=public")).toBe(
      "postgresql://u:p@db:5432/polysiem?schema=public&connection_limit=10",
    );
  });

  it("respects an operator-pinned connection_limit", () => {
    const url = "postgresql://u:p@db:5432/polysiem?connection_limit=3";
    expect(withConnectionFloor(url)).toBe(url);
  });

  it("passes through missing or unparseable URLs", () => {
    expect(withConnectionFloor(undefined)).toBeUndefined();
    expect(withConnectionFloor("not a url")).toBe("not a url");
  });
});
