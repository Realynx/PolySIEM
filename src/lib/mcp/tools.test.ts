import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Handler-level tests: tools are registered on a capturing fake server and
 * invoked the way the MCP transport invokes them (args + extra.authInfo),
 * against a Proxy prisma whose model methods default to "nothing found".
 */

const mocks = vi.hoisted(() => {
  type Fn = (...args: unknown[]) => unknown;
  const overrides = new Map<string, Fn>();
  const calls: Array<{ key: string; args: unknown[] }> = [];
  const empty = (method: string) => (method === "findMany" ? [] : method === "count" ? 0 : null);
  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, method: string) =>
              (...args: unknown[]) => {
                const key = `${model}.${method}`;
                calls.push({ key, args });
                const override = overrides.get(key);
                return Promise.resolve(override ? override(...args) : empty(method));
              },
          },
        ),
    },
  );
  return {
    prisma,
    overrides,
    calls,
    updateDevice: vi.fn(async (_actor: unknown, id: string, input: unknown) => ({ id, ...(input as object) })),
    getWorkflow: vi.fn(),
    executeWorkflow: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/services/inventory", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  updateDevice: mocks.updateDevice,
}));
vi.mock("@/lib/workflows/service", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getWorkflow: mocks.getWorkflow,
}));
vi.mock("@/lib/workflows/executor", () => ({ executeWorkflow: mocks.executeWorkflow }));

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { registerPolySIEMServer } from "@/lib/mcp/server";

type Handler = (...args: unknown[]) => Promise<CallToolResult>;
const handlers = new Map<string, { config: { inputSchema?: unknown }; handler: Handler }>();
registerPolySIEMServer({
  registerTool(name: string, config: { inputSchema?: unknown }, handler: Handler) {
    handlers.set(name, { config, handler });
  },
  registerResource() {},
  registerPrompt() {},
} as unknown as McpServer);

function extra(scopes: string[] = ["read", "write_docs", "trigger_sync"]) {
  return { authInfo: { token: "ps_test", clientId: "ps_te", scopes, extra: { userId: "u1", apiTokenId: "t1" } } };
}

async function call(name: string, args: Record<string, unknown> | null, scopes?: string[]) {
  const entry = handlers.get(name);
  if (!entry) throw new Error(`no tool ${name}`);
  const result = entry.config.inputSchema ? await entry.handler(args ?? {}, extra(scopes)) : await entry.handler(extra(scopes));
  const first = result.content[0];
  return { isError: result.isError === true, body: JSON.parse(first.type === "text" ? first.text : "null") };
}

beforeEach(() => {
  mocks.overrides.clear();
  mocks.calls.length = 0;
  vi.clearAllMocks();
});

describe("scope enforcement and errors", () => {
  it("returns an actionable forbidden error when the token lacks the scope", async () => {
    const { isError, body } = await call("list_inventory", { type: "device" }, ["write_docs"]);
    expect(isError).toBe(true);
    expect(body.error.code).toBe("forbidden");
    expect(body.error.message).toContain('"read" scope');
    expect(body.error.hint).toContain("Settings");
  });

  it("does not let a read-only token write", async () => {
    const { body } = await call("add_note", { type: "device", id: "d1", note: "x" }, ["read"]);
    expect(body.error.code).toBe("forbidden");
    expect(mocks.updateDevice).not.toHaveBeenCalled();
  });
});

