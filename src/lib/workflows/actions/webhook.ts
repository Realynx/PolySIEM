import { z } from "zod";
import type { ActionDefinition } from "../registry";

const METHODS = ["POST", "PUT", "PATCH", "GET", "DELETE"] as const;

const configSchema = z.object({
  url: z.url(),
  method: z.enum(METHODS).default("POST"),
  body: z.string().max(100_000).optional(),
  headers: z.string().max(10_000).optional(),
  timeoutSeconds: z.coerce.number().int().min(1).max(60).default(15),
});

/** Longest response body persisted in step output (chars). */
const MAX_BODY_CHARS = 4000;

function bodyFor(method: string, body: string | undefined): string | undefined {
  return method !== "GET" && method !== "DELETE" && body ? body : undefined;
}

async function sendWebhook(
  url: string,
  method: string,
  headers: Headers,
  body: string | undefined,
  timeoutSeconds: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      signal: AbortSignal.timeout(timeoutSeconds * 1000),
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`Request to ${url} timed out after ${timeoutSeconds}s — raise the timeout or check that the endpoint responds`);
    }
    const cause = err instanceof Error && err.cause instanceof Error ? err.cause.message : null;
    const detail = cause ?? (err instanceof Error ? err.message : String(err));
    throw new Error(`Could not reach ${url}: ${detail}. Check the URL and that the host is reachable from the PolySIEM server`);
  }
}

/**
 * Parse "Name: value" header lines (one per line, blank lines ignored) into a
 * header record. Throws an actionable error on a line without a name/colon.
 * Pure and exported for unit tests.
 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon <= 0) {
      throw new Error(`Invalid header line "${line}" — use one "Name: value" pair per line`);
    }
    const name = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (!name) {
      throw new Error(`Invalid header line "${line}" — the header name is empty`);
    }
    headers[name] = value;
  }
  return headers;
}

/** True when the (trimmed) body text parses as JSON. Pure and exported for unit tests. */
export function isJsonBody(body: string): boolean {
  const trimmed = body.trim();
  if (!trimmed) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

/**
 * Pretty first-level view of a JSON document: top-level keys kept, nested
 * objects/arrays collapsed to their compact JSON strings. Returns "" when the
 * text is not JSON. Pure and exported for unit tests.
 */
export function firstLevelJson(text: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return "";
  }
  const collapse = (value: unknown): unknown =>
    value !== null && typeof value === "object" ? JSON.stringify(value) : value;
  if (Array.isArray(parsed)) {
    return JSON.stringify(parsed.map(collapse), null, 2);
  }
  if (parsed !== null && typeof parsed === "object") {
    return JSON.stringify(
      Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, collapse(v)])),
      null,
      2,
    );
  }
  return JSON.stringify(parsed);
}

/**
 * http.webhook — send an HTTP request to any URL. The body is sent verbatim
 * (Content-Type auto-detected: application/json when it parses as JSON, else
 * text/plain, unless a Content-Type header is supplied). Non-2xx responses do
 * NOT fail the step — branch on the "ok" output instead; only network
 * failures/timeouts throw. GET/DELETE never send a body.
 */
export const httpWebhook: ActionDefinition = {
  meta: {
    kind: "http.webhook",
    title: "HTTP request",
    description:
      "Sends an HTTP request. Body and headers are templateable; the response status, body (truncated), and parsed JSON are available to downstream nodes. Non-2xx responses set ok to \"false\" instead of failing the step.",
    category: "http",
    inputs: [
      {
        key: "url",
        label: "URL",
        type: "string",
        required: true,
        placeholder: "https://example.com/hook",
      },
      {
        key: "method",
        label: "Method",
        type: "select",
        required: false,
        options: METHODS.map((m) => ({ value: m, label: m })),
        help: "Defaults to POST. GET and DELETE never send a body.",
      },
      {
        key: "body",
        label: "Body",
        type: "text",
        required: false,
        placeholder: '{"machine": "{{input.name}}", "ip": "{{nodes.step1.ip}}"}',
        help: "Sent verbatim after template resolution. JSON bodies get Content-Type application/json, everything else text/plain.",
      },
      {
        key: "headers",
        label: "Headers",
        type: "text",
        required: false,
        placeholder: "Authorization: Bearer {{nodes.cred.secret}}",
        help: 'One "Name: value" per line; templateable so secrets can flow in from credential outputs.',
      },
      {
        key: "timeoutSeconds",
        label: "Timeout (seconds)",
        type: "number",
        required: false,
        help: "Defaults to 15, max 60.",
      },
    ],
    outputs: [
      { key: "status", label: "HTTP status code" },
      { key: "ok", label: 'Success ("true"/"false")' },
      { key: "body", label: "Response body (truncated)" },
      { key: "json", label: "Response JSON (first level)" },
    ],
  },
  configSchema,
  async run({ config }) {
    const { url, method, body, headers: headerText, timeoutSeconds } = configSchema.parse(config);
    const headers = new Headers(parseHeaderLines(headerText ?? ""));
    const requestBody = bodyFor(method, body);
    if (requestBody && !headers.has("content-type")) {
      headers.set("content-type", isJsonBody(requestBody) ? "application/json" : "text/plain");
    }
    const res = await sendWebhook(url, method, headers, requestBody, timeoutSeconds);

    const text = await res.text().catch(() => "");
    return {
      status: res.status,
      ok: res.ok ? "true" : "false",
      body: text.slice(0, MAX_BODY_CHARS),
      json: firstLevelJson(text),
    };
  },
};
