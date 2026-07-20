import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth/guards";
import { generateSshKeySchema } from "@/lib/validators/ssh-keys";
import { generateSshKey } from "@/lib/services/ssh-keys";
import { toJsonSafe } from "@/lib/serialize";

/**
 * Generate an ed25519 keypair. The response is the ONLY place the private key
 * ever exists — it is not stored, logged, or recoverable afterwards.
 */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireUser();
  const input = generateSshKeySchema.parse(await req.json());
  const { key, privateKeyPem } = await generateSshKey({ type: "user", userId: user.id }, input);
  return jsonOk({ key: toJsonSafe(key), privateKeyPem });
});
