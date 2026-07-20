import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateVmInput,
  ListQuery,
  UpdateVmInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";

export async function listVms(query: ListQuery, hostId?: string) {
  const where: Prisma.VirtualMachineWhereInput = {
    ...baseWhere(query),
    ...(hostId ? { hostId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.virtualMachine.findMany({
      where,
      ...paging(query),
      orderBy: { name: "asc" },
      include: {
        host: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
      },
    }),
    prisma.virtualMachine.count({ where }),
  ]);
  return { items, total };
}

export async function getVm(id: string) {
  const vm = await prisma.virtualMachine.findUnique({
    where: { id },
    include: {
      host: { select: { id: true, name: true } },
      containers: { where: { status: { not: "REMOVED" } } },
      interfaces: { include: { ip: true, network: true } },
      services: { orderBy: { name: "asc" } },
      tags: { include: { tag: true } },
      integration: { select: { id: true, name: true, type: true } },
    },
  });
  return vm ?? entityNotFound();
}

export async function createVm(actor: AuditActor, input: CreateVmInput) {
  const vm = await prisma.virtualMachine.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "vm.create", { type: "vm", id: vm.id }, { name: vm.name });
  return vm;
}

export async function updateVm(actor: AuditActor, id: string, input: UpdateVmInput) {
  const existing = (await prisma.virtualMachine.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const vm = await prisma.virtualMachine.update({ where: { id }, data: input });
  await audit(actor, "vm.update", { type: "vm", id }, { fields: Object.keys(input) });
  return vm;
}

export async function deleteVm(actor: AuditActor, id: string) {
  const existing = (await prisma.virtualMachine.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.virtualMachine.delete({ where: { id } });
  await audit(actor, "vm.delete", { type: "vm", id }, { name: existing.name });
}

