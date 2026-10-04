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
| `read` | Every read tool, all resources, and the read-only workflow tools |
| `write_docs` | PolySIEM-owned writes: docs, notes, MANUAL entities, description/location/purpose, firewall/NAT annotations, tags, security tickets, saving workflows |
| `trigger_sync` | `trigger_sync` (read-only pulls into PolySIEM) and `run_workflow` |
| `credentials` | `list_ai_credentials` / `get_ai_credential` (admin-shared secrets only; every read is audited) |

If the token owner has **anonymous mode** turned on in PolySIEM, MCP output is
pseudonymized the same way the dashboard is (names, IPs, MACs, hostnames; ids are
kept so follow-up calls still work). Tokens of disabled users are rejected.

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
claude mcp list   # should report polysiem as connected
```

Use the URL you actually reach PolySIEM on. If the client reports
`HTTP 403 {"error":"origin_rejected"}`, it is talking to a **different program** on
that host/port: PolySIEM never returns that body (its errors are JSON-RPC objects such
as `{"jsonrpc":"2.0","error":{...}}`). Check what is listening (`netstat -ano | findstr :3000`
on Windows, `ss -ltnp` on Linux), then `claude mcp remove polysiem` and add it again
with PolySIEM's real URL.

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

The catalogue is a small set of composable tools with consistent `verb_noun` names.
Lists return `{ items, total, nextCursor }`: pass `nextCursor` back as `cursor` with
the same filters (`limit` defaults to 25, max 100). `get_entity` and `list_inventory`
take `detail: "summary" | "full"`. Output is compact JSON capped at 60k characters,
with secrets always removed.

### Read (`read` scope)

| Tool | Use it to |
| --- | --- |
| `get_lab_overview` | Orient: counts, hosts with VMs/containers, networks, integration health (markdown) |
| `search` | Find anything by name or IP (`mode: "name"`), or by meaning over docs and inventory (`mode: "semantic"`, RAG) |
| `get_entity` | Open one entity by id, name, slug or IP across 21 types (device, vm, container, network, service, storage_pool, ip, doc, ticket, workflow, ssh_key, firewall_rule, port_forward, tunnel, connector, edge_server, privacy_router, integration, sync_run, switch, wireless_network). Returns `candidates` when ambiguous |
| `list_inventory` | Page devices, VMs, containers, services, storage pools, switches or Wi-Fi networks (filters: q, hostId, kind, source, status, powerState, tag) |
| `list_network` | Page networks/VLANs, IP addresses, DHCP leases, ARP neighbours, gateways or dynamic DNS |
| `list_firewall` | Page firewall rules (OPNsense and Proxmox), aliases or port forwards |
| `list_edge` | Page edge relay servers, connectors, port relays, privacy routers (exits and rules), tunnels with DNS, Tailscale or Cloudflare snapshots |
| `list_ssh_keys` | SSH public keys and where they are authorized (public information only) |
| `list_docs` | Page documentation page metadata |
| `check_access` | "Can A reach B?" between hosts, services, networks, IPs or `internet`: verdict, paths, rule ids, caveats |
| `get_topology` | One asset's VLANs, neighbours, reachability, ingress, routes, gateways and switch links |
| `get_exposure` | The internet-facing surface: WAN IP, NAT/tunnel ingress, published hostnames, dynamic DNS, undocumented targets |
| `get_security_score` | Live 0-100 score, category subscores and findings with remediation (filters and paging) |
| `list_security_tickets` | Threat-watch tickets by status, severity and text |
| `investigate_ip` | One-call IP dossier: identity, firewall/NAT context, OTX, related tickets, log activity |
| `check_threat_intel` | OTX: one indicator, or `mode: "lab_matches"` for IOCs seen in recent logs |
| `lookup_external_intel` | Censys / SecurityTrails for public IPs and domains (cached, quota-limited) |
| `summarize_log_activity` | Elasticsearch aggregation for an IP or term (event types, ports, IDS signatures, peers) |
| `list_log_fields` | Discover mapped log fields before searching |
| `search_logs` | Bounded document search with field filters and time windows (no raw DSL) |
| `get_bandwidth` | Busiest interfaces and firewall rules over 1h, 6h or 24h |
| `get_integration_status` | Integration health; one integration with its recent sync runs; or one sync run |
| `list_workflows`, `get_workflow_catalog`, `validate_workflow` | Inspect workflows and the node catalog (`runnableOverMcp` / `availableOverMcp` flags) |

### PolySIEM-owned writes

| Tool | Scope | Effect |
| --- | --- | --- |
| `write_doc` | `write_docs` | Create or update a markdown page (`createdVia: "mcp"`); validates doc links; supports `{{node:<kind>:<id>}}` embeds |
| `add_note` | `write_docs` | Append a dated note to a device/VM/container/network/service description, a firewall rule or port-forward annotation, or an SSH key's purpose |
| `update_entity_docs` | `write_docs` | Replace description/location/purpose (integration-owned fields are rejected) |
| `set_annotation` | `write_docs` | Replace the operator note on a firewall rule or port forward |
| `create_entity` | `write_docs` | Create a MANUAL inventory record (documentation only) |
| `tag_entity` | `write_docs` | Get-or-create a tag and assign it |
| `save_security_ticket` | `write_docs` | Open a ticket, edit a human-created one, or close/reopen any ticket with a resolution |
| `save_workflow` | `write_docs` | Create or update a workflow (validated; infrastructure nodes are refused) |
| `trigger_sync` | `trigger_sync` | Start a read-only sync from Proxmox/OPNsense/UniFi/Cloudflare/Tailscale/Edge into PolySIEM |
| `run_workflow` | `trigger_sync` | Run a workflow made only of PolySIEM-internal nodes; secret outputs are redacted |
| `list_ai_credentials`, `get_ai_credential` | `credentials` | Admin-shared credentials; the only tool that returns a secret, audited on every read |

Documentation Markdown can link directly to live inventory with
`{{node:<kind>:<id>}}`, where kind is `device`, `vm`, `container`, `network`, or
`service`. The editor renders the token as a live inventory card, and the page
automatically appears under Linked documentation in that inventory item's
Description area.

### Resources

| URI | Content |
| --- | --- |
| `polysiem://overview` | Same markdown snapshot as `get_lab_overview` |
| `polysiem://docs/{slug}` | One documentation page as markdown (listable) |
| `polysiem://entity/{type}/{id}` | A markdown card for any entity: key fields, notes, tags, linked docs |

