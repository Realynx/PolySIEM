import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getIntegrationHealth } from "@/lib/ai/agent/assistant-read";
import { triggerIntegrationSyncs } from "@/lib/services/integration-sync";
import { getEntityDetail } from "@/lib/mcp/entity-detail";
import { runTool } from "@/lib/mcp/tool-results";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

export function registerIntegrationReadTools(server: McpServer): void {
  server.registerTool(
    "get_integration_status",
    {
      title: "Get integration and sync status",
      description:
        "Health of every configured integration (Proxmox, OPNsense, UniFi, Elasticsearch, Cloudflare, Tailscale, Edge NAT, OTX, Censys, SecurityTrails): enabled flag, last sync time/status and a sanitized last error. Pass integrationId for host and the 5 most recent sync runs, or runId to check one sync run (e.g. after trigger_sync). Never returns URLs with credentials, settings or secrets.",
      inputSchema: {
        integrationId: z.string().trim().min(1).max(128).optional().describe("One integration's detail"),
        runId: z.string().trim().min(1).max(128).optional().describe("One sync run's status, stats and error"),
      },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        if (args.runId) return getEntityDetail("sync_run", args.runId, "full");
        if (args.integrationId) return getEntityDetail("integration", args.integrationId, "full");
        return { integrations: await getIntegrationHealth() };
      }),
  );
}

export function registerIntegrationSyncTools(server: McpServer): void {
  server.registerTool(
    "trigger_sync",
    {
      title: "Trigger integration sync",
      description:
        "Start a read-only inventory pull from Proxmox/OPNsense/UniFi/Cloudflare/Tailscale/Edge into PolySIEM (one integration, or all enabled ones). Returns run ids; poll get_integration_status with runId. Live-query integrations (Elasticsearch, OTX, Censys, SecurityTrails) have no sync. Never changes the remote systems.",
      inputSchema: {
        integrationId: z.string().trim().min(1).optional().describe("Integration id (omit to sync all enabled)"),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async (args, extra) => runTool("trigger_sync", extra, () => triggerIntegrationSyncs(args.integrationId, "mcp")),
  );
}
