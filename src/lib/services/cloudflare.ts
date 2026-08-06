import "server-only";
import { prisma } from "@/lib/db";
import { cloudflareSettingsSchema } from "@/lib/validators/integrations";
import type { CloudflareAccountSnapshot } from "@/lib/integrations/cloudflare/types";
import { assertDatasetBudget } from "@/lib/dataset-budget";

/** Read a bounded set of enabled, persisted Cloudflare accounts without touching credentials. */
export async function listStoredCloudflareSnapshots(limit = 100): Promise<CloudflareAccountSnapshot[]> {
  const rows = await prisma.integrationConfig.findMany({
    where: { type: "CLOUDFLARE", enabled: true },
    orderBy: { name: "asc" },
    select: { settings: true },
    take: limit + 1,
  });
  assertDatasetBudget("Enabled Cloudflare integrations", rows, limit);
  return rows.flatMap((row) => {
    const parsed = cloudflareSettingsSchema.safeParse(row.settings ?? {});
    return parsed.success && parsed.data.syncedSnapshot
      ? [parsed.data.syncedSnapshot as CloudflareAccountSnapshot]
      : [];
  });
}
