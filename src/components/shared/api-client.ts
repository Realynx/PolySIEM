"use client";

import { requestApiEnvelope } from "@/components/shared/api-envelope";

/** Minimal client fetch wrapper for the `{ data } / { error }` API shape. */
export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const json = await requestApiEnvelope<T>(
    url,
    {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    },
    (status) => `Request failed with status ${status}`,
  );
  return (json as { data: T }).data;
}
