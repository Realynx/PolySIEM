import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getRandomBashQuote } from "@/lib/bash-quotes";

export const dynamic = "force-dynamic";

/** GET /api/about/bash-quote — a random bash.org quote for the About terminal. */
export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await getRandomBashQuote());
});
