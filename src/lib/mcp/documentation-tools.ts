import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "@/lib/api";
import type { AuditActor } from "@/lib/audit";
import { canonicalizeMarkdownDocLinks } from "@/lib/docs/links";
import { createDoc, getDoc, updateDoc } from "@/lib/services/docs";
import { assignTag, createTag } from "@/lib/services/tags";
import { createDocSchema, tagSchema, updateDocSchema } from "@/lib/validators/docs";
import type { EntityKind } from "@/lib/types";
import { runTool } from "@/lib/mcp/tool-results";

const writeHint = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const TAGGABLE = ["device", "vm", "container", "network", "service", "doc"] as const;

async function canonicalContent(content: string | undefined): Promise<string | undefined> {
  if (content === undefined) return undefined;
  const canonical = await canonicalizeMarkdownDocLinks(content, async (slugOrId) => {
    try {
      return { slug: (await getDoc(slugOrId)).slug };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  });
  if (canonical.missing.length > 0) {
    throw new ApiError(
      400,
      "invalid_doc_link",
      `Documentation link target does not exist: ${canonical.missing.join(", ")}. Create that page first (write_doc), then link to the slug it returns.`,
    );
  }
  return canonical.content;
}

interface WriteDocArgs {
  slugOrId?: string;
  title?: string;
  content?: string;
  parentId?: string | null;
}

async function writeDoc(actor: AuditActor, args: WriteDocArgs) {
  const content = await canonicalContent(args.content);
  if (args.slugOrId) {
    if (args.title === undefined && content === undefined && args.parentId === undefined) {
      throw new ApiError(400, "no_fields", "Provide title, content and/or parentId to update the page");
    }
    const doc = await updateDoc(actor, args.slugOrId, updateDocSchema.parse({ title: args.title, content, parentId: args.parentId }));
    return { action: "updated", id: doc.id, title: doc.title, slug: doc.slug, parentId: doc.parentId, href: `/docs/${doc.slug}` };
  }
  if (!args.title) throw new ApiError(400, "validation_error", "title is required when creating a page (omit slugOrId to create)");
  const doc = await createDoc(actor, createDocSchema.parse({ title: args.title, content: content ?? "", parentId: args.parentId ?? undefined }), {
    authorId: actor.userId,
    createdVia: "mcp",
  });
  return { action: "created", id: doc.id, title: doc.title, slug: doc.slug, parentId: doc.parentId, href: `/docs/${doc.slug}` };
}

export function registerDocumentationWriteTools(server: McpServer): void {
  server.registerTool(
    "write_doc",
    {
      title: "Create or update a documentation page",
      description:
        "Create a markdown documentation page (omit slugOrId; title required) or update one (pass slugOrId; content REPLACES the body, so read it first with get_entity type=doc detail=full). parentId nests the page (null moves it to the root). " +
        "Embed live inventory cards with {{node:<device|vm|container|network|service>:<id>}}; they also add backlinks on the inventory item. Links to other docs are validated and must point at existing pages.",
      inputSchema: {
        slugOrId: z.string().trim().min(1).max(255).optional().describe("Existing page slug or id; omit to create"),
        title: z.string().trim().min(1).max(255).optional().describe("Page title (required when creating)"),
        content: z.string().max(500_000).optional().describe("Full markdown body"),
        parentId: z.string().trim().min(1).max(128).nullable().optional().describe("Parent page id; null = root; omit to keep"),
      },
      annotations: writeHint,
    },
    async (args, extra) => runTool("write_docs", extra, (actor) => writeDoc(actor, args)),
  );
}

export function registerTagTools(server: McpServer): void {
  server.registerTool(
    "tag_entity",
    {
      title: "Tag an entity",
      description:
        "Assign a tag to a device, VM, container, network, service or doc page. The tag is created if it does not exist; assigning an existing tag again is a no-op. Tags are filterable in list_inventory.",
      inputSchema: {
        entityType: z.enum(TAGGABLE).describe("Entity type"),
        entityId: z.string().trim().min(1).max(128).describe("Entity id (resolve names with get_entity first)"),
        tagName: z.string().trim().min(1).max(48).describe("Tag name"),
      },
      annotations: { ...writeHint, idempotentHint: true },
    },
    async (args, extra) =>
      runTool("write_docs", extra, async (actor) => {
        const tag = await createTag(actor, tagSchema.parse({ name: args.tagName }));
        return assignTag(actor, { tagId: tag.id, entityType: args.entityType as EntityKind, entityId: args.entityId });
      }),
  );
}
