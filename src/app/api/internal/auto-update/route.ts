import type { NextRequest } from "next/server";
import { getAutoUpdateConfig, isUpdateAgentAuthorized } from "@/lib/updates/auto-update";
import { checkForUpdate } from "@/lib/updates/release";

export const dynamic = "force-dynamic";

/** Machine-readable endpoint consumed only by the host-side update timer. */
export async function GET(req: NextRequest): Promise<Response> {
  if (!isUpdateAgentAuthorized(req.headers.get("authorization"))) {
    return new Response("unauthorized\n", {
      status: 401,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
    });
  }

  const config = await getAutoUpdateConfig();
  const lines = [
    `enabled=${config.enabled}`,
    `capable=${config.capable}`,
  ];
  if (config.enabled && config.capable) {
    const update = await checkForUpdate();
    lines.push(
      `updateAvailable=${update.updateAvailable}`,
      `currentVersion=${update.currentVersion}`,
      `latestVersion=${update.latestVersion}`,
    );
  }

  return new Response(`${lines.join("\n")}\n`, {
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" },
  });
}
