import "server-only";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { audit, type AuditActor } from "@/lib/audit";
import { ApiError } from "@/lib/api";
import type { CreateUserInput, UpdateUserInput } from "@/lib/validators/users";

const PUBLIC_USER_SELECT = {
  id: true,
  username: true,
  displayName: true,
  role: true,
  disabled: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function listUsers() {
  return prisma.user.findMany({ select: PUBLIC_USER_SELECT, orderBy: { username: "asc" } });
}

export async function createUser(actor: AuditActor, input: CreateUserInput) {
  const existing = await prisma.user.findUnique({ where: { username: input.username } });
  if (existing) throw new ApiError(409, "conflict", "A user with that username already exists");
  const user = await prisma.user.create({
    data: {
      username: input.username,
      displayName: input.displayName,
      role: input.role,
      passwordHash: await hashPassword(input.password),
    },
    select: PUBLIC_USER_SELECT,
  });
  await audit(actor, "user.create", { type: "user", id: user.id }, { username: user.username });
  return user;
}

export async function updateUser(actor: AuditActor, id: string, input: UpdateUserInput) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "not_found", "User not found");

  // Prevent locking out the last active admin.
  if (user.role === "ADMIN" && (input.role === "USER" || input.disabled === true)) {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", disabled: false, id: { not: id } },
    });
    if (otherAdmins === 0) {
      throw new ApiError(400, "last_admin", "Cannot demote or disable the last active administrator");
    }
  }

  const updated = await prisma.user.update({
    where: { id },
    data: {
      displayName: input.displayName === undefined ? undefined : input.displayName,
      role: input.role,
      disabled: input.disabled,
      passwordHash: input.newPassword ? await hashPassword(input.newPassword) : undefined,
    },
    select: PUBLIC_USER_SELECT,
  });
  if (input.disabled === true || input.newPassword) {
    await prisma.session.deleteMany({ where: { userId: id } });
  }
  await audit(actor, "user.update", { type: "user", id }, { fields: Object.keys(input) });
  return updated;
}

export async function deleteUser(actor: AuditActor, id: string) {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw new ApiError(404, "not_found", "User not found");
  if (user.role === "ADMIN") {
    const otherAdmins = await prisma.user.count({
      where: { role: "ADMIN", disabled: false, id: { not: id } },
    });
    if (otherAdmins === 0) throw new ApiError(400, "last_admin", "Cannot delete the last administrator");
  }
  await prisma.user.delete({ where: { id } });
  await audit(actor, "user.delete", { type: "user", id }, { username: user.username });
}
