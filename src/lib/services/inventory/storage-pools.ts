import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateStorageInput,
  ListQuery,
  UpdateStorageInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";

export async function listStoragePools(query: ListQuery) {
  const where: Prisma.StoragePoolWhereInput = baseWhere(query);
  const [items, total] = await Promise.all([
    prisma.storagePool.findMany({
      where,
      ...paging(query),
      orderBy: { name: "asc" },
      include: { device: { select: { id: true, name: true } } },
    }),
    prisma.storagePool.count({ where }),
  ]);
  return { items, total };
}

export async function getStoragePool(id: string) {
  const pool = await prisma.storagePool.findUnique({
    where: { id },
    include: {
      device: { select: { id: true, name: true } },
      integration: { select: { id: true, name: true, type: true } },
    },
  });
  return pool ?? entityNotFound();
}

export async function createStoragePool(actor: AuditActor, input: CreateStorageInput) {
  const pool = await prisma.storagePool.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "storage.create", { type: "storage", id: pool.id }, { name: pool.name });
  return pool;
}

export async function updateStoragePool(actor: AuditActor, id: string, input: UpdateStorageInput) {
  const existing = (await prisma.storagePool.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const pool = await prisma.storagePool.update({ where: { id }, data: input });
  await audit(actor, "storage.update", { type: "storage", id }, { fields: Object.keys(input) });
  return pool;
}

export async function deleteStoragePool(actor: AuditActor, id: string) {
  const existing = (await prisma.storagePool.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.storagePool.delete({ where: { id } });
  await audit(actor, "storage.delete", { type: "storage", id });
}

