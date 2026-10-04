import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { toJsonSafe } from "@/lib/serialize";
import { parsePrivacyRouterTrafficWindow, privacyRouterTrafficReport } from "@/lib/services/privacy-router-traffic";

export const dynamic = "force-dynamic";

/**
 * GET /api/network/privacy-router/traffic?window=1h|6h|24h|30d|month[&routerId=…]
 *
 * Per-service traffic through the privacy router, keyed by the hostname the SNI
 * proxy observed (plus the literal `other` once the proxy's 512-entry cap is
 * hit, and `-` for a flow whose hostname was never readable). `1h|6h|24h` come
 * from the raw seven-day samples; `30d` and `month` come from the fold-forward
 * rollups, which is why `source` says which store answered.
 *
 * All rates are bits per second and average over the seconds actually observed.
 * A series point with `inBps`/`outBps` null is a measurement gap, never zero.
 * Never fails hard when nothing has been polled yet — it returns empty series.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const window = parsePrivacyRouterTrafficWindow(req.nextUrl.searchParams.get("window"));
  const routerId = req.nextUrl.searchParams.get("routerId");
  return jsonOk(toJsonSafe(await privacyRouterTrafficReport(window, new Date(), routerId)));
});
