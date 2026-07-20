import { createHmac } from "node:crypto";
import type { AzureDestinationConfig } from "../types";
import { joinKey } from "./keys";

/**
 * Azure Blob Storage uploads without the Azure SDK. Two credential modes:
 *
 *  - "sas": the caller supplies a container SAS URL that already carries the
 *    signature in its query string; we just append the blob path and PUT.
 *  - "sharedKey": we build the `Authorization: SharedKey account:signature`
 *    header ourselves — an HMAC-SHA256 over Azure's canonicalized string.
 *
 * The pure string-to-sign construction is exported for unit testing.
 */

const API_VERSION = "2021-08-06";

/** Azure requires the RFC 1123 date form, which `toUTCString()` produces. */
export function rfc1123Date(now: Date): string {
  return now.toUTCString();
}

/**
 * Canonicalized headers block: every `x-ms-*` header, lower-cased, whitespace
 * collapsed, sorted lexicographically, joined by newlines (no trailing one).
 */
export function canonicalizedHeaders(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim().replace(/\s+/g, " ")] as const)
    .filter(([k]) => k.startsWith("x-ms-"))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}:${v}`)
    .join("\n");
}

export interface AzureStringToSignInput {
  method: string;
  contentLength: number;
  contentType: string;
  /** `/account/container/blob` plus any sorted `\ncomp:value` query lines. */
  canonicalizedResource: string;
  /** The x-ms-* headers that will be sent with the request. */
  xmsHeaders: Record<string, string>;
}

/**
 * Build the Shared Key string-to-sign. The 12 fixed lines run VERB..Range;
 * Content-Length is blank when zero (per the 2015-02-21+ contract). The
 * canonicalized headers block follows (each line newline-terminated) and then
 * the canonicalized resource.
 */
export function buildAzureStringToSign(input: AzureStringToSignInput): string {
  const fixed = [
    input.method,
    "", // Content-Encoding
    "", // Content-Language
    input.contentLength > 0 ? String(input.contentLength) : "", // Content-Length
    "", // Content-MD5
    input.contentType, // Content-Type
    "", // Date (we authenticate with x-ms-date instead)
    "", // If-Modified-Since
    "", // If-Match
    "", // If-None-Match
    "", // If-Unmodified-Since
    "", // Range
  ].join("\n");
  const headers = canonicalizedHeaders(input.xmsHeaders);
  return `${fixed}\n${headers}\n${input.canonicalizedResource}`;
}

/** HMAC-SHA256 (base64 key -> base64 signature) for the Authorization header. */
export function signAzureSharedKey(accountKey: string, stringToSign: string): string {
  return createHmac("sha256", Buffer.from(accountKey, "base64")).update(stringToSign, "utf8").digest("base64");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

/** Build a signed Shared Key request for the blob at `key`. */
function signSharedKeyRequest(
  config: AzureDestinationConfig,
  method: string,
  key: string,
  opts: { contentLength: number; contentType?: string; query?: Record<string, string>; now?: Date },
): SignedRequest {
  const account = config.accountName;
  const accountKey = config.accountKey;
  const container = config.container;
  if (!account || !accountKey || !container) {
    throw new Error("Azure sharedKey mode requires accountName, accountKey and container");
  }
  const xmsDate = rfc1123Date(opts.now ?? new Date());
  const xmsHeaders: Record<string, string> = {
    "x-ms-date": xmsDate,
    "x-ms-version": API_VERSION,
  };
  if (method === "PUT") xmsHeaders["x-ms-blob-type"] = "BlockBlob";

  const blobPath = key ? `/${container}/${key}` : `/${container}`;
  const query = opts.query ?? {};
  const queryLines = Object.keys(query)
    .sort()
    .map((k) => `${k.toLowerCase()}:${query[k]}`);
  const canonicalizedResource = [`/${account}${blobPath}`, ...queryLines].join("\n");

  const stringToSign = buildAzureStringToSign({
    method,
    contentLength: opts.contentLength,
    contentType: opts.contentType ?? "",
    canonicalizedResource,
    xmsHeaders,
  });
  const signature = signAzureSharedKey(accountKey, stringToSign);

  const sendHeaders: Record<string, string> = {
    ...xmsHeaders,
    Authorization: `SharedKey ${account}:${signature}`,
  };
  if (opts.contentType) sendHeaders["content-type"] = opts.contentType;

  const queryString = Object.keys(query)
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
  const url =
    `https://${account}.blob.core.windows.net${blobPath}` + (queryString ? `?${queryString}` : "");
  return { url, headers: sendHeaders };
}

