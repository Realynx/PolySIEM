import "server-only";

import type { NextRequest } from "next/server";
import { ApiError } from "@/lib/api";
import { BACKUP_IMPORT_LIMITS, formatMiB } from "./limits";

function tooLarge(): ApiError {
  return new ApiError(
    413,
    "backup_too_large",
    `Backup uploads are limited to ${formatMiB(BACKUP_IMPORT_LIMITS.uploadBytes)}.`,
  );
}

function requestByteLimit(req: NextRequest): number {
  const contentType = req.headers.get("content-type") ?? "";
  return contentType.includes("multipart/form-data")
    ? BACKUP_IMPORT_LIMITS.requestBytes
    : BACKUP_IMPORT_LIMITS.uploadBytes;
}

export function assertBackupContentLength(req: NextRequest): void {
  const raw = req.headers.get("content-length");
  if (!raw) return;
  const length = Number(raw);
  if (Number.isFinite(length) && length > requestByteLimit(req)) throw tooLarge();
}

/** Read a raw request incrementally and stop before it can exceed the upload ceiling. */
export async function readBackupRequestBody(req: NextRequest): Promise<Buffer> {
  assertBackupContentLength(req);
  if (!req.body) return Buffer.alloc(0);

  const limit = requestByteLimit(req);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel("backup upload limit exceeded").catch(() => {});
        throw tooLarge();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export function assertBackupFileSize(size: number): void {
  if (size > BACKUP_IMPORT_LIMITS.uploadBytes) throw tooLarge();
}
