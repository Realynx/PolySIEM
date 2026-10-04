import "server-only";

import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireToolScope } from "@/lib/mcp/auth";
import { getEntityDetail } from "@/lib/mcp/entity-detail";
import { renderEntityMarkdown } from "@/lib/mcp/entity-markdown";
import { ENTITY_TYPES, type EntityType } from "@/lib/mcp/entity-types";
import { sanitizeOutput, sanitizeText } from "@/lib/mcp/output";
import { buildOverviewMarkdown } from "@/lib/mcp/overview";
import { outputOptionsFor } from "@/lib/mcp/tool-results";

/*
 * MCP resources: stable, addressable context an MCP client can attach
 * without a tool call. All reads require the `read` scope and go through the
 * same secret scrubbing / anonymization as tool output.
 */

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

function markdown(uri: URL, text: string) {
  return { contents: [{ uri: uri.href, mimeType: "text/markdown", text }] };
}

export function registerResources(server: McpServer): void {
  server.registerResource(
    "overview",
    "polysiem://overview",
    {
      title: "Lab overview",
      description: "Markdown snapshot of the lab: instance name, entity counts, hosts with nested VMs/containers, networks and integration health.",
      mimeType: "text/markdown",
    },
    async (uri, extra) => {
      requireToolScope(extra.authInfo, "read");
      return markdown(uri, sanitizeText(await buildOverviewMarkdown(), outputOptionsFor(extra.authInfo)));
    },
  );

  server.registerResource(
    "doc",
    new ResourceTemplate("polysiem://docs/{slug}", {
      list: async (extra) => {
        requireToolScope(extra.authInfo, "read");
        const docs = await prisma.docPage.findMany({ orderBy: { updatedAt: "desc" }, take: 200, select: { slug: true, title: true } });
        return {
          resources: docs.map((d) => ({ uri: `polysiem://docs/${d.slug}`, name: d.title, mimeType: "text/markdown" })),
        };
      },
    }),
    {
      title: "Documentation page",
      description: "One PolySIEM documentation page as markdown, addressed by slug.",
      mimeType: "text/markdown",
    },
    async (uri, variables, extra) => {
      requireToolScope(extra.authInfo, "read");
      const detail = await getEntityDetail("doc", decodeURIComponent(one(variables.slug)), "full");
      const safe = sanitizeOutput(detail, outputOptionsFor(extra.authInfo)) as Record<string, unknown>;
      return markdown(uri, renderEntityMarkdown(safe));
    },
  );

  server.registerResource(
    "entity",
    new ResourceTemplate("polysiem://entity/{type}/{id}", { list: undefined }),
    {
      title: "Entity documentation",
      description:
        "Markdown documentation card for any PolySIEM entity (device, vm, container, network, service, ticket, workflow, tunnel, connector, …): key fields, description/notes, tags and linked doc pages.",
      mimeType: "text/markdown",
    },
    async (uri, variables, extra) => {
      requireToolScope(extra.authInfo, "read");
      const type = one(variables.type);
      if (!(ENTITY_TYPES as readonly string[]).includes(type)) {
        throw new ApiError(400, "validation_error", `Unknown entity type "${type}". Use one of: ${ENTITY_TYPES.join(", ")}`);
      }
      const detail = await getEntityDetail(type as EntityType, decodeURIComponent(one(variables.id)), "full");
      const safe = sanitizeOutput(detail, outputOptionsFor(extra.authInfo)) as Record<string, unknown>;
      return markdown(uri, renderEntityMarkdown(safe));
    },
  );
}
