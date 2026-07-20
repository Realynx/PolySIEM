import { z } from "zod";
import { createDoc } from "@/lib/services/docs";
import type { ActionDefinition } from "../registry";

const configSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().max(500_000).default(""),
});

/**
 * docs.create-page — create a documentation page the same way the docs
 * feature does (unique slug derived from the title).
 */
export const docsCreatePage: ActionDefinition = {
  meta: {
    kind: "docs.create-page",
    title: "Create doc page",
    description:
      "Creates a markdown documentation page. The slug is derived from the title; title and content are templateable.",
    category: "docs",
    inputs: [
      {
        key: "title",
        label: "Title",
        type: "string",
        required: true,
        placeholder: "Machine {{input.name}}",
      },
      {
        key: "content",
        label: "Content",
        type: "text",
        required: true,
        placeholder: "# {{input.name}}\n\nIP: {{nodes.<nodeId>.ip}}",
        help: "Markdown; template refs are resolved before the page is created.",
      },
    ],
    outputs: [
      { key: "docId", label: "Doc page id" },
      { key: "slug", label: "Slug" },
    ],
  },
  configSchema,
  async run({ config, ctx }) {
    const { title, content } = configSchema.parse(config);
    const doc = await createDoc(
      ctx.actor,
      { title, content, parentId: null },
      { authorId: ctx.actor.userId },
    );
    return { docId: doc.id, slug: doc.slug };
  },
};
