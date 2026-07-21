import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerCredentialTools } from "@/lib/mcp/credential-tools";
import {
  registerDocumentationReadTools,
  registerDocumentationWriteTools,
  registerTagTools,
} from "@/lib/mcp/documentation-tools";
import {
  registerIntegrationReadTools,
  registerIntegrationSyncTools,
} from "@/lib/mcp/integration-tools";
import { registerInventoryReadTools } from "@/lib/mcp/inventory-read-tools";
import { registerInventoryWriteTools } from "@/lib/mcp/inventory-write-tools";
import { registerOverviewTools } from "@/lib/mcp/overview-tools";
import { registerWorkflowTools } from "@/lib/mcp/workflow-tools";

/** Stable assembly facade for the complete PolySIEM MCP catalog. */
export function registerPolySIEMServer(server: McpServer): void {
  registerOverviewTools(server);
  registerInventoryReadTools(server);
  registerDocumentationReadTools(server);
  registerIntegrationReadTools(server);
  registerDocumentationWriteTools(server);
  registerInventoryWriteTools(server);
  registerTagTools(server);
  registerIntegrationSyncTools(server);
  registerWorkflowTools(server);
  registerCredentialTools(server);
}
