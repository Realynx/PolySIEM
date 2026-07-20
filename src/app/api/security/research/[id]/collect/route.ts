import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { collectSecurityResearch } from "@/lib/security/research-service";
import { collectSecurityResearchSchema } from "@/lib/validators/security-research";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const input = collectSecurityResearchSchema.parse(await req.json().catch(() => ({})));
  const page = await collectSecurityResearch(id, input.hours, input.forceRefresh, input.providers);
  await audit({ type: "user", userId: user.id }, "security.research.collect", { type: "security_research_page", id }, {
    hours: input.hours,
    forceRefresh: input.forceRefresh,
    providers: input.providers ?? ["dns", "polysiem", "elasticsearch", "securitytrails"],
    evidenceCount: page.evidence.length,
  });
  return jsonOk(page);
});
