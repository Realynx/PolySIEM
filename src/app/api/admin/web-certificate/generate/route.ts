import type { NextRequest } from "next/server";
import { handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { generateWebCertificate, getWebCertificateView } from "@/lib/tls/store";
import { generateWebCertificateSchema } from "@/lib/validators/web-certificate";

/** Generate + activate a fresh self-signed web certificate. */
export const POST = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const input = generateWebCertificateSchema.parse(await req.json().catch(() => ({})));

  const { applied, altNames } = await generateWebCertificate(input);
  await audit({ type: "user", userId: user.id }, "web_certificate.generate", undefined, {
    altNames,
    days: input.days ?? 3650,
  });
  return jsonOk({ ...(await getWebCertificateView()), applied });
});
