import "server-only";
import type { Prisma, SecurityTicket, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import type { TicketCreateInput, TicketListQuery, TicketPatchInput } from "@/lib/validators/scan";
import {
  TICKET_SEVERITIES,
  type SecurityTicketDto,
  type TicketEvidence,
  type TicketListResponse,
  type TicketRefs,
  type TicketSeverityValue,
} from "@/lib/types";

type TicketWithCloser = SecurityTicket & { closedBy: Pick<User, "username" | "displayName"> | null };

const TICKET_INCLUDE = { closedBy: { select: { username: true, displayName: true } } } as const;

export function toTicketDto(ticket: TicketWithCloser): SecurityTicketDto {
  return {
    id: ticket.id,
    title: ticket.title,
    summary: ticket.summary,
    severity: ticket.severity,
    status: ticket.status,
    category: ticket.category,
    createdBy: ticket.createdBy,
    suggestions: ticket.suggestions,
    refs: (ticket.sourceRefs as TicketRefs | null) ?? null,
    evidence: (ticket.evidence as TicketEvidence | null) ?? null,
    investigation:
      (ticket.investigation as SecurityTicketDto["investigation"] | null) ?? null,
    investigatedAt: ticket.investigatedAt?.toISOString() ?? null,
    investigationStatus:
      (ticket.investigationStatus as SecurityTicketDto["investigationStatus"] | null) ?? null,
    investigationProgress:
      (ticket.investigationProgress as SecurityTicketDto["investigationProgress"] | null) ?? null,
    timesSeen: ticket.timesSeen,
    lastSeenAt: ticket.lastSeenAt.toISOString(),
    scanRunId: ticket.scanRunId,
    closedAt: ticket.closedAt?.toISOString() ?? null,
    closedByName: ticket.closedBy ? (ticket.closedBy.displayName ?? ticket.closedBy.username) : null,
    resolution: ticket.resolution,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
  };
}

export async function listTickets(query: TicketListQuery): Promise<TicketListResponse> {
  const where: Prisma.SecurityTicketWhereInput = {};
  if (query.status !== "all") where.status = query.status === "open" ? "OPEN" : "CLOSED";
  if (query.severity?.trim()) {
    const severities = query.severity
      .split(",")
      .map((s) => s.trim().toUpperCase())
      .filter((s): s is TicketSeverityValue => (TICKET_SEVERITIES as string[]).includes(s));
    if (severities.length) where.severity = { in: severities };
  }
  if (query.q?.trim()) {
    where.OR = [
      { title: { contains: query.q.trim(), mode: "insensitive" } },
      { summary: { contains: query.q.trim(), mode: "insensitive" } },
    ];
  }

  const [tickets, total, openGroups] = await Promise.all([
    prisma.securityTicket.findMany({
      where,
      include: TICKET_INCLUDE,
      // TicketSeverity is declared CRITICAL→INFO, so ascending = most severe first.
      orderBy: [{ severity: "asc" }, { lastSeenAt: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    }),
    prisma.securityTicket.count({ where }),
    prisma.securityTicket.groupBy({ by: ["severity"], where: { status: "OPEN" }, _count: true }),
  ]);

  const openCounts = Object.fromEntries(TICKET_SEVERITIES.map((s) => [s, 0])) as Record<TicketSeverityValue, number>;
  for (const group of openGroups) openCounts[group.severity] = group._count;

  return { tickets: tickets.map(toTicketDto), total, openCounts };
}

export async function getTicket(id: string): Promise<SecurityTicketDto> {
  const ticket = await prisma.securityTicket.findUnique({ where: { id }, include: TICKET_INCLUDE });
  if (!ticket) throw new ApiError(404, "not_found", "Ticket not found");
  return toTicketDto(ticket);
}

export async function createTicket(actor: AuditActor, input: TicketCreateInput): Promise<SecurityTicketDto> {
  const ticket = await prisma.securityTicket.create({
    data: {
      title: input.title,
      summary: input.summary,
      severity: input.severity,
      category: input.category,
      createdBy: "user",
    },
    include: TICKET_INCLUDE,
  });
  await audit(actor, "ticket.create", { type: "ticket", id: ticket.id }, { title: ticket.title });
  return toTicketDto(ticket);
}

export async function patchTicket(actor: AuditActor, id: string, input: TicketPatchInput): Promise<SecurityTicketDto> {
  const ticket = await prisma.securityTicket.findUnique({ where: { id } });
  if (!ticket) throw new ApiError(404, "not_found", "Ticket not found");

  const editsContent =
    input.title !== undefined ||
    input.summary !== undefined ||
    input.severity !== undefined ||
    input.category !== undefined;
  if (editsContent && ticket.createdBy !== "user") {
    throw new ApiError(403, "ai_ticket_readonly", "AI-generated ticket content cannot be edited — close it instead.");
  }

  const data: Prisma.SecurityTicketUpdateInput = {
    title: input.title,
    summary: input.summary,
    severity: input.severity,
    category: input.category,
  };

  let action = "ticket.update";
  if (input.status === "CLOSED" && ticket.status !== "CLOSED") {
    action = "ticket.close";
    data.status = "CLOSED";
    data.closedAt = new Date();
    data.closedBy = actor.userId ? { connect: { id: actor.userId } } : undefined;
    data.resolution = input.resolution ?? null;
  } else if (input.status === "OPEN" && ticket.status !== "OPEN") {
    action = "ticket.reopen";
    data.status = "OPEN";
    data.closedAt = null;
    data.closedBy = { disconnect: true };
    data.resolution = null;
  } else if (input.resolution !== undefined && ticket.status === "CLOSED") {
    data.resolution = input.resolution;
  }

  const updated = await prisma.securityTicket.update({ where: { id }, data, include: TICKET_INCLUDE });
  await audit(actor, action, { type: "ticket", id }, { fields: Object.keys(input) });
  return toTicketDto(updated);
}
