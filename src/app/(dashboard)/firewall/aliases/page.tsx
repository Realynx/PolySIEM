import Link from "next/link";
import { ListTree } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listFirewallAliases } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AliasesTable, type FirewallAliasRow } from "@/components/integrations-sync/aliases-table";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileFirewallAliases } from "@/components/mobile/pages/firewall/mobile-firewall-aliases";

export const metadata = { title: "Firewall aliases" };

export default async function FirewallAliasesPage() {
  await requirePageUser();
  const aliases = await anonymizeForDisplay(await listFirewallAliases());
  const rows: FirewallAliasRow[] = aliases.map((alias) => ({
    id: alias.id,
    name: alias.name,
    aliasType: alias.aliasType,
    descriptionText: alias.descriptionText,
    status: alias.status,
    content: alias.content,
  }));

  const empty = (
    <EmptyState
      icon={ListTree}
      title="No aliases yet"
      description="Connect an OPNsense integration and run a sync to populate aliases."
      action={
        <Button asChild>
          <Link href="/settings/integrations">Go to integrations</Link>
        </Button>
      }
    />
  );

  if (await isMobileView()) {
    if (rows.length === 0) return <MobilePage>{empty}</MobilePage>;
    return <MobileFirewallAliases aliases={rows} />;
  }

  return <>{rows.length === 0 ? empty : <AliasesTable aliases={rows} />}</>;
}
