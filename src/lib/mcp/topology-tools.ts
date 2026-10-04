import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getAssetTopology } from "@/lib/ai/agent/assistant-read";
import { summarizeExposure } from "@/lib/mcp/access-check";
import { checkAccess, loadFootprintGraph } from "@/lib/mcp/analysis";
import { resolveOne } from "@/lib/mcp/entity-resolve";
import { runTool } from "@/lib/mcp/tool-results";

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;
const endpointInput = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .describe('Host/VM/container/service/network name or id, an IPv4 address, or "internet"');

export function registerTopologyTools(server: McpServer): void {
  server.registerTool(
    "check_access",
    {
      title: "Can A reach B?",
      description:
        "Answer whether traffic from one endpoint can reach another according to the synced firewall policy and NAT/tunnel ingress. Endpoints can be hosts, VMs, containers, services, networks, IPs or \"internet\". " +
        "Returns verdict (allowed | no_allow_rule | unknown), every path found (same network, firewall PASS rules with ids, port forwards, tunnels, published routes) and modelling caveats. Use for segmentation questions such as \"can the IoT VLAN reach the NAS?\" or \"is jellyfin reachable from the internet?\".",
      inputSchema: { from: endpointInput, to: endpointInput },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, () => checkAccess(args.from, args.to)),
  );

  server.registerTool(
    "get_topology",
    {
      title: "Get an asset's network footprint",
      description:
        "One host/VM/container's placement and neighbourhood: its VLANs, sibling machines, firewall reachability between those networks, NAT/tunnel ingress, published routes, gateways and switch links. Accepts a name or id.",
      inputSchema: { ref: z.string().trim().min(1).max(255).describe("Host, VM or container name or id") },
      annotations: readOnly,
    },
    async (args, extra) =>
      runTool("read", extra, async () => {
        const entity = await resolveOne(args.ref);
        return getAssetTopology(entity.id);
      }),
  );

  server.registerTool(
    "get_exposure",
    {
      title: "Get internet exposure surface",
      description:
        "The lab's whole internet-facing footprint: WAN IP, port forwards and tunnel ingress with their target machines, published hostnames with DNS classification (proxied vs exposing the WAN), dynamic DNS names, NAT targets that match no documented machine, and networks the internet can reach by rule. Start here for any exposure or attack-surface review.",
      inputSchema: {
        limit: z.number().int().min(1).max(200).optional().describe("Max items per section (default 50)"),
      },
      annotations: readOnly,
    },
    async (args, extra) => runTool("read", extra, async () => summarizeExposure(await loadFootprintGraph(), args.limit ?? 50)),
  );
}
