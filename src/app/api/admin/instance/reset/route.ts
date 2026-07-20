import { NextResponse, type NextRequest } from "next/server";
import { ApiError, handleApi } from "@/lib/api";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { clearInstance } from "@/lib/instance/reset";
import { instanceActionSchema } from "@/lib/validators/instance";
import { MODE_COOKIE, THEME_COOKIE } from "@/lib/theme";

export const POST = handleApi(async (req: NextRequest) => {
  const session = await requireAdmin();
  const input = instanceActionSchema.parse(await req.json());
  const admin = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { passwordHash: true },
  });

  if (!admin || !(await verifyPassword(input.password, admin.passwordHash))) {
    throw new ApiError(403, "invalid_credentials", "Your administrator password is incorrect");
  }

  await clearInstance(input.action, session.user.id, session.sessionId);

  const response = NextResponse.json({
    data: {
      ok: true,
      action: input.action,
      redirectTo: input.action === "reinstall" ? "/setup" : "/",
    },
  });

  if (input.action === "reinstall") {
    response.cookies.delete(SESSION_COOKIE);
    response.cookies.delete(THEME_COOKIE);
    response.cookies.delete(MODE_COOKIE);
  }
  return response;
});
