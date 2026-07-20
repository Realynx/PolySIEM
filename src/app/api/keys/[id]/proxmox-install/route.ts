import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { proxmoxInstallSchema } from "@/lib/validators/ssh-keys";
import { installKeyOnProxmoxVm } from "@/lib/services/ssh-keys";

type Ctx = { params: Promise<{ id: string }> };

/** Install this key into a Proxmox VM's cloud-init sshkeys via the PVE API. */
export const POST = handleApi(async (req: NextRequest, ctx: Ctx) => {
  const { user } = await requireUser();
  const { id } = await ctx.params;
  const input = proxmoxInstallSchema.parse(await req.json());
  const result = await installKeyOnProxmoxVm({ type: "user", userId: user.id }, id, input);
  return jsonOk(result);
});
