import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { tunnelTraffic } from "@/lib/services/tunnel-traffic";

export const dynamic = "force-dynamic";

/** Accept only a bounded relative window (e.g. 1h, 24h, 7d); default 24h. */
function parseWindow(raw: string | null): string {
  if (raw && /^\d{1,3}[hd]$/.test(raw)) return raw;
  return "24h";
}

/**
 * GET /api/tunnels/traffic?window=24h — live cloudflared traffic counts per
 * tunnel (and per ingress hostname when the shipper indexes it). Never fails
 * hard: an unavailable source returns `mode: "unavailable"` with a reason.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireUser();
  const window = parseWindow(req.nextUrl.searchParams.get("window"));
  return jsonOk(await tunnelTraffic(window));
});
