import "server-only";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { EntityKind } from "@/lib/types";
import type { AssignTagInput, TagInput } from "@/lib/validators/docs";

/** Maps a polymorphic entityType to the typed FK column on TagAssignment. */
const FK_COLUMN: Record<EntityKind, "deviceId" | "vmId" | "containerId" | "networkId" | "serviceId" | "docPageId"> = {
  device: "deviceId",
  vm: "vmId",
  container: "containerId",
  network: "networkId",
  service: "serviceId",
  doc: "docPageId",
};

async function entityExists(entityType: EntityKind, entityId: string): Promise<boolean> {
  switch (entityType) {
    case "device":
      return Boolean(await prisma.device.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "vm":
      return Boolean(await prisma.virtualMachine.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "container":
      return Boolean(await prisma.container.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "network":
      return Boolean(await prisma.network.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "service":
      return Boolean(await prisma.service.findUnique({ where: { id: entityId }, select: { id: true } }));
    case "doc":
      return Boolean(await prisma.docPage.findUnique({ where: { id: entityId }, select: { id: true } }));
  }
}

export async function listTags() {
  return prisma.tag.findMany({ orderBy: { name: "asc" }, include: { _count: { select: { assignments: true } } } });
}

export async function createTag(actor: AuditActor, input: TagInput) {
  const existing = await prisma.tag.findUnique({ where: { name: input.name } });
  if (existing) return existing;
  const tag = await prisma.tag.create({ data: input });
  await audit(actor, "tag.create", { type: "tag", id: tag.id }, { name: tag.name });
  return tag;
}

export async function deleteTag(actor: AuditActor, id: string) {
  const tag = await prisma.tag.findUnique({ where: { id } });
  if (!tag) throw new ApiError(404, "not_found", "Tag not found");
  await prisma.tag.delete({ where: { id } });
  await audit(actor, "tag.delete", { type: "tag", id }, { name: tag.name });
}

export async function assignTag(actor: AuditActor, input: AssignTagInput) {
  const tag = await prisma.tag.findUnique({ where: { id: input.tagId } });
  if (!tag) throw new ApiError(404, "not_found", "Tag not found");
  if (!(await entityExists(input.entityType, input.entityId))) {
    throw new ApiError(404, "not_found", `${input.entityType} not found`);
  }
  const assignment = await prisma.tagAssignment.upsert({
    where: {
      tagId_entityType_entityId: {
        tagId: input.tagId,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    },
    create: {
      tagId: input.tagId,
      entityType: input.entityType,
      entityId: input.entityId,
      [FK_COLUMN[input.entityType]]: input.entityId,
    },
    update: {},
    include: { tag: true },
  });
  await audit(actor, "tag.assign", { type: input.entityType, id: input.entityId }, { tag: tag.name });
  return assignment;
}

export async function unassignTag(actor: AuditActor, input: AssignTagInput) {
  await prisma.tagAssignment.deleteMany({
    where: { tagId: input.tagId, entityType: input.entityType, entityId: input.entityId },
  });
  await audit(actor, "tag.unassign", { type: input.entityType, id: input.entityId }, { tagId: input.tagId });
}
