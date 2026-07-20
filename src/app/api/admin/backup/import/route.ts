import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { decodeArchive, previewRestore, restoreArchive } from "@/lib/backup/import";

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

  const previewParam = new URL(req.url).searchParams.get("preview");
  let preview = previewParam === "1" || previewParam === "true";
  let confirm = req.headers.get("x-confirm-restore") === "true";

  let buffer: Buffer;
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new ApiError(400, "invalid_request", "Expected a backup file in the 'file' form field.");
    }
    buffer = Buffer.from(await file.arrayBuffer());
    if (form.get("mode") === "preview") preview = true;
    const confirmField = form.get("confirm");
    if (confirmField === "true" || confirmField === "1") confirm = true;
  } else {
    buffer = Buffer.from(await req.arrayBuffer());
  }

  if (buffer.byteLength === 0) {
    throw new ApiError(400, "invalid_request", "No backup file was provided.");
  }

  // decodeArchive throws plain, actionable Errors (bad gzip, unsupported
  // version, unknown model). Surface those to the client as a 400 rather than
  // letting handleApi mask them behind a generic 500 — the operator needs to
  // know exactly why their file was rejected.
  let archive;
  try {
    archive = decodeArchive(buffer);
  } catch (err) {
    throw new ApiError(400, "invalid_backup", err instanceof Error ? err.message : "Invalid backup file.");
  }

  if (preview) {
    return jsonOk(previewRestore(archive));
  }

  if (!confirm) {
    throw new ApiError(
      400,
      "confirm_required",
      "Restore is destructive and REPLACES all existing data. Resend with the 'x-confirm-restore: true' header (or confirm=true) to proceed.",
    );
  }

  const summary = await restoreArchive({ type: "user", userId: user.id }, archive);
  return jsonOk(summary);
});
