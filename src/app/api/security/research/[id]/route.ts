import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { deleteSecurityResearchPage, getSecurityResearchPage, updateSecurityResearchPage } from "@/lib/security/research-service";
import { updateSecurityResearchPageSchema } from "@/lib/validators/security-research";

type Ctx = { params: Promise<{ id: string }> };

export const dynamic = "force-dynamic";

export const GET = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  await requireUser();
  const { id } = await ctx.params;
  return jsonOk(await getSecurityResearchPage(id));
});

export const PATCH = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const input = updateSecurityResearchPageSchema.parse(await req.json());
  const page = await updateSecurityResearchPage(id, input);
  await audit({ type: "user", userId: user.id }, "security.research.update", { type: "security_research_page", id }, {
    fields: Object.keys(input),
  });
  return jsonOk(page);
});

export const DELETE = handleApi(async (_req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  await deleteSecurityResearchPage(id);
  await audit({ type: "user", userId: user.id }, "security.research.delete", { type: "security_research_page", id });
  return jsonOk({ ok: true as const });
});
