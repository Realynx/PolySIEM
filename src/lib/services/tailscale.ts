import "server-only";
import { prisma } from "@/lib/db";
import { tailscaleSettingsSchema, type TailscaleSnapshot } from "@/lib/validators/integrations";

export async function listStoredTailscaleSnapshots(): Promise<TailscaleSnapshot[]> {
  const rows = await prisma.integrationConfig.findMany({
    where: { type: "TAILSCALE", enabled: true },
    orderBy: { name: "asc" },
    select: { settings: true },
  });
  return rows.flatMap((row) => {
    const parsed = tailscaleSettingsSchema.safeParse(row.settings ?? {});
    return parsed.success && parsed.data.syncedSnapshot ? [parsed.data.syncedSnapshot] : [];
  });
}
