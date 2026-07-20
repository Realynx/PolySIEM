import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { EmbedError } from "@/lib/rag/embed";
import { reindexAll } from "@/lib/rag/index";

export const dynamic = "force-dynamic";

/**
 * POST /api/rag/reindex (admin) — rebuild the embedding index for every doc and
 * inventory entity, pruning chunks whose source is gone or whose model changed.
 * Synchronous: returns the counts once the backfill completes.
 */
export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  try {
    const stats = await reindexAll();
    await audit({ type: "user", userId: user.id }, "rag.reindex", undefined, { ...stats });
    return jsonOk(stats);
  } catch (err) {
    if (err instanceof EmbedError) {
      throw new ApiError(502, "embedding_unavailable", err.message);
    }
    throw err;
  }
});
