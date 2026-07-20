import "server-only";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import { deleteSourceChunks, reindexDoc } from "@/lib/rag/index";
import type { CreateDocInput, UpdateDocInput } from "@/lib/validators/docs";

export function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 128) || "page"
  );
}

async function uniqueSlug(base: string): Promise<string> {
  let slug = base;
  for (let i = 2; ; i++) {
    const existing = await prisma.docPage.findUnique({ where: { slug } });
    if (!existing) return slug;
    slug = `${base}-${i}`;
  }
}

export async function listDocs() {
  return prisma.docPage.findMany({
    orderBy: { title: "asc" },
    select: {
      id: true,
      title: true,
      slug: true,
      parentId: true,
      createdVia: true,
      updatedAt: true,
      author: { select: { id: true, username: true, displayName: true } },
      tags: { include: { tag: true } },
    },
  });
}

export async function getDoc(slugOrId: string) {
  const doc = await prisma.docPage.findFirst({
    where: { OR: [{ slug: slugOrId }, { id: slugOrId }] },
    include: {
      parent: { select: { id: true, title: true, slug: true } },
      children: { select: { id: true, title: true, slug: true }, orderBy: { title: "asc" } },
      author: { select: { id: true, username: true, displayName: true } },
      tags: { include: { tag: true } },
    },
  });
  if (!doc) throw new ApiError(404, "not_found", "Documentation page not found");
  return doc;
}

export async function createDoc(
  actor: AuditActor,
  input: CreateDocInput,
  opts?: { authorId?: string; createdVia?: "ui" | "mcp" },
) {
  if (input.parentId) {
    const parent = await prisma.docPage.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ApiError(400, "bad_parent", "Parent page not found");
  }
  const doc = await prisma.docPage.create({
    data: {
      title: input.title,
      content: input.content,
      parentId: input.parentId ?? null,
      slug: await uniqueSlug(input.slug ?? slugify(input.title)),
      authorId: opts?.authorId,
      createdVia: opts?.createdVia ?? "ui",
    },
  });
  await audit(actor, "doc.create", { type: "doc", id: doc.id }, { title: doc.title });
  // Fire-and-forget: (re)build this doc's embeddings without blocking the save
  // or failing it if the embedding backend is down/disabled.
  void reindexDoc(doc.id);
  return doc;
}

export async function updateDoc(actor: AuditActor, slugOrId: string, input: UpdateDocInput) {
  const doc = await getDoc(slugOrId);
  if (input.parentId) {
    if (input.parentId === doc.id) throw new ApiError(400, "bad_parent", "A page cannot be its own parent");
    const parent = await prisma.docPage.findUnique({ where: { id: input.parentId } });
    if (!parent) throw new ApiError(400, "bad_parent", "Parent page not found");
    // reject cycles: walk up from the new parent
    let cursor: string | null = parent.parentId;
    while (cursor) {
      if (cursor === doc.id) throw new ApiError(400, "bad_parent", "Move would create a cycle");
      const next: { parentId: string | null } | null = await prisma.docPage.findUnique({
        where: { id: cursor },
        select: { parentId: true },
      });
      cursor = next?.parentId ?? null;
    }
  }
  const updated = await prisma.docPage.update({
    where: { id: doc.id },
    data: {
      title: input.title,
      content: input.content,
      parentId: input.parentId === undefined ? undefined : input.parentId,
    },
  });
  await audit(actor, "doc.update", { type: "doc", id: doc.id }, { fields: Object.keys(input) });
  void reindexDoc(doc.id);
  return updated;
}

export async function deleteDoc(actor: AuditActor, slugOrId: string) {
  const doc = await getDoc(slugOrId);
  await prisma.docPage.delete({ where: { id: doc.id } });
  await audit(actor, "doc.delete", { type: "doc", id: doc.id }, { title: doc.title });
  // Fire-and-forget: drop this doc's embeddings; never blocks the delete.
  void deleteSourceChunks("doc", doc.id).catch(() => {});
}
