import Link from "next/link";
import { ListTree } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { listFirewallAliases } from "@/lib/services/inventory";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { AliasesTable, type FirewallAliasRow } from "@/components/integrations-sync/aliases-table";

export const metadata = { title: "Firewall aliases" };

export default async function FirewallAliasesPage() {
  await requirePageUser();
  const aliases = await listFirewallAliases();
  const rows: FirewallAliasRow[] = aliases.map((alias) => ({
    id: alias.id,
    name: alias.name,
    aliasType: alias.aliasType,
    descriptionText: alias.descriptionText,
    status: alias.status,
    content: alias.content,
  }));

  return (
    <>
      {rows.length === 0 ? (
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
      ) : (
        <AliasesTable aliases={rows} />
      )}
    </>
  );
}
