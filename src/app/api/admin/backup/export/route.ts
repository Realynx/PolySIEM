import { handleApi } from "@/lib/api";
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
