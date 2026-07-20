# PolySIEM MCP server

PolySIEM ships a [Model Context Protocol](https://modelcontextprotocol.io) server at
`/api/mcp` (Streamable HTTP transport, stateless JSON-RPC over POST). Point an MCP client
at it, whether that's Claude Code, Claude Desktop, or the MCP Inspector, and it can read
your homelab inventory and write PolySIEM-owned documentation.

## 1. Create an API token

1. Sign in to PolySIEM as an admin.
2. Go to **Settings → API tokens** and create a token.
3. Pick scopes (see the table below). The raw token (`ps_...`) is shown exactly once, so copy it now.

### Scopes

| Scope | Grants |
| --- | --- |
| `read` | All read tools: search, inventory, firewall/DHCP reads, docs, integration status, sync runs, lab overview (tool + resource) |
| `write_docs` | PolySIEM-owned writes: create/update docs, create MANUAL entities, edit description/location/purpose, firewall rule annotations, tags |
| `trigger_sync` | Trigger integration syncs (read-only pulls from Proxmox/OPNsense) |

## 2. Connect a client

PolySIEM serves HTTPS by default with a self-signed certificate, which most MCP
clients (Node-based) refuse to trust. Pick one: upload a certificate your
machines already trust under **Settings → Web certificate**, set
`NODE_TLS_REJECT_UNAUTHORIZED=0` in the client's environment (acceptable on a
trusted LAN — it disables all TLS verification for that process), or run
PolySIEM with `POLYSIEM_TLS=off` behind your own reverse proxy.

### Claude Code

```bash
claude mcp add --transport http polysiem https://HOST:3000/api/mcp \
  --header "Authorization: Bearer ps_YOUR_TOKEN"
```

### Claude Desktop

Claude Desktop launches stdio servers, so it needs a Streamable-HTTP-capable bridge such
as `mcp-remote`. Add this to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "polysiem": {
      "command": "npx",
      "args": [
        "mcp-remote",
        "https://HOST:3000/api/mcp",
        "--header",
        "Authorization: Bearer ps_YOUR_TOKEN"
      ]
    }
  }
}
```

### MCP Inspector

```bash
npx @modelcontextprotocol/inspector --cli https://HOST:3000/api/mcp \
  --transport http \
  --header "Authorization: Bearer ps_YOUR_TOKEN" \
  --method tools/list
```

## 3. Tool reference

### `read` scope

| Tool | Input | Returns |
| --- | --- | --- |
| `get_lab_overview` | — | Markdown snapshot: instance name, entity counts, hosts with nested VMs/containers, networks, integration health |
| `search_inventory` | `query`, `kinds?` | Cross-entity name/title matches (up to 8 per kind) with ids and links |
| `list_devices` | `kind?`, `source?`, `status?`, `q?`, `page?` | Paginated devices with tags and child counts |
| `get_device` | `id` | Device detail: VMs, containers, interfaces + IPs, services, storage, tags |
| `list_vms` | `hostId?`, `q?`, `page?` | Paginated VMs with host and tags |
| `get_vm` | `id` | VM detail: host, containers, interfaces + IPs, services, tags |
| `list_containers` | `hostId?`, `q?`, `page?` | Paginated containers with host/VM and tags |
| `get_container` | `id` | Container detail: host, parent VM, interfaces + IPs, services, tags |
| `list_networks` | `q?`, `page?` | Paginated networks with tag and IP/interface/lease counts |
| `get_network` | `id` | Network detail: IPs, attached interfaces, DHCP leases, tags |
| `list_services` | `q?`, `page?` | Paginated services with owning device/VM/container |
| `list_storage_pools` | `q?`, `page?` | Paginated storage pools with capacity and owning device |
| `get_firewall_rules` | `interface?`, `action?` | OPNsense rules (filtered) plus all firewall aliases |
| `get_dhcp_leases` | `networkId?` | DHCP leases (IP, MAC, hostname, static flag) |
| `list_docs` | — | All doc pages (metadata only) |
| `get_doc` | `slugOrId` | One doc page with markdown content, parent/children, tags |
| `get_integration_status` | — | Integration health (never credentials) |
| `get_sync_run` | `runId` | One sync run: status, trigger, timing, stats, error |

### `write_docs` scope

| Tool | Input | Effect |
| --- | --- | --- |
| `create_doc` | `title`, `content`, `parentId?` | New doc page, `createdVia: "mcp"` |
| `update_doc` | `slugOrId`, `title?`, `content?` | Update a doc page |
| `create_entity` | `type` (device\|vm\|container\|network\|service), `fields` | New MANUAL inventory entity (fields validated per type) |
| `update_entity_docs` | `type`, `id`, `description?`, `location?`, `purpose?` | Edit documentation fields; integration-owned fields are rejected |
| `set_firewall_annotation` | `ruleId`, `annotation` (null clears) | Set the PolySIEM-owned note on a firewall rule |
| `add_tag` | `entityType`, `entityId`, `tagName` | Get-or-create tag and assign it |

### `trigger_sync` scope

| Tool | Input | Effect |
| --- | --- | --- |
| `trigger_sync` | `integrationId?` | Run a sync for one integration, or all enabled non-Elasticsearch integrations; returns run ids |

### Resources

| URI | Content |
| --- | --- |
| `polysiem://overview` | Same markdown snapshot as `get_lab_overview` (`text/markdown`) |

## 4. Behavior notes

- **Auth**: every request needs `Authorization: Bearer ps_...`. A missing or invalid token
  gets HTTP 401 with a JSON-RPC error body. Per-tool scope violations return a structured
  tool error (`{"error":{"code":"forbidden",...}}`, `isError: true`).
- **Pagination**: list tools return `{ items, total }`, 50 items per page, `page` starts at 1.
- **Errors**: tools return structured JSON errors with `code`, `status`, and `message`
  (e.g. `not_found`, `validation_error`, `integration_owned`, `engine_unavailable`).
- **Audit**: every write is audit-logged with actor `api_token` and the token/user ids.

## 5. Security model

The MCP server is **read-plus-PolySIEM-writes only**. Writes are limited to PolySIEM's own
database: documentation pages, MANUAL inventory entities, description/location/purpose
fields, firewall rule annotations, and tags.

It **cannot control Proxmox, OPNsense, or Elasticsearch**. There is no code path from any
MCP tool to an integration write; the only integration touchpoint is `trigger_sync`, which
starts the sync engine's read-only pull of remote state.

Synced entities are protected too: fields owned by an integration sync are rejected on
edit, and integration credentials are never exposed by any tool. If a token outlives its
usefulness, tokens can be scoped, expired, and revoked at any time in
**Settings → API tokens**.
