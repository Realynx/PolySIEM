import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { audit, type AuditActor } from "@/lib/audit";
import type {
  CreateNetworkInput,
  ListQuery,
  UpdateNetworkInput,
} from "@/lib/validators/inventory";
import { baseWhere, paging } from "./query";
import {
  assertManualDelete,
  assertSyncedEdit,
  entityNotFound,
} from "./policies";

export async function listNetworks(query: ListQuery) {
  const where: Prisma.NetworkWhereInput = baseWhere(query);
  const [items, total] = await Promise.all([
    prisma.network.findMany({
      where,
      ...paging(query),
      orderBy: [{ vlanId: "asc" }, { name: "asc" }],
      include: {
        tags: { include: { tag: true } },
        _count: {
          select: { ipAddresses: true, interfaces: true, dhcpLeases: true },
        },
      },
    }),
    prisma.network.count({ where }),
  ]);
  return { items, total };
}

export async function getNetwork(id: string) {
  const network = await prisma.network.findUnique({
    where: { id },
    include: {
      ipAddresses: { orderBy: { address: "asc" } },
      interfaces: {
        include: {
          device: { select: { id: true, name: true } },
          vm: { select: { id: true, name: true } },
          container: { select: { id: true, name: true } },
          ip: true,
        },
      },
      dhcpLeases: {
        where: { status: { not: "REMOVED" } },
        orderBy: { ipAddress: "asc" },
      },
      neighbors: {
        where: { status: { not: "REMOVED" } },
        orderBy: { ipAddress: "asc" },
      },
      tags: { include: { tag: true } },
      integration: { select: { id: true, name: true, type: true } },
    },
  });
  return network ?? entityNotFound();
}

export async function createNetwork(actor: AuditActor, input: CreateNetworkInput) {
  const network = await prisma.network.create({ data: { ...input, source: "MANUAL" } });
  await audit(actor, "network.create", { type: "network", id: network.id }, { name: network.name });
  return network;
}

export async function updateNetwork(actor: AuditActor, id: string, input: UpdateNetworkInput) {
  const existing = (await prisma.network.findUnique({ where: { id } })) ?? entityNotFound();
  assertSyncedEdit(existing.source, input);
  const network = await prisma.network.update({ where: { id }, data: input });
  await audit(actor, "network.update", { type: "network", id }, { fields: Object.keys(input) });
  return network;
}

export async function deleteNetwork(actor: AuditActor, id: string) {
  const existing = (await prisma.network.findUnique({ where: { id } })) ?? entityNotFound();
  assertManualDelete(existing.source);
  await prisma.network.delete({ where: { id } });
  await audit(actor, "network.delete", { type: "network", id }, { name: existing.name });
}

