import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { provisionContainer } from "@/lib/services/provisioning";
import { provisionContainerSchema } from "@/lib/validators/provisioning";

export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = provisionContainerSchema.parse(await req.json());
  return jsonOk(await provisionContainer({ type: "user", userId: user.id }, input), { status: 201 });
});
