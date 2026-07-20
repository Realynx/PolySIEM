import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { createIntegrationSchema } from "@/lib/validators/integrations";
import { createIntegration, getIntegration, listIntegrations } from "@/lib/services/integrations";
import { getDriver } from "@/lib/integrations";
import type { DriverConfig, TestResult } from "@/lib/integrations/types";
import { toJsonSafe } from "@/lib/serialize";
import { refreshElasticsearchSourceDiscovery } from "@/lib/services/elasticsearch-discovery";
import { runSync } from "@/lib/integrations/engine";

export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(toJsonSafe(await listIntegrations()));
});

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const input = createIntegrationSchema.parse(await req.json());

  // Probe the target first so the caller immediately sees whether the
  // credentials work — but save regardless (misconfigured targets can be
  // fixed later without re-entering everything).
  const probeCfg: DriverConfig = {
    id: "unsaved",
    type: input.type,
    name: input.name,
    baseUrl: input.baseUrl,
    credentials: input.credentials as Record<string, string>,
    verifyTls: input.verifyTls,
    settings: ("settings" in input ? input.settings ?? {} : {}) as Record<string, unknown>,
  };
  let test: TestResult;
  if (input.type === "EDGE_NAT_SERVER") {
    test = {
      ok: false,
      detail: "SSH key generated. Run the restricted enrollment script on the edge server, then scan and confirm its host-key fingerprint.",
    };
  } else {
    try {
      test = await getDriver(input.type).testConnection(probeCfg);
    } catch (err) {
      test = { ok: false, detail: err instanceof Error ? err.message : String(err) };
    }
  }

  let integration = await createIntegration({ type: "user", userId: session.user.id }, input);
  if (input.type === "ELASTICSEARCH" && test.ok) {
    try {
      const discovery = await refreshElasticsearchSourceDiscovery(integration.id);
      if (discovery) {
        const labels = discovery.knownSources.map((source) => source.label);
        const routeCount = discovery.cloudflaredRoutes.length;
        const discovered = [
          labels.length > 0 ? `recognized ${labels.join(", ")}` : "no known log families recognized yet",
          routeCount > 0 ? `${routeCount} Cloudflared hostname${routeCount === 1 ? "" : "s"}` : null,
        ].filter(Boolean).join("; ");
        test.detail = `${test.detail} — source discovery: ${discovered}`;
        integration = await getIntegration(integration.id);
      }
    } catch (err) {
      test.detail = `${test.detail} — source discovery could not finish: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  if ((input.type === "CLOUDFLARE" || input.type === "TAILSCALE" || input.type === "UNIFI") && test.ok) {
    const { runId } = await runSync(integration.id, "manual", {
      type: "user",
      userId: session.user.id,
    });
    integration = await getIntegration(integration.id);
    test.detail = `${test.detail} — inventory and network evidence synced (run ${runId})`;
  }
  return jsonOk({ integration: toJsonSafe(integration), test }, { status: 201 });
});
