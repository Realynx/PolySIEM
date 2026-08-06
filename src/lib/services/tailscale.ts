import "server-only";
import { prisma } from "@/lib/db";
import { tailscaleSettingsSchema, type TailscaleSnapshot } from "@/lib/validators/integrations";
import { assertDatasetBudget } from "@/lib/dataset-budget";

export async function listStoredTailscaleSnapshots(limit = 100): Promise<TailscaleSnapshot[]> {
  const rows = await prisma.integrationConfig.findMany({
    where: { type: "TAILSCALE", enabled: true },
    orderBy: { name: "asc" },
    select: { settings: true },
    take: limit + 1,
  });
  assertDatasetBudget("Enabled Tailscale integrations", rows, limit);
  return rows.flatMap((row) => {
    const parsed = tailscaleSettingsSchema.safeParse(row.settings ?? {});
    return parsed.success && parsed.data.syncedSnapshot ? [parsed.data.syncedSnapshot] : [];
  });
}
