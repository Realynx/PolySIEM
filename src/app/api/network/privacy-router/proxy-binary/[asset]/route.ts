import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { PRIVACY_PROXY_ASSET_BASENAME } from "@/lib/integrations/privacy-router/proxy";
import { authorizePrivacyProxyDownload, servePrivacyProxyBinary } from "@/lib/services/privacy-router";

/**
 * The statically linked musl SNI proxy, as built into this image.
 *
 * This is the ONE download route, and it is exactly the URL
 * `privacyProxyDownloadUrl()` bakes into every canonical ruleset: path and filename
 * both come from the constants in `integrations/privacy-router/proxy.ts`, so a
 * router asks for precisely the artefact PolySIEM told it to ask for and there
 * is no second path that could serve different bytes.
 *
 * Two ways in, one artefact:
 *  - a router presents the `Authorization` header PolySIEM put on the unhashed
 *    `PROXYAUTH` line of its APPLY payload;
 *  - a signed-in user fetches it from the browser.
 *
 * The credential only keeps the artefact off the open LAN. INTEGRITY does not
 * rest on it: the sha256 in the canonical ruleset is the trust anchor, computed
 * from these very bytes, and the agent verifies it before installing anything.
 *
 * `?meta=1` answers with the digest instead of the bytes, which is what the
 * Setup walkthrough shows so an operator can compare it by hand.
 *
 * A build with no binary — a plain `npm run dev`, which never runs the Docker
 * build — answers 503 with the `cargo build` command that fixes it. Never a bare
 * 500, and never a silent skip that would leave a router with no proxy.
 */
type Ctx = { params: Promise<{ asset: string }> };

export const GET = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { asset } = await ctx.params;
  if (asset !== PRIVACY_PROXY_ASSET_BASENAME) {
    throw new ApiError(404, "not_found", `Unknown VPN proxy artefact "${String(asset).slice(0, 64)}"`);
  }
  if (!(await authorizePrivacyProxyDownload(req.headers.get("authorization")))) await requireUser();

  const artifact = await servePrivacyProxyBinary();
  if (new URL(req.url).searchParams.get("meta") === "1") {
    return jsonOk({ filename: PRIVACY_PROXY_ASSET_BASENAME, sha256: artifact.sha256, size: artifact.bytes.byteLength });
  }
  return new Response(new Uint8Array(artifact.bytes), {
    headers: {
      "content-type": "application/octet-stream",
      "content-length": String(artifact.bytes.byteLength),
      "content-disposition": `attachment; filename="${PRIVACY_PROXY_ASSET_BASENAME}"`,
      // The digest is served beside the bytes so a caller that is not the agent
      // can still verify what it got without a second request.
      "x-polysiem-sha256": artifact.sha256,
      "cache-control": "no-store",
    },
  });
});
