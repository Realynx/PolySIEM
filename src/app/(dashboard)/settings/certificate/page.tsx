import { requirePageAdmin } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { WebCertificateForm } from "@/components/settings/web-certificate-form";
import { MobileSettingsSubpage } from "@/components/mobile/pages/settings/settings-subpage";
import { getWebCertificateView } from "@/lib/tls/store";

export const metadata = { title: "Web certificate" };
export const dynamic = "force-dynamic";

export default async function WebCertificatePage() {
  await requirePageAdmin();
  const view = await getWebCertificateView();

  const form = <WebCertificateForm initial={view} />;

  if (await isMobileView()) {
    return <MobileSettingsSubpage title="Web certificate">{form}</MobileSettingsSubpage>;
  }

  return (
    <div>
      <PageHeader
        title="Web certificate"
        description="The HTTPS certificate PolySIEM serves this dashboard with."
      />
      <div className="space-y-6">{form}</div>
    </div>
  );
}