/** Insert the blob path into a container SAS URL, keeping its token query. */
function sasBlobUrl(sasUrl: string, key: string): string {
  const u = new URL(sasUrl);
  const base = u.pathname.replace(/\/+$/, "");
  u.pathname = key ? `${base}/${key}` : base;
  return u.toString();
}

/** Turn an Azure error (header code or XML body) into a readable one-liner. */
function azureErrorMessage(status: number, errorCode: string | null, text: string): string {
  const code = errorCode ?? /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1]?.split("\n")[0];
  if (code || message) return `${code ?? "Azure error"}${message ? `: ${message}` : ""} (HTTP ${status})`;
  const snippet = text.trim().slice(0, 200);
  return `HTTP ${status}${snippet ? `: ${snippet}` : ""}`;
}

async function throwAzureError(res: Response): Promise<never> {
  throw new Error(azureErrorMessage(res.status, res.headers.get("x-ms-error-code"), await res.text().catch(() => "")));
}

/** Upload a block blob. Dispatches on the configured credential mode. */
export async function putBlobAzure(
  config: AzureDestinationConfig,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (config.mode === "sas") {
    if (!config.sasUrl) throw new Error("Azure sas mode requires a SAS URL");
    const res = await fetch(sasBlobUrl(config.sasUrl, key), {
      method: "PUT",
      headers: {
        "x-ms-blob-type": "BlockBlob",
        "x-ms-version": API_VERSION,
        "content-type": contentType,
      },
      body: new Uint8Array(body),
    });
    if (!res.ok) await throwAzureError(res);
    return;
  }
  const { url, headers } = signSharedKeyRequest(config, "PUT", key, {
    contentLength: body.length,
    contentType,
  });
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  if (!res.ok) await throwAzureError(res);
}

/** A human summary of where backups land (no SAS token / secrets). */
export function azureLocation(config: AzureDestinationConfig): string {
  if (config.mode === "sas") {
    if (!config.sasUrl) return "azure://(unconfigured)";
    try {
      const u = new URL(config.sasUrl);
      return `azure://${u.host}${u.pathname}`.replace(/\/+$/, "");
    } catch {
      return "azure://(invalid SAS URL)";
    }
  }
  const prefix = (config.prefix ?? "").replace(/^\/+/, "");
  return `azure://${config.accountName ?? "?"}/${config.container ?? "?"}/${prefix}`;
}

/** Connectivity probe: PUT a tiny `.polysiem-test` blob. */
export async function testAzure(config: AzureDestinationConfig): Promise<{ ok: boolean; detail: string }> {
  const key = config.mode === "sharedKey" ? joinKey(config.prefix, ".polysiem-test") : ".polysiem-test";
  try {
    await putBlobAzure(config, key, Buffer.from("polysiem connectivity test\n"), "text/plain");
    return { ok: true, detail: `Wrote ${azureLocation(config)}/${key}`.replace(/([^:])\/\//g, "$1/") };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface AzureBlob {
  key: string;
  lastModified: string;
}

/**
 * List blobs under the container/prefix (sharedKey mode only — a container SAS
 * needs the list permission which we cannot assume). Used for retention.
 */
export async function listBlobsAzure(config: AzureDestinationConfig): Promise<AzureBlob[]> {
  if (config.mode !== "sharedKey") return [];
  const query: Record<string, string> = { comp: "list", restype: "container" };
  if (config.prefix) query.prefix = config.prefix;
  const { url, headers } = signSharedKeyRequest(config, "GET", "", { contentLength: 0, query });
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) await throwAzureError(res);
  const xml = await res.text();
  const blobs: AzureBlob[] = [];
  const re = /<Blob>([\s\S]*?)<\/Blob>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const name = /<Name>([^<]+)<\/Name>/.exec(block)?.[1];
    const lastModified = /<Last-Modified>([^<]+)<\/Last-Modified>/.exec(block)?.[1] ?? "";
    if (name) blobs.push({ key: name, lastModified });
  }
  return blobs;
}

/** Delete a single blob (sharedKey mode). */
export async function deleteBlobAzure(config: AzureDestinationConfig, key: string): Promise<void> {
  const { url, headers } = signSharedKeyRequest(config, "DELETE", key, { contentLength: 0 });
  const res = await fetch(url, { method: "DELETE", headers });
  if (!res.ok) await throwAzureError(res);
}
