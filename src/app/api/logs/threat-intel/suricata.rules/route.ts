import { NextResponse, type NextRequest } from "next/server";
import { ApiError, handleApi } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { requireScope, validateApiToken } from "@/lib/auth/api-token";
import { getSuricataRuleset } from "@/lib/services/threat-intel";

export const dynamic = "force-dynamic";

/**
 * Auth for machine subscribers (OPNsense's rule downloader can't log in):
 * a `ps_` API token with the "read" scope, via Authorization: Bearer or the
 * `?token=` query param. A logged-in session also works, for browser preview.
 */
async function requireFeedAccess(req: NextRequest): Promise<void> {
  const queryToken = req.nextUrl.searchParams.get("token")?.trim();
  const bearer = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const raw = queryToken || bearer;
  if (raw) {
    const record = await validateApiToken(raw);
    if (!record) throw new ApiError(401, "unauthorized", "Invalid or expired API token");
    requireScope(record, "read");
    return;
  }
  await requireUser();
}

/**
 * GET /api/logs/threat-intel/suricata.rules — Suricata ruleset generated from
 * the OTX feed's freshest IOCs. Point OPNsense's Intrusion Detection at this
 * URL as a custom ruleset; re-downloads pick up feed changes.
 */
export const GET = handleApi(async (req: NextRequest) => {
  await requireFeedAccess(req);
  const integrationId = req.nextUrl.searchParams.get("integrationId") ?? undefined;
  const ruleset = await getSuricataRuleset(integrationId);
  return new NextResponse(ruleset.text, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'inline; filename="polysiem-otx.rules"',
      "Cache-Control": "no-store",
      "X-PolySIEM-Rules": `ip=${ruleset.ipRuleCount};dns=${ruleset.dnsRuleCount};ips=${ruleset.ipCount};domains=${ruleset.domainCount};pulses=${ruleset.pulseCount}`,
    },
  });
});
