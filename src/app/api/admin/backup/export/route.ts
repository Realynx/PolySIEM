import type { NextRequest } from "next/server";
import { ApiError, handleApi } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { buildBackupFile } from "@/lib/backup/export";

/**
 * GET /api/admin/backup/export — download a full logical backup of this PolySIEM
 * instance as a single gzipped-JSON file. Admin-only: the archive contains every
 * table verbatim, including encrypted secret columns. Streamed back as a file
 * attachment; the download itself is audited (metadata only, never contents).
 */
export const GET = handleApi(async () => {
  const { user } = await requireAdmin();

  const { buffer, filename, sizeBytes } = await buildBackupFile();

  await audit({ type: "user", userId: user.id }, "backup.export", undefined, { filename, sizeBytes });

  // Copy into a plain Uint8Array so the body satisfies BodyInit (an
  // ArrayBuffer-backed view, not the ArrayBufferLike a raw Buffer exposes).
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/gzip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(sizeBytes),
      "Cache-Control": "no-store",
    },
  });
});

/** POST with `{ password }` creates a portable, password-encrypted backup. */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    throw new ApiError(400, "invalid_request", "Expected a JSON body containing a backup password.");
  }
  if (typeof body.password !== "string" || body.password.length < 8 || body.password.length > 1024) {
    throw new ApiError(400, "invalid_password", "Backup password must be between 8 and 1024 characters.");
  }

  const { buffer, filename, sizeBytes } = await buildBackupFile(body.password);
  await audit({ type: "user", userId: user.id }, "backup.export", undefined, {
    filename,
    sizeBytes,
    passwordProtected: true,
  });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.polysiem.backup",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(sizeBytes),
      "Cache-Control": "no-store",
    },
  });
});
