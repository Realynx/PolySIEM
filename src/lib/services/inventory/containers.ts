import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateContainerInput,
  ListQuery,
  UpdateContainerInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";

export async function listContainers(query: ListQuery, hostId?: string) {
  const where: Prisma.ContainerWhereInput = {
    ...baseWhere(query),
    ...(hostId ? { hostId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.container.findMany({
      where,
      ...paging(query),
      orderBy: { name: "asc" },
      include: {
        host: { select: { id: true, name: true } },
        vm: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    }),
    prisma.container.count({ where }),
  ]);
  return { items, total };
}

export async function getContainer(id: string) {
  const container = await prisma.container.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true } },
      vm: { select: { id: true, name: true } },
      interfaces: { include: { ip: true, network: true } },
      services: { orderBy: { name: "asc" } },
      tags: { include: { tag: true } },
      integration: { select: { id: true, name: true, type: true } },
    },
  });
  return container ?? entityNotFound();
}

export async function createContainer(actor: AuditActor, input: CreateContainerInput) {
  const container = await prisma.container.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "container.create", { type: "container", id: container.id }, { name: container.name });
  return container;
}

export async function updateContainer(actor: AuditActor, id: string, input: UpdateContainerInput) {
  const existing = (await prisma.container.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const container = await prisma.container.update({ where: { id }, data: input });
  await audit(actor, "container.update", { type: "container", id }, { fields: Object.keys(input) });
  return container;
}

export async function deleteContainer(actor: AuditActor, id: string) {
  const existing = (await prisma.container.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.container.delete({ where: { id } });
  await audit(actor, "container.delete", { type: "container", id }, { name: existing.name });
}
