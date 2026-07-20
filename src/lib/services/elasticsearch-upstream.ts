import "server-only";

import { ApiError } from "@/lib/api";

/**
 * Normalize Elasticsearch transport failures at the service boundary.
 * ApiErrors are already intentional service responses and pass through.
 */
export async function withElasticsearchUpstream<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      502,
      "es_error",
      err instanceof Error ? err.message : "Elasticsearch query failed",
    );
  }
}
