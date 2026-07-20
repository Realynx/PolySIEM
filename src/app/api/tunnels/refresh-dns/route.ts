import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { refreshTunnelDns } from "@/lib/services/tunnel-dns";

export const dynamic = "force-dynamic";

/**
 * POST /api/tunnels/refresh-dns — resolve every tunnel ingress hostname (and
 * dynamic-DNS name) against public DNS and persist which edge fronts each one.
 * Admin-only; audited. Reports any hostname resolving straight to the WAN.
 */
export const POST = handleApi(async () => {
  const { user } = await requireAdmin();
  const result = await refreshTunnelDns();
  await audit({ type: "user", userId: user.id }, "tunnel.refresh_dns", undefined, {
    tunnelHostnames: result.tunnelHostnames,
    dyndnsHostnames: result.dyndnsHostnames,
    exposed: result.exposed,
    errors: result.errors,
  });
  return jsonOk(result);
});
