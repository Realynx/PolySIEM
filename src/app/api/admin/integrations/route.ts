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

type CreateInput = ReturnType<typeof createIntegrationSchema.parse>;

async function probeIntegration(input: CreateInput): Promise<TestResult> {
  if (input.type === "EDGE_NAT_SERVER") {
    return {
      ok: false,
      detail: "SSH key generated. Open Edge Networks to authorize one setup connection, confirm the host identity, and let PolySIEM install the restricted service.",
    };
  }
  const cfg: DriverConfig = {
    id: "unsaved", type: input.type, name: input.name, baseUrl: input.baseUrl,
    credentials: input.credentials as Record<string, string>, verifyTls: input.verifyTls,
    settings: ("settings" in input ? input.settings ?? {} : {}) as Record<string, unknown>,
  };
  try {
    return await getDriver(input.type).testConnection(cfg);
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

async function addElasticDiscovery(id: string, test: TestResult): Promise<void> {
  try {
    const discovery = await refreshElasticsearchSourceDiscovery(id);
    if (!discovery) return;
    const labels = discovery.knownSources.map((source) => source.label);
    const routeCount = discovery.cloudflaredRoutes.length;
    const discovered = [
      labels.length > 0 ? `recognized ${labels.join(", ")}` : "no known log families recognized yet",
      routeCount > 0 ? `${routeCount} Cloudflared hostname${routeCount === 1 ? "" : "s"}` : null,
    ].filter(Boolean).join("; ");
    test.detail = `${test.detail} — source discovery: ${discovered}`;
  } catch (error) {
    test.detail = `${test.detail} — source discovery could not finish: ${error instanceof Error ? error.message : String(error)}`;
  }
}

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
  const test = await probeIntegration(input);

  let integration = await createIntegration({ type: "user", userId: session.user.id }, input);
  if (input.type === "ELASTICSEARCH" && test.ok) {
    await addElasticDiscovery(integration.id, test);
    integration = await getIntegration(integration.id);
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
