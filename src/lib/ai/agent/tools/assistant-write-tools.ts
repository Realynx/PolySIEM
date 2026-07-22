import "server-only";

import { z } from "zod";
import type { AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { ToolContext } from "@/lib/ai/agent/types";
import { makeTool, type AnyTool } from "@/lib/ai/agent/tools/factory";
import { createDoc, getDoc, updateDoc } from "@/lib/services/docs";
import { conciseChildTitle } from "@/lib/docs/titles";
import { canonicalizeMarkdownDocLinks } from "@/lib/docs/links";
import { executeWorkflow } from "@/lib/workflows/executor";
import { createDocSchema, updateDocSchema } from "@/lib/validators/docs";
import { triggerIntegrationSyncs } from "@/lib/services/integration-sync";

function actorOf(ctx: ToolContext): AuditActor {
  return { type: "user", userId: ctx.userId };
}

const writeDocInputSchema = z.object({
  title: z.string().min(1).max(255).optional().describe("Page title (required when creating)"),
  content: z.string().max(500_000).optional().describe("Markdown content; include {{node:<kind>:<inventory-id>}} tokens for inventory items this page documents"),
  slugOrId: z.string().min(1).optional().describe("Existing page slug/id to update; omit to create"),
  parentId: z.string().min(1).nullable().optional().describe("Parent doc id for a child page; null moves an existing page to the root; omit to preserve its current parent"),
});
type WriteDocArgs = z.output<typeof writeDocInputSchema>;

async function canonicalContent(content: string | undefined): Promise<string | undefined> {
  if (content === undefined) return undefined;
  const canonical = await canonicalizeMarkdownDocLinks(content, async (slugOrId) => {
    try {
      const doc = await getDoc(slugOrId);
      return { slug: doc.slug };
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  });
  if (canonical.missing.length > 0) {
    throw new ApiError(
      400,
      "invalid_doc_link",
      `Documentation link target does not exist: ${canonical.missing.join(", ")}. Create the target page first, then use the slug or id returned by write_doc.`,
    );
  }
  return canonical.content;
}

async function interviewTitle(ctx: ToolContext, args: WriteDocArgs, title: string | undefined): Promise<string | undefined> {
  if (ctx.mode !== "doc-interview") return title;
  const existing = args.slugOrId ? await getDoc(args.slugOrId) : null;
  const parentId = args.parentId === undefined ? existing?.parentId : args.parentId;
  if (!parentId) return title;
  const parent = await getDoc(parentId);
  return conciseChildTitle(title ?? existing?.title ?? "", parent.title) || title;
}

async function writeDocumentation(ctx: ToolContext, args: WriteDocArgs) {
  const actor = actorOf(ctx);
  const content = await canonicalContent(args.content);
  const title = await interviewTitle(ctx, args, args.title);
  if (args.slugOrId) {
    if (title === undefined && content === undefined && args.parentId === undefined) {
      throw new ApiError(400, "no_fields", "Provide title and/or content to update");
    }
    const doc = await updateDoc(actor, args.slugOrId, updateDocSchema.parse({ title, content, parentId: args.parentId }));
    return { action: "updated", id: doc.id, title: doc.title, slug: doc.slug, parentId: doc.parentId, updatedAt: doc.updatedAt };
  }
  if (!title) throw new ApiError(400, "no_title", "A title is required to create a doc");
  const doc = await createDoc(
    actor,
    createDocSchema.parse({ title, content: content ?? "", parentId: args.parentId }),
    { authorId: ctx.userId, createdVia: "ui" },
  );
  return { action: "created", id: doc.id, title: doc.title, slug: doc.slug, parentId: doc.parentId, updatedAt: doc.updatedAt };
}

/** State-changing assistant operations; the registry owns access control. */
export function assistantWriteTools(ctx: ToolContext): AnyTool[] {
  return [
    makeTool(
      ctx,
      "write_doc",
      "Create or update a markdown documentation page in the docs tree. Provide slugOrId to update an existing page, or omit it to create a new one. Use parentId to place focused pages beneath their subject's root page. Read the existing page before updating it. Link inventory with live Markdown tokens such as {{node:device:<id>}}, {{node:vm:<id>}}, {{node:container:<id>}}, {{node:network:<id>}}, and {{node:service:<id>}}; these also create backlinks on inventory details. Internal doc links are validated against saved pages and the write is rejected if a target does not exist; create the target first and use its returned slug or id.",
      writeDocInputSchema,
      (args) => writeDocumentation(ctx, args),
    ),
    makeTool(
      ctx,
      "run_workflow",
      "Execute a workflow synchronously with the given trigger input. Secret outputs are always redacted. Admin only.",
      z.object({
        id: z.string().min(1).describe("Workflow id"),
        input: z.record(z.string(), z.unknown()).optional().describe("Trigger input keyed by param key"),
      }),
      async (args) => {
        const result = await executeWorkflow(actorOf(ctx), args.id, args.input ?? {}, {
          chain: ctx.workflowChain ?? [],
        });
        return result.run;
      },
    ),
    makeTool(
      ctx,
      "trigger_sync",
      "Trigger a read-only inventory sync into PolySIEM. Live-query integrations such as Elasticsearch, OTX, Censys, and SecurityTrails have no sync run. Admin only.",
      z.object({
        integrationId: z.string().min(1).optional().describe("Integration id (omit to sync all enabled)"),
      }),
      (args) => triggerIntegrationSyncs(args.integrationId, "ai-agent"),
    ),
  ];
}
