import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { createSecurityResearchPage, listSecurityResearchPages } from "@/lib/security/research-service";
import { createSecurityResearchPageSchema } from "@/lib/validators/security-research";

export const dynamic = "force-dynamic";

export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await listSecurityResearchPages());
});

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = createSecurityResearchPageSchema.parse(await req.json());
  const page = await createSecurityResearchPage(input, user.id);
  await audit({ type: "user", userId: user.id }, "security.research.create", { type: "security_research_page", id: page.id }, {
    subject: page.subject,
    subjectType: page.subjectType,
  });
  return jsonOk(page, { status: 201 });
});
