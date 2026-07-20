import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateDeviceInput,
  ListQuery,
  UpdateDeviceInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";

export async function listDevices(query: ListQuery, kind?: string) {
  const where: Prisma.DeviceWhereInput = {
    ...baseWhere(query),
    ...(kind ? { kind } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.device.findMany({
      where,
      ...paging(query),
      orderBy: { name: "asc" },
      include: {
        tags: { include: { tag: true } },
        _count: { select: { vms: true, containers: true, services: true } },
      },
    }),
    prisma.device.count({ where }),
  ]);
  return { items, total };
}

export async function getDevice(id: string) {
  const device = await prisma.device.findUnique({
    where: { id },
    include: {
      vms: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" } },
      containers: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" } },
      interfaces: { include: { ip: true, network: true } },
      services: { orderBy: { name: "asc" } },
      storagePools: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" } },
      tags: { include: { tag: true } },
      integration: { select: { id: true, name: true, type: true } },
    },
  });
  return device ?? entityNotFound();
}

export async function createDevice(actor: AuditActor, input: CreateDeviceInput) {
  const device = await prisma.device.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "device.create", { type: "device", id: device.id }, { name: device.name });
  return device;
}

export async function updateDevice(actor: AuditActor, id: string, input: UpdateDeviceInput) {
  const existing = (await prisma.device.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const device = await prisma.device.update({ where: { id }, data: input });
  await audit(actor, "device.update", { type: "device", id }, { fields: Object.keys(input) });
  return device;
}

export async function deleteDevice(actor: AuditActor, id: string) {
  const existing = (await prisma.device.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.device.delete({ where: { id } });
  await audit(actor, "device.delete", { type: "device", id }, { name: existing.name });
}

