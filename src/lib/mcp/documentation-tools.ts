import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import { runTool as run } from "@/lib/mcp/tool-results";
import { createDoc, getDoc, listDocs, updateDoc } from "@/lib/services/docs";
import { assignTag, createTag } from "@/lib/services/tags";
import { createDocSchema, tagSchema, updateDocSchema } from "@/lib/validators/docs";
import type { EntityKind } from "@/lib/types";

const ENTITY_KIND_VALUES = ["device", "vm", "container", "network", "service", "doc"] as const;
const readOnly = { readOnlyHint: true } as const;

export function registerDocumentationReadTools(server: McpServer): void {
  server.registerTool(
    "list_docs",
    {
      title: "List documentation pages",
      description:
        "All documentation pages (id, title, slug, parentId, author, tags, updatedAt) sorted by title. Content is not included; fetch a page with get_doc.",
      annotations: readOnly,
    },
    async (extra) => run("read", extra, () => listDocs()),
  );

  server.registerTool(
    "get_doc",
    {
      title: "Get documentation page",
      description:
        "One documentation page by slug or id, including markdown content, parent, children, author, and tags.",
      inputSchema: { slugOrId: z.string().min(1).describe("Page slug or id") },
      annotations: readOnly,
    },
    async (args, extra) => run("read", extra, () => getDoc(args.slugOrId)),
  );
}

export function registerDocumentationWriteTools(server: McpServer): void {
  server.registerTool(
    "create_doc",
    {
      title: "Create documentation page",
      description:
        "Create a markdown documentation page (createdVia: mcp). Slug is derived from the title. " +
        "Link inventory with {{node:<kind>:<id>}} tokens (device, vm, container, network, service); linked pages appear on inventory details. " +
        "Returns the created page including its slug and id.",
      inputSchema: {
        title: z.string().min(1).max(255).describe("Page title"),
        content: z.string().max(500_000).describe("Markdown content"),
        parentId: z.string().min(1).optional().describe("Parent page id to nest under"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) =>
        createDoc(actor, createDocSchema.parse({ title: args.title, content: args.content, parentId: args.parentId }), {
          authorId: actor.userId,
          createdVia: "mcp",
        }),
      ),
  );

  server.registerTool(
    "update_doc",
    {
      title: "Update documentation page",
      description:
        "Update the title and/or content of an existing documentation page addressed by slug or id. " +
        "Preserve relevant {{node:<kind>:<id>}} inventory links in Markdown; add them for inventory items the page documents. " +
        "Returns the updated page.",
      inputSchema: {
        slugOrId: z.string().min(1).describe("Page slug or id"),
        title: z.string().min(1).max(255).optional().describe("New title"),
        content: z.string().max(500_000).optional().describe("New markdown content (replaces existing)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, (actor) => {
        if (args.title === undefined && args.content === undefined) {
          throw new ApiError(400, "no_fields", "Provide title and/or content to update");
        }
        return updateDoc(actor, args.slugOrId, updateDocSchema.parse({ title: args.title, content: args.content }));
      }),
  );
}

export function registerTagTools(server: McpServer): void {
  server.registerTool(
    "add_tag",
    {
      title: "Add tag to entity",
      description:
        "Assign a tag to an entity (device/vm/container/network/service/doc). The tag is created if it does not exist (get-or-create by name). Idempotent per entity.",
      inputSchema: {
        entityType: z.enum(ENTITY_KIND_VALUES).describe("Entity type"),
        entityId: z.string().min(1).describe("Entity id"),
        tagName: z.string().min(1).max(48).describe("Tag name (created if missing)"),
      },
    },
    async (args, extra) =>
      run("write_docs", extra, async (actor) => {
        const tag = await createTag(actor, tagSchema.parse({ name: args.tagName }));
        return assignTag(actor, {
          tagId: tag.id,
          entityType: args.entityType as EntityKind,
          entityId: args.entityId,
        });
      }),
  );
}
