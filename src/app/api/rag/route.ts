import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { EmbedError } from "@/lib/rag/embed";
import { ragSearch } from "@/lib/rag/search";
import type { RagSourceType } from "@/lib/rag/index";

export const dynamic = "force-dynamic";

const SOURCE_TYPES: RagSourceType[] = ["doc", "device", "vm", "container", "network", "service"];

/**
 * GET /api/rag?q=&limit=&types=
 * Cosine-similarity RAG search over the stored embeddings. Returns ranked
 * chunks with their source, snippet, similarity score, and dashboard link.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const params = req.nextUrl.searchParams;
  const q = (params.get("q") ?? "").trim();
  if (!q) throw new ApiError(400, "missing_query", "Provide a search query with ?q=");

  const limitRaw = Number(params.get("limit") ?? "10");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), 50) : 10;

  const typesParam = params.get("types");
  const sourceTypes = typesParam
    ? typesParam
        .split(",")
        .map((t) => t.trim())
        .filter((t): t is RagSourceType => (SOURCE_TYPES as string[]).includes(t))
    : undefined;

  try {
    const { query, model, mock, results } = await ragSearch(q, { limit, sourceTypes });
    return jsonOk({ query, model, mock, results });
  } catch (err) {
    if (err instanceof EmbedError) {
      throw new ApiError(502, "embedding_unavailable", err.message);
    }
    throw err;
  }
});
