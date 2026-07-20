"use client";

import { anonymizeDeep } from "@/lib/privacy/anonymize";
import { isPrivacyActive, shouldAnonymizeRequest } from "@/lib/privacy/client-state";

export interface ApiEnvelope<T> {
  data?: T;
  error?: { code?: string; message?: string };
}

/**
 * Shared transport/parser for PolySIEM's `{ data } / { error }` JSON envelope.
 * Feature-level wrappers keep control of request construction and their
 * existing fallback error copy.
 *
 * When privacy (anonymous mode / shield) is active, GET responses from
 * display endpoints are anonymized here — the single choke point for all
 * client-fetched data.
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
  if (json?.data !== undefined && isPrivacyActive() && shouldAnonymizeRequest(url, init?.method)) {
    json.data = anonymizeDeep(json.data);
  }
  return json;
}
