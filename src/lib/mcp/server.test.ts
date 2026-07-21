import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPolySIEMServer } from "@/lib/mcp/server";

describe("PolySIEM MCP registration", () => {
  it("registers the stable resource and tool catalog in order", () => {
    const tools: string[] = [];
    const resources: string[] = [];
    const server = {
      registerTool(name: string) {
        tools.push(name);
      },
      registerResource(name: string) {
        resources.push(name);
      },
    } as unknown as McpServer;

    registerPolySIEMServer(server);

    expect(resources).toEqual(["overview"]);
    expect(tools).toEqual([
      "get_lab_overview",
      "censys_lookup_host",
      "securitytrails_lookup",
      "search_inventory",
      "rag_search",
      "list_devices",
      "get_device",
      "list_ssh_keys",
      "list_vms",
      "get_vm",
      "list_containers",
      "get_container",
      "list_networks",
      "get_network",
      "list_services",
      "list_storage_pools",
      "get_firewall_rules",
      "get_dhcp_leases",
      "list_docs",
      "get_doc",
      "get_integration_status",
      "get_sync_run",
      "create_doc",
      "update_doc",
      "create_entity",
      "update_entity_docs",
      "set_firewall_annotation",
      "add_tag",
      "trigger_sync",
      "list_workflows",
      "get_workflow",
      "get_workflow_catalog",
      "create_workflow",
      "update_workflow",
      "validate_workflow",
      "run_workflow",
      "list_ai_credentials",
      "get_ai_credential",
    ]);
  });
});
