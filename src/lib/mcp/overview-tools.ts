import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildOverviewMarkdown } from "@/lib/mcp/overview";
import { runTextTool } from "@/lib/mcp/tool-results";

export function registerOverviewTools(server: McpServer): void {
  server.registerTool(
    "get_lab_overview",
    {
      title: "Get lab overview",
      description:
        "Markdown snapshot of the whole lab: instance name, entity counts, every host with its VMs/containers and power state, networks (VLAN/CIDR/purpose) and integration health. Call this first to orient yourself; then use search/get_entity for specifics.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (extra) => runTextTool("read", extra, () => buildOverviewMarkdown()),
  );
}
