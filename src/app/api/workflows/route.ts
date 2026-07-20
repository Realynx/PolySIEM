import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin, requireUser } from "@/lib/auth/guards";
import { createWorkflowSchema } from "@/lib/workflows/schemas";
import { createWorkflow, listWorkflows } from "@/lib/workflows/service";

export const dynamic = "force-dynamic";

/** GET /api/workflows — all workflows with their last run. */
export const GET = handleApi(async () => {
  await requireUser();
  return jsonOk(await listWorkflows());
});

/** POST /api/workflows — create a workflow (admin). Drafts with logical graph issues are allowed; validate/run enforce them. */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = createWorkflowSchema.parse(await req.json());
  const workflow = await createWorkflow({ type: "user", userId: user.id }, input);
  return jsonOk(workflow, { status: 201 });
});
