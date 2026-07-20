"use client";

export interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/**
 * Shared transport/parser for PolySIEM's `{ data } / { error }` JSON envelope.
 * Feature-level wrappers keep control of request construction and their
 * existing fallback error copy.
 */
export async function requestApiEnvelope<T>(
  url: string,
  init: RequestInit | undefined,
  fallbackError: (status: number) => string,
): Promise<ApiEnvelope<T> | null> {
  const response = await fetch(url, init);
  const json = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok) {
    throw new Error(json?.error?.message ?? fallbackError(response.status));
  }
  return json;
}
