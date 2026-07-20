import type { NextRequest } from "next/server";
import { ApiError, handleApi, jsonOk } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/guards";
import { audit } from "@/lib/audit";
import { validateCertificatePair } from "@/lib/tls/inspect";
import { getWebCertificateView, saveWebCertificate } from "@/lib/tls/store";
import { uploadWebCertificateSchema } from "@/lib/validators/web-certificate";

export const GET = handleApi(async () => {
  await requireAdmin();
  return jsonOk(await getWebCertificateView());
});

/** Upload a custom certificate (PEM cert or chain + unencrypted PEM key). */
export const PUT = handleApi(async (req: NextRequest) => {
  const { user } = await requireAdmin();
  const { certPem, keyPem } = uploadWebCertificateSchema.parse(await req.json());

  let info;
  try {
    info = validateCertificatePair(certPem, keyPem);
  } catch (err) {
    throw new ApiError(
      400,
      "invalid_certificate",
      err instanceof Error ? err.message : "The certificate could not be validated.",
    );
  }

  const { applied } = await saveWebCertificate("uploaded", certPem, keyPem);
  await audit({ type: "user", userId: user.id }, "web_certificate.upload", undefined, {
    subject: info.subject,
    fingerprint256: info.fingerprint256,
    notAfter: info.notAfter,
  });
  return jsonOk({ ...(await getWebCertificateView()), applied });
});
