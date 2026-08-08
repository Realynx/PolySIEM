/** Long enough for a sizeable single-PUT backup, but never unbounded. */
export const BACKUP_UPLOAD_TIMEOUT_MS = 5 * 60_000;
/** List/delete operations should fail fast enough for scheduler retries. */
export const BACKUP_METADATA_TIMEOUT_MS = 30_000;

export async function backupStorageFetch(
  provider: "S3" | "Azure",
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  try {
    return await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      throw new Error(`${provider} request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
  }
}