### Prompts

| Prompt | Arguments | What it does |
| --- | --- | --- |
| `security_review` | `focus?` | Score, exposure, segmentation and tickets, then prioritized fixes |
| `investigate_ip` | `ip` | Identity, exposure, threat intel and activity, then a verdict |
| `document_host` | `host` | Gathers everything about a host and writes or refreshes its doc page |

## 4. Behavior notes

- **Auth**: every request needs `Authorization: Bearer ps_...`. A missing or invalid token
  gets HTTP 401 with a JSON-RPC error body. Per-tool scope violations return a tool error
  (`isError: true`) with `code`, `message` and a `hint`.
- **Origin and DNS rebinding**: requests without an `Origin` header (Claude Code,
  mcp-remote, the Inspector CLI, curl) are accepted; the token is still required. Browser
  origins are accepted only when they are loopback, equal to `APP_URL`, listed in
  `POLYSIEM_MCP_ALLOWED_ORIGINS` (comma separated, `*` for any), or the same IP-literal
  host as the request. Anything else gets HTTP 403 with a JSON-RPC error explaining how to
  allow it.
- **Errors**: `{ "error": { code, message, hint?, issues? } }` with codes such as
  `not_found`, `ambiguous`, `validation_error`, `invalid_cursor`, `out_of_scope`,
  `integration_owned` and `forbidden`. Stack traces are never returned.
- **Audit**: every write is audit-logged with actor `api_token` and the token and user ids.

## 5. Security model

The MCP server is **read + PolySIEM-writes only**. Writes are limited to PolySIEM's own
database: documentation pages, notes, MANUAL inventory entities, description/location/purpose
fields, firewall/NAT annotations, tags, security tickets and workflows.

It **cannot control Proxmox, OPNsense, UniFi, edge servers, connectors or privacy routers**:
no tool starts or stops machines, pushes firewall or relay rules, or runs commands on hosts.
`trigger_sync` only starts the read-only pull of remote state. Workflows are the one place
PolySIEM can act on infrastructure, so MCP refuses to save or run any workflow containing
Proxmox, HTTP/credential or AI-script nodes, including through sub-workflows. Run those from
the UI.

Secrets never leave through MCP. Tools select explicit columns, and every result is then
scrubbed of credential-like keys (encrypted credentials, password and token hashes, private
keys, API keys, Wi-Fi passphrases, raw switch configs) and inline secrets (Bearer tokens,
`ps_` tokens, PEM private keys). The single exception is `get_ai_credential`, which returns a
secret the admin explicitly shared with AI assistants, behind the separate `credentials` scope
and an audit record per read. Tokens can be scoped, expired and revoked at any time in
**Settings → API tokens**.
