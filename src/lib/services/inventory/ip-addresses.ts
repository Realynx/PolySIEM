import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateIpInput,
  ListQuery,
  UpdateIpInput,
} from "@/lib/validators/inventory";
import { paging } from "./query";
import { assertSyncedEdit, entityNotFound } from "./policies";

const IP_RELATIONS = {
  network: { select: { id: true, name: true, cidr: true } },
  interface: {
    include: {
      device: { select: { id: true, name: true } },
      vm: { select: { id: true, name: true } },
      container: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.IpAddressInclude;

export async function listIps(query: ListQuery, networkId?: string) {
  const where: Prisma.IpAddressWhereInput = {
    ...(query.q ? { address: { contains: query.q } } : {}),
    ...(networkId ? { networkId } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.ipAddress.findMany({
      where,
      ...paging(query),
      orderBy: { address: "asc" },
      include: IP_RELATIONS,
    }),
    prisma.ipAddress.count({ where }),
  ]);
  return { items, total };
}

export async function getIp(id: string) {
  const ip = await prisma.ipAddress.findUnique({
    where: { id },
    include: IP_RELATIONS,
  });
  return ip ?? entityNotFound();
}

export async function createIp(actor: AuditActor, input: CreateIpInput) {
  const ip = await prisma.ipAddress.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "ip.create", { type: "ip", id: ip.id }, { address: ip.address });
  return ip;
}

export async function updateIp(actor: AuditActor, id: string, input: UpdateIpInput) {
  const existing = (await prisma.ipAddress.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const ip = await prisma.ipAddress.update({ where: { id }, data: input });
  await audit(actor, "ip.update", { type: "ip", id }, { fields: Object.keys(input) });
  return ip;
}

export async function deleteIp(actor: AuditActor, id: string) {
  if (!(await prisma.ipAddress.findUnique({ where: { id } }))) entityNotFound();
  await prisma.ipAddress.delete({ where: { id } });
  await audit(actor, "ip.delete", { type: "ip", id });
}

