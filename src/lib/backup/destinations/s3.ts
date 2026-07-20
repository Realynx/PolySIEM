import { createHash, createHmac } from "node:crypto";
import type { S3DestinationConfig } from "../types";
import { joinKey } from "./keys";

/**
 * AWS Signature Version 4 signing for single-PUT uploads to any S3-compatible
 * endpoint (AWS S3, Backblaze B2, Wasabi, MinIO). No cloud SDK — just Node
 * `crypto`. The fiddly, deterministic pieces (URI encoding, the canonical
 * request, the signing-key HMAC chain) are exported as pure helpers so they can
 * be verified against AWS's published known-answer vectors (see s3.test.ts).
 */

const SERVICE = "s3";
const ALGORITHM = "AWS4-HMAC-SHA256";

/** A destination whose secret has already been decrypted for use. */
type ResolvedS3Config = S3DestinationConfig & { secretAccessKey: string };

export function sha256Hex(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

/**
 * RFC 3986 percent-encoding as required by SigV4. Unreserved characters
 * (A-Z a-z 0-9 - _ . ~) pass through; everything else becomes %XX (upper-case).
 * `/` is preserved in path context (encodeSlash=false) and encoded in query
 * context (encodeSlash=true). Iterating raw UTF-8 bytes keeps multi-byte
 * characters correct.
 */
export function uriEncode(input: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(input, "utf8")) {
    const isUnreserved =
      (byte >= 0x41 && byte <= 0x5a) || // A-Z
      (byte >= 0x61 && byte <= 0x7a) || // a-z
      (byte >= 0x30 && byte <= 0x39) || // 0-9
      byte === 0x2d || // -
      byte === 0x5f || // _
      byte === 0x2e || // .
      byte === 0x7e; // ~
    if (isUnreserved) {
      out += String.fromCharCode(byte);
    } else if (byte === 0x2f) {
      out += encodeSlash ? "%2F" : "/";
    } else {
      out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

/** SigV4 timestamps: `20130524T000000Z` (amzDate) and `20130524` (dateStamp). */
export function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/** The kSecret -> kDate -> kRegion -> kService -> kSigning HMAC chain. */
export function deriveSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string = SERVICE,
): Buffer {
  const kDate = hmac("AWS4" + secretAccessKey, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

export interface CanonicalRequestInput {
  method: string;
  /** Already percent-encoded path, e.g. `/bucket/polysiem/backup.gz`. */
  canonicalUri: string;
  /** Already-encoded, sorted `k=v&k=v` (empty string when there is no query). */
  canonicalQuery: string;
  /** Raw (un-lowercased) header map; case and ordering are normalised here. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the request body. */
  payloadHash: string;
}

/** Build the SigV4 canonical request string and its signed-header list. */
export function buildCanonicalRequest(input: CanonicalRequestInput): {
  canonicalRequest: string;
  signedHeaders: string;
} {
  const normalized = Object.entries(input.headers)
    .map(([k, v]) => [k.toLowerCase().trim(), v.trim().replace(/\s+/g, " ")] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = normalized.map(([k, v]) => `${k}:${v}\n`).join("");
  const signedHeaders = normalized.map(([k]) => k).join(";");
  const canonicalRequest = [
    input.method,
    input.canonicalUri,
    input.canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");
  return { canonicalRequest, signedHeaders };
}

/** The string-to-sign: algorithm, timestamp, credential scope, request hash. */
export function buildStringToSign(
  amzDate: string,
  credentialScope: string,
  canonicalRequest: string,
): string {
  return [ALGORITHM, amzDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
}

/** Sort + encode a query map into a SigV4 canonical query string. */
export function canonicalQueryString(query: Record<string, string>): string {
  return Object.entries(query)
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
}

interface SignedRequest {
  url: string;
  headers: Record<string, string>;
}

interface SignOptions {
  method: string;
  key: string;
  query?: Record<string, string>;
  body: Buffer;
  contentType?: string;
  now?: Date;
}

/**
 * Produce the fully-signed URL + headers for one S3 request. Chooses
 * virtual-host (`bucket.endpoint`) or path-style (`endpoint/bucket`) addressing
 * per `forcePathStyle` (B2/MinIO usually need path-style).
 */
function signS3Request(config: ResolvedS3Config, opts: SignOptions): SignedRequest {
  if (!config.secretAccessKey) throw new Error("S3 secretAccessKey is missing");
  const endpoint = new URL(config.endpoint);
  const encodedKey = uriEncode(opts.key, false); // preserve `/` between segments

  let host: string;
  let canonicalUri: string;
  if (config.forcePathStyle) {
    host = endpoint.host;
    const bucketPath = `/${uriEncode(config.bucket, false)}`;
    canonicalUri = encodedKey ? `${bucketPath}/${encodedKey}` : bucketPath;
  } else {
    host = `${config.bucket}.${endpoint.host}`;
    canonicalUri = `/${encodedKey}`;
  }

  const { amzDate, dateStamp } = amzDates(opts.now ?? new Date());
  const payloadHash = sha256Hex(opts.body);
  const canonicalQuery = opts.query ? canonicalQueryString(opts.query) : "";

  const signHeaders: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (opts.contentType) signHeaders["content-type"] = opts.contentType;

  const { canonicalRequest, signedHeaders } = buildCanonicalRequest({
    method: opts.method,
    canonicalUri,
    canonicalQuery,
    headers: signHeaders,
    payloadHash,
  });

  const credentialScope = `${dateStamp}/${config.region}/${SERVICE}/aws4_request`;
  const stringToSign = buildStringToSign(amzDate, credentialScope, canonicalRequest);
  const signingKey = deriveSigningKey(config.secretAccessKey, dateStamp, config.region);
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorization =
    `${ALGORITHM} Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // `host` and `content-length` are set by fetch itself; do not send them here.
  const sendHeaders: Record<string, string> = {
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    Authorization: authorization,
  };
  if (opts.contentType) sendHeaders["content-type"] = opts.contentType;

  const url = `${endpoint.protocol}//${host}${canonicalUri}${canonicalQuery ? `?${canonicalQuery}` : ""}`;
  return { url, headers: sendHeaders };
}

/** Turn an S3 XML error body (or bare status) into a readable one-liner. */
function s3ErrorMessage(status: number, text: string): string {
  const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1];
  const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1];
  if (code || message) return `${code ?? "S3 error"}${message ? `: ${message}` : ""} (HTTP ${status})`;
  const snippet = text.trim().slice(0, 200);
  return `HTTP ${status}${snippet ? `: ${snippet}` : ""}`;
}

/** Single-PUT upload of `body` to `key`. Throws a readable error on non-2xx. */
export async function putObjectS3(
  config: ResolvedS3Config,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  const { url, headers } = signS3Request(config, { method: "PUT", key, body, contentType });
  const res = await fetch(url, { method: "PUT", headers, body: new Uint8Array(body) });
  if (!res.ok) throw new Error(s3ErrorMessage(res.status, await res.text().catch(() => "")));
}

/** `s3://bucket/prefix` — a human summary of where backups land (no secrets). */
export function s3Location(config: S3DestinationConfig): string {
  const prefix = (config.prefix ?? "").replace(/^\/+/, "");
  return `s3://${config.bucket}/${prefix}`;
}

/**
 * Connectivity probe: PUT a tiny `.polysiem-test` object under the prefix. A
 * clean {ok,detail} is returned either way so signature/permission errors
 * surface readably in the UI.
 */
export async function testS3(config: ResolvedS3Config): Promise<{ ok: boolean; detail: string }> {
  const key = joinKey(config.prefix, ".polysiem-test");
  try {
    await putObjectS3(config, key, Buffer.from("polysiem connectivity test\n"), "text/plain");
    return { ok: true, detail: `Wrote s3://${config.bucket}/${key}` };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

export interface S3Object {
  key: string;
  lastModified: string;
}

/** List objects under a prefix via ListObjectsV2 (used for retention pruning). */
export async function listObjectsS3(config: ResolvedS3Config, prefix: string): Promise<S3Object[]> {
  const query: Record<string, string> = { "list-type": "2" };
  if (prefix) query.prefix = prefix;
  const { url, headers } = signS3Request(config, {
    method: "GET",
    key: "",
    query,
    body: Buffer.alloc(0),
  });
  const res = await fetch(url, { method: "GET", headers });
  if (!res.ok) throw new Error(s3ErrorMessage(res.status, await res.text().catch(() => "")));
  const xml = await res.text();
  const objects: S3Object[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const block = m[1];
    const key = /<Key>([^<]+)<\/Key>/.exec(block)?.[1];
    const lastModified = /<LastModified>([^<]+)<\/LastModified>/.exec(block)?.[1] ?? "";
    if (key) objects.push({ key, lastModified });
  }
  return objects;
}

/** Delete a single object. Throws a readable error on failure. */
export async function deleteObjectS3(config: ResolvedS3Config, key: string): Promise<void> {
  const { url, headers } = signS3Request(config, { method: "DELETE", key, body: Buffer.alloc(0) });
  const res = await fetch(url, { method: "DELETE", headers });
  // S3 returns 204 for a successful delete; treat any 2xx as success.
  if (!res.ok) throw new Error(s3ErrorMessage(res.status, await res.text().catch(() => "")));
}
