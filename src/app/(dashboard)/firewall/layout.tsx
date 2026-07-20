import { PageHeader } from "@/components/shared/page-header";
import { FirewallTabs } from "@/components/firewall/firewall-tabs";

export default function FirewallLayout({ children }: { children: React.ReactNode }) {
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
