import "server-only";
import { prisma } from "@/lib/db";

export interface AuditActor {
  type: "user" | "api_token" | "system";
  userId?: string;
  apiTokenId?: string;
}

/** Record an audit event. Never throws — auditing must not break mutations. */
export async function audit(
  actor: AuditActor,
  action: string,
  entity?: { type: string; id: string },
  detail?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorType: actor.type,
        userId: actor.userId,
        apiTokenId: actor.apiTokenId,
        action,
        entityType: entity?.type,
        entityId: entity?.id,
        detail: detail as object | undefined,
      },
    });
  } catch (err) {
    console.error("audit log write failed:", err);
  }
}
