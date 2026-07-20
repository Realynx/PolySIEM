import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { bandwidthReport } from "@/lib/services/bandwidth";

export const dynamic = "force-dynamic";

function parseWindow(raw: string | null): "1h" | "6h" | "24h" {
  return raw === "1h" || raw === "6h" || raw === "24h" ? raw : "24h";
}

/**
 * GET /api/bandwidth?window=1h|6h|24h — delta-polled firewall bandwidth:
 * per-rule byte totals/rates (externalId joins FirewallRule.externalId; the
 * "system" row aggregates unlabeled pf rules) and per-interface in/out rates
 * (key joins Network.externalId). All rates are bits per second. `status`
 * reports whether polling is enabled and any privileges the OPNsense API user
 * is missing. Never fails hard when polling is off — returns empty series.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const window = parseWindow(req.nextUrl.searchParams.get("window"));
  const integrationId = req.nextUrl.searchParams.get("integrationId");
  return jsonOk(toJsonSafe(await bandwidthReport(window, new Date(), integrationId)));
});
