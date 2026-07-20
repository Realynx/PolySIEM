import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/api";
import { withElasticsearchUpstream } from "./elasticsearch-upstream";

describe("withElasticsearchUpstream", () => {
  it("returns successful query results unchanged", async () => {
    const value = { total: 3 };

    await expect(
      withElasticsearchUpstream(async () => value),
    ).resolves.toBe(value);
  });

  it("preserves intentional ApiErrors", async () => {
    const error = new ApiError(400, "invalid_query", "Invalid query");

    await expect(
      withElasticsearchUpstream(async () => {
        throw error;
      }),
    ).rejects.toBe(error);
  });

  it("normalizes transport errors into the existing 502 response", async () => {
    const promise = withElasticsearchUpstream(async () => {
      throw new Error("Connection refused");
    });

    await expect(promise).rejects.toMatchObject({
      status: 502,
      code: "es_error",
      message: "Connection refused",
    });
  });

  it("uses the safe fallback for non-Error failures", async () => {
    const promise = withElasticsearchUpstream(async () => {
      throw null;
    });

    await expect(promise).rejects.toMatchObject({
      status: 502,
      code: "es_error",
      message: "Elasticsearch query failed",
    });
  });
});
