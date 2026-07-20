"use client";

import { requestApiEnvelope } from "@/components/shared/api-envelope";

/** Minimal client-side fetch helper for PolySIEM `{ data } / { error }` endpoints. */
export async function apiSend<T = unknown>(
  path: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const json = await requestApiEnvelope<T>(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  }, (status) => `Request failed (${status})`);
  return json?.data as T;
}
