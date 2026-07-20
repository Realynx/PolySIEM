import "server-only";
import { prisma } from "@/lib/db";
import { cloudflareSettingsSchema } from "@/lib/validators/integrations";
import type { CloudflareAccountSnapshot } from "@/lib/integrations/cloudflare/types";

/** Read all enabled, persisted Cloudflare accounts without touching credentials. */
export async function listStoredCloudflareSnapshots(): Promise<CloudflareAccountSnapshot[]> {
  const rows = await prisma.integrationConfig.findMany({
    where: { type: "CLOUDFLARE", enabled: true },
    orderBy: { name: "asc" },
    select: { settings: true },
  });
  return rows.flatMap((row) => {
    const parsed = cloudflareSettingsSchema.safeParse(row.settings ?? {});
    return parsed.success && parsed.data.syncedSnapshot
      ? [parsed.data.syncedSnapshot as CloudflareAccountSnapshot]
      : [];
  });
}
