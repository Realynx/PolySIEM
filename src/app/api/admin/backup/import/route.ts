import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { decodeBackupFileAsync, prepareBackupForRestore, previewRestore, restoreArchive } from "@/lib/backup/import";
import { BackupLimitError } from "@/lib/backup/limits";
import { assertBackupFileSize, readBackupRequestBody } from "@/lib/backup/request-body";

interface UploadOptions {
  preview: boolean;
  confirm: boolean;
}

interface BackupUpload extends UploadOptions {
  buffer: Buffer;
  password?: string;
}

function initialUploadOptions(req: NextRequest): UploadOptions {
  const previewParam = new URL(req.url).searchParams.get("preview");
  return {
    preview: previewParam === "1" || previewParam === "true",
    confirm: req.headers.get("x-confirm-restore") === "true",
  };
}

async function parseMultipartUpload(
  req: NextRequest,
  requestBody: Buffer,
  contentType: string,
  options: UploadOptions,
): Promise<BackupUpload> {
  // Parse multipart only after the raw stream has passed the same hard byte
  // ceiling as direct uploads. Calling req.formData() first would allow a
  // chunked request to grow without a trustworthy Content-Length header.
  const boundedRequest = new Request(req.url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(requestBody),
  });
  let form: FormData;
  try {
    form = await boundedRequest.formData();
  } catch {
    throw new ApiError(400, "invalid_request", "The multipart backup upload is malformed.");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new ApiError(400, "invalid_request", "Expected a backup file in the 'file' form field.");
  }
  assertBackupFileSize(file.size);

  const confirmField = form.get("confirm");
  const passwordField = form.get("password");
  return {
    buffer: Buffer.from(await file.arrayBuffer()),
    preview: options.preview || form.get("mode") === "preview",
    confirm: options.confirm || confirmField === "true" || confirmField === "1",
    password: typeof passwordField === "string" && passwordField.length > 0 ? passwordField : undefined,
  };
}

async function readBackupUpload(req: NextRequest): Promise<BackupUpload> {
  const options = initialUploadOptions(req);
  const requestBody = await readBackupRequestBody(req);
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return parseMultipartUpload(req, requestBody, contentType, options);
  }
  return { buffer: requestBody, ...options };
}

async function decodeRestoreInput(buffer: Buffer, password?: string) {
  try {
    const decoded = await decodeBackupFileAsync(buffer, password);
    return { decoded, archive: prepareBackupForRestore(decoded) };
  } catch (err) {
    if (err instanceof BackupLimitError) {
      throw new ApiError(413, "backup_too_large", err.message);
    }
    throw new ApiError(400, "invalid_backup", err instanceof Error ? err.message : "Invalid backup file.");
  }
}

/**
 * POST /api/admin/backup/import — restore this PolySIEM instance from a backup
 * file. Admin-only and destructive: a real restore WIPES and replaces every
 * table. Accepts the archive either as multipart/form-data (a `file` field) or
 * as a raw gzip request body.
 *
 * Safety model:
 *   - `?preview=1` (or a `mode=preview` form field) returns the RestoreSummary
 *     WITHOUT writing anything — this is how the UI shows what would happen.
 *   - An actual restore additionally requires explicit confirmation
 *     (header `x-confirm-restore: true`, or a `confirm=true` form field);
 *     without it we refuse with 400 rather than silently destroying data.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const upload = await readBackupUpload(req);
  if (upload.buffer.byteLength === 0) {
    throw new ApiError(400, "invalid_request", "No backup file was provided.");
  }

  // Decode errors are translated here so operators get an actionable 4xx
  // instead of a generic server error for corrupt or incompatible archives.
  const { decoded, archive } = await decodeRestoreInput(upload.buffer, upload.password);
  if (upload.preview) {
    return jsonOk(previewRestore(archive, decoded.passwordProtected));
  }
  if (!upload.confirm) {
    throw new ApiError(
      400,
      "confirm_required",
      "Restore is destructive and REPLACES all existing data. Resend with the 'x-confirm-restore: true' header (or confirm=true) to proceed.",
    );
  }

  const summary = await restoreArchive({ type: "user", userId: user.id }, archive, decoded.passwordProtected);
  return jsonOk(summary);
});
