import { isMobileView } from "@/lib/device";
import { PageHeader } from "@/components/shared/page-header";
import { FirewallTabs } from "@/components/firewall/firewall-tabs";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileSegmented } from "@/components/mobile/ui/mobile-segmented";

export default async function FirewallLayout({ children }: { children: React.ReactNode }) {
  if (await isMobileView()) {
    return (
      <div>
        <MobilePageHeader title="Firewall">
          <MobileSegmented
            items={[
              { label: "Overview", href: "/firewall" },
              { label: "Rules", href: "/firewall/rules" },
              { label: "Aliases", href: "/firewall/aliases" },
            ]}
          />
        </MobilePageHeader>
        {children}
      </div>
    );
  }
  return (
    <div>
      <PageHeader
        title="Firewall"
        description="Policy posture, exposure, and traffic evidence from every connected firewall provider"
      />
      <FirewallTabs />
      {children}
    </div>
  );
}
