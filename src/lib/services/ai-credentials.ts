import "server-only";
import { Prisma, type AiCredential } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import type {
  CreateAiCredentialInput,
  UpdateAiCredentialInput,
} from "@/lib/validators/ai-credentials";

/**
 * Public shape — the secret is NEVER included (encrypted or otherwise), only
 * its presence and plaintext length.
 */
export type SanitizedAiCredential = Omit<AiCredential, "encryptedSecret"> & {
  hasSecret: true;
  secretLength: number;
};

function sanitize(row: AiCredential): SanitizedAiCredential {
  const { encryptedSecret, ...rest } = row;
  return { ...rest, hasSecret: true, secretLength: decryptSecret(encryptedSecret).length };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

async function getRow(id: string): Promise<AiCredential> {
  const row = await prisma.aiCredential.findUnique({ where: { id } });
  if (!row) throw new ApiError(404, "not_found", "AI credential not found");
  return row;
}

export async function listAiCredentials(): Promise<SanitizedAiCredential[]> {
  const rows = await prisma.aiCredential.findMany({ orderBy: { name: "asc" } });
  return rows.map(sanitize);
}

export async function createAiCredential(
  actor: AuditActor,
  input: CreateAiCredentialInput,
): Promise<SanitizedAiCredential> {
  try {
    const row = await prisma.aiCredential.create({
      data: {
        name: input.name,
        description: input.description?.trim() || null,
        username: input.username?.trim() || null,
        url: input.url?.trim() || null,
        encryptedSecret: encryptSecret(input.secret),
      },
    });
    // Never put the secret value in audit detail — only the name.
    await audit(actor, "ai_credential.create", { type: "ai_credential", id: row.id }, {
      name: row.name,
    });
    return sanitize(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "duplicate", `An AI credential named "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function updateAiCredential(
  actor: AuditActor,
  id: string,
  input: UpdateAiCredentialInput,
): Promise<SanitizedAiCredential> {
  await getRow(id); // 404 before attempting the update
  const data: Prisma.AiCredentialUpdateInput = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
    ...(input.username !== undefined ? { username: input.username?.trim() || null } : {}),
    ...(input.url !== undefined ? { url: input.url?.trim() || null } : {}),
    // Absent secret = keep the stored one.
    ...(input.secret !== undefined ? { encryptedSecret: encryptSecret(input.secret) } : {}),
  };
  try {
    const row = await prisma.aiCredential.update({ where: { id }, data });
    await audit(actor, "ai_credential.update", { type: "ai_credential", id }, {
      name: row.name,
      fields: Object.keys(input).filter(
        (k) => input[k as keyof UpdateAiCredentialInput] !== undefined && k !== "secret",
      ),
      secretRotated: input.secret !== undefined,
    });
    return sanitize(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ApiError(409, "duplicate", `An AI credential named "${input.name}" already exists`);
    }
    throw err;
  }
}

export async function deleteAiCredential(actor: AuditActor, id: string): Promise<void> {
  const existing = await getRow(id);
  await prisma.aiCredential.delete({ where: { id } });
  await audit(actor, "ai_credential.delete", { type: "ai_credential", id }, {
    name: existing.name,
  });
}

/**
 * Decrypt a credential for an AI assistant, addressed by name (the MCP lookup
 * key). Every call writes an `ai_credential.read` audit row carrying the
 * actor's token/user id and the credential NAME (never the value) — this is
 * the security-critical audit trail for secret access.
 */
export async function readCredentialSecret(name: string, actor: AuditActor) {
  const row = await prisma.aiCredential.findUnique({ where: { name } });
  if (!row) throw new ApiError(404, "not_found", `No AI credential named "${name}"`);
  await audit(actor, "ai_credential.read", { type: "ai_credential", id: row.id }, {
    name: row.name,
  });
  return {
    name: row.name,
    description: row.description,
    username: row.username,
    url: row.url,
    secret: decryptSecret(row.encryptedSecret),
  };
}
