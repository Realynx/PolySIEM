import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { runTool as run } from "@/lib/mcp/tool-results";
import { triggerIntegrationSyncs } from "@/lib/services/integration-sync";

const readOnly = { readOnlyHint: true } as const;
const INTEGRATION_STATUS_SELECT = {
  id: true,
  type: true,
  name: true,
  enabled: true,
  lastSyncAt: true,
  lastSyncStatus: true,
  lastSyncError: true,
} as const;

export function registerIntegrationReadTools(server: McpServer): void {
  server.registerTool(
    "get_integration_status",
    {
      title: "Get integration status",
      description:
        "Health of configured integrations (Proxmox/OPNsense/Elasticsearch): enabled flag, last sync time, last sync status, and last error. Never exposes credentials.",
      annotations: readOnly,
    },
    async (extra) =>
      run("read", extra, () =>
        prisma.integrationConfig.findMany({ orderBy: { name: "asc" }, select: INTEGRATION_STATUS_SELECT }),
      ),
  );

  server.registerTool(
    "get_sync_run",
    {
      title: "Get sync run",
      description:
        "One sync run by id: status (RUNNING/SUCCESS/PARTIAL/FAILED), trigger, timing, per-entity stats, and error. Use after trigger_sync to check progress.",
      inputSchema: { runId: z.string().min(1).describe("SyncRun id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      run("read", extra, async () => {
        const runRecord = await prisma.syncRun.findUnique({
          where: { id: args.runId },
          include: { integration: { select: { id: true, name: true, type: true } } },
        });
        if (!runRecord) throw new ApiError(404, "not_found", "Sync run not found");
        return runRecord;
      }),
  );
}

export function registerIntegrationSyncTools(server: McpServer): void {
  server.registerTool(
    "trigger_sync",
    {
      title: "Trigger integration sync",
      description:
        "Trigger a read-only inventory sync from remote systems into PolySIEM. Live-query integrations such as Elasticsearch, OTX, Censys, and SecurityTrails have no sync run.",
      inputSchema: {
        integrationId: z.string().min(1).optional().describe("Integration id (omit to sync all enabled)"),
      },
    },
    async (args, extra) =>
      run("trigger_sync", extra, () => triggerIntegrationSyncs(args.integrationId, "mcp")),
  );
}
