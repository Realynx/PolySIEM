import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateServiceInput,
  ListQuery,
  UpdateServiceInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import { assertManualDelete, assertSyncedEdit, entityNotFound } from "./policies";

const SERVICE_RELATIONS = {
  device: { select: { id: true, name: true } },
  vm: { select: { id: true, name: true } },
  container: { select: { id: true, name: true } },
  tags: { include: { tag: true } },
} satisfies Prisma.ServiceInclude;

export async function listServices(query: ListQuery) {
  const where: Prisma.ServiceWhereInput = baseWhere(query);
  const [items, total] = await Promise.all([
    prisma.service.findMany({
      where,
      ...paging(query),
      orderBy: { name: "asc" },
      include: SERVICE_RELATIONS,
    }),
    prisma.service.count({ where }),
  ]);
  return { items, total };
}

export async function getService(id: string) {
  const service = await prisma.service.findUnique({
    where: { id },
    include: SERVICE_RELATIONS,
  });
  return service ?? entityNotFound();
}

export async function createService(actor: AuditActor, input: CreateServiceInput) {
  const service = await prisma.service.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "service.create", { type: "service", id: service.id }, { name: service.name });
  return service;
}

export async function updateService(actor: AuditActor, id: string, input: UpdateServiceInput) {
  const existing = (await prisma.service.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const service = await prisma.service.update({ where: { id }, data: input });
  await audit(actor, "service.update", { type: "service", id }, { fields: Object.keys(input) });
  return service;
}

export async function deleteService(actor: AuditActor, id: string) {
  const existing = (await prisma.service.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.service.delete({ where: { id } });
  await audit(actor, "service.delete", { type: "service", id }, { name: existing.name });
}
