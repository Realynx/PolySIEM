import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { getIntegrationRow } from "@/lib/services/integrations";
import { getDriver, toDriverConfig } from "@/lib/integrations";
import type { TestResult } from "@/lib/integrations/types";
import { refreshElasticsearchSourceDiscovery } from "@/lib/services/elasticsearch-discovery";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireAdmin();
  const { id } = await ctx.params;
  const row = await getIntegrationRow(id);
  let test: TestResult;
  try {
    test = await getDriver(row.type).testConnection(toDriverConfig(row));
  } catch (err) {
    test = { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
  if (row.type === "ELASTICSEARCH" && test.ok) {
    try {
      const discovery = await refreshElasticsearchSourceDiscovery(row.id);
      if (discovery) {
        const labels = discovery.knownSources.map((source) => source.label);
        const routeCount = discovery.cloudflaredRoutes.length;
        const summary = [
          labels.length > 0 ? `recognized ${labels.join(", ")}` : "no known log families recognized yet",
          routeCount > 0 ? `${routeCount} Cloudflared hostname${routeCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean).join("; ");
        test.detail = `${test.detail} — source discovery: ${summary}`;
      }
    } catch (err) {
      test.detail = `${test.detail} — source discovery could not finish: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  return jsonOk(test);
});