describe("get_entity", () => {
  it("resolves a name across types and returns a compact, secret-free summary", async () => {
    mocks.overrides.set("device.findMany", (args) => {
      const where = (args as { where: { name: { equals?: string } } }).where;
      return where.name.equals === "nas" ? [{ id: "d1", name: "NAS", kind: "nas" }] : [];
    });
    mocks.overrides.set("device.findUnique", (args) =>
      (args as { where: { id: string } }).where.id === "d1"
        ? {
            id: "d1",
            name: "NAS",
            kind: "nas",
            description: "Storage box",
            interfaces: [{ name: "eth0", macAddress: "aa:bb", ip: { address: "10.0.3.5" }, network: { id: "n1", name: "Servers" } }],
            tags: [{ tag: { name: "storage" } }],
            _count: { vms: 0, containers: 2, services: 3 },
          }
        : null,
    );
    const { isError, body } = await call("get_entity", { ref: "nas" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({
      found: true,
      type: "device",
      id: "d1",
      href: "/inventory/hosts/d1",
      tags: ["storage"],
      interfaces: [{ nic: "eth0", ip: "10.0.3.5", network: "Servers" }],
      counts: { containers: 2 },
      linkedDocs: [],
    });
  });

  it("returns candidates when a name is ambiguous", async () => {
    // The proxy keys by Prisma accessor name (virtualMachine, container, ...).
    mocks.overrides.set("virtualMachine.findMany", () => [{ id: "v1", name: "web" }]);
    mocks.overrides.set("container.findMany", () => [{ id: "c1", name: "web" }]);
    const { body } = await call("get_entity", { ref: "web" });
    expect(body.found).toBe(false);
    expect(body.ambiguous).toBe(true);
    expect(body.candidates.map((c: { type: string }) => c.type).sort()).toEqual(["container", "vm"]);
  });

  it("reports not-found plainly", async () => {
    const { isError, body } = await call("get_entity", { ref: "ghost", type: "device" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ found: false });
  });
});

describe("list tools", () => {
  it("pages firewall rules with an opaque cursor", async () => {
    mocks.overrides.set("firewallRule.findMany", () => [{ id: "r1" }, { id: "r2" }, { id: "r3" }]);
    mocks.overrides.set("firewallRule.count", () => 9);
    const { body } = await call("list_firewall", { kind: "rules", limit: 2, interface: "lan" });
    expect(body.items).toEqual([{ id: "r1" }, { id: "r2" }]);
    expect(body.total).toBe(9);
    expect(typeof body.nextCursor).toBe("string");
    const findMany = mocks.calls.find((c) => c.key === "firewallRule.findMany");
    expect(findMany?.args[0]).toMatchObject({ skip: 0, take: 3, where: { interfaceName: "lan", status: { not: "REMOVED" } } });
  });

  it("rejects invalid cursors with guidance", async () => {
    const { isError, body } = await call("list_network", { kind: "arp", cursor: "bogus" });
    expect(isError).toBe(true);
    expect(body.error.code).toBe("invalid_cursor");
  });

  it("projects inventory rows to a brief summary by default", async () => {
    mocks.overrides.set("virtualMachine.findMany", () => [
      { id: "v1", name: "dns", powerState: "RUNNING", host: { id: "d1", name: "pve" }, description: "x", interfaces: [{ name: "net0", macAddress: null, ip: { address: "10.0.0.53" }, network: null }], tags: [] },
    ]);
    mocks.overrides.set("virtualMachine.count", () => 1);
    const { body } = await call("list_inventory", { type: "vm" });
    expect(body.items).toEqual([{ id: "v1", name: "dns", powerState: "RUNNING", host: { id: "d1", name: "pve" }, ips: ["10.0.0.53"] }]);
    expect(body.nextCursor).toBeNull();
  });
});

describe("writes", () => {
  it("add_note appends a dated note to the existing description", async () => {
    mocks.overrides.set("device.findUnique", () => ({ description: "Existing text" }));
    const { isError, body } = await call("add_note", { type: "device", id: "d1", note: "Moved to rack 2" });
    expect(isError).toBe(false);
    expect(body).toMatchObject({ type: "device", id: "d1", appended: true });
    const [, id, input] = mocks.updateDevice.mock.calls[0];
    expect(id).toBe("d1");
    expect((input as { description: string }).description).toMatch(/^Existing text\n\n\*\*Note \(\d{4}-\d{2}-\d{2}, via MCP\):\*\* Moved to rack 2$/);
  });

  it("run_workflow refuses workflows that touch infrastructure", async () => {
    mocks.getWorkflow.mockResolvedValue({
      id: "w1",
      graph: {
        nodes: [
          { id: "t", kind: "trigger.manual", label: null, position: { x: 0, y: 0 }, config: {} },
          { id: "p", kind: "proxmox.create-container", label: null, position: { x: 0, y: 0 }, config: {} },
        ],
        edges: [],
      },
    });
    const { isError, body } = await call("run_workflow", { id: "w1" });
    expect(isError).toBe(true);
    expect(body.error.code).toBe("out_of_scope");
    expect(body.error.message).toContain("proxmox.create-container");
    expect(mocks.executeWorkflow).not.toHaveBeenCalled();
  });

  it("run_workflow runs PolySIEM-internal workflows", async () => {
    mocks.getWorkflow.mockResolvedValue({
      id: "w2",
      graph: { nodes: [{ id: "t", kind: "trigger.manual", label: null, position: { x: 0, y: 0 }, config: {} }], edges: [] },
    });
    mocks.executeWorkflow.mockResolvedValue({ run: { id: "run1", status: "SUCCESS" }, secrets: { n: { k: "v" } } });
    const { isError, body } = await call("run_workflow", { id: "w2", input: { a: 1 } });
    expect(isError).toBe(false);
    expect(body).toEqual({ id: "run1", status: "SUCCESS" });
  });
});
