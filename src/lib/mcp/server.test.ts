import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MCP_SERVER_INSTRUCTIONS, registerPolySIEMServer } from "@/lib/mcp/server";

const READ_TOOLS = [
  "get_lab_overview",
  "search",
  "get_entity",
  "list_inventory",
  "list_network",
  "list_firewall",
  "list_edge",
  "list_ssh_keys",
  "list_docs",
  "check_access",
  "get_topology",
  "get_exposure",
  "get_security_score",
  "list_security_tickets",
  "investigate_ip",
  "check_threat_intel",
  "lookup_external_intel",
  "summarize_log_activity",
  "list_log_fields",
  "search_logs",
  "get_bandwidth",
  "get_integration_status",
];

const WRITE_TOOLS = [
  "write_doc",
  "create_entity",
  "update_entity_docs",
  "set_annotation",
  "add_note",
  "tag_entity",
  "save_security_ticket",
  "trigger_sync",
  "list_workflows",
  "get_workflow_catalog",
  "save_workflow",
  "validate_workflow",
  "run_workflow",
  "list_ai_credentials",
  "get_ai_credential",
];

async function connectedClient() {
  const server = new McpServer({ name: "polysiem-test", version: "0.0.0" }, { instructions: MCP_SERVER_INSTRUCTIONS });
  registerPolySIEMServer(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientTransport);
  return client;
}

describe("PolySIEM MCP registration", () => {
  it("exposes the full tool catalogue with valid JSON schemas over a real MCP session", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toEqual([...READ_TOOLS, ...WRITE_TOOLS]);
    for (const tool of tools) {
      expect(tool.description?.length ?? 0, tool.name).toBeGreaterThan(60);
      expect(tool.inputSchema.type, tool.name).toBe("object");
    }
    const byName = new Map(tools.map((t) => [t.name, t]));
    for (const name of READ_TOOLS) expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(true);
    for (const name of ["write_doc", "add_note", "save_security_ticket", "save_workflow", "run_workflow", "trigger_sync"]) {
      expect(byName.get(name)?.annotations?.readOnlyHint, name).toBe(false);
    }
    expect(byName.get("list_inventory")?.inputSchema.required).toEqual(["type"]);
    expect(Object.keys(byName.get("list_inventory")?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["cursor", "limit", "detail"]),
    );
  });

  it("never exposes infrastructure-control tools", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.name).not.toMatch(/start|stop|reboot|shutdown|apply|push|exec|ssh_command|delete/);
    }
  });

  it("serves resources, resource templates and prompts", async () => {
    const client = await connectedClient();
    const { resourceTemplates } = await client.listResourceTemplates();
    expect(resourceTemplates.map((t) => t.uriTemplate).sort()).toEqual(["polysiem://docs/{slug}", "polysiem://entity/{type}/{id}"]);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toEqual(["security_review", "investigate_ip", "document_host"]);
    const prompt = await client.getPrompt({ name: "investigate_ip", arguments: { ip: "203.0.113.9" } });
    const first = prompt.messages[0].content;
    expect(first.type === "text" ? first.text : "").toContain("investigate_ip ip=203.0.113.9");
  });

  it("requires the read scope for resources", async () => {
    const client = await connectedClient();
    await expect(client.readResource({ uri: "polysiem://overview" })).rejects.toThrow(/Missing authentication/);
  });
});
