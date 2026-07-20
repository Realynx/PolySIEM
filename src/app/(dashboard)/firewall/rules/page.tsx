import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { listFirewallAliases, listFirewallRules } from "@/lib/services/inventory";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import {
  RulesExplorer,
  type FirewallAliasDto,
  type FirewallRuleDto,
} from "@/components/integrations-sync/rules-explorer";
import { MobilePage } from "@/components/mobile/ui/mobile-page";
import { MobileFirewallRules } from "@/components/mobile/pages/firewall/mobile-firewall-rules";

export const metadata = { title: "Firewall rules" };

export default async function FirewallRulesPage() {
  await requirePageUser();
  const [rules, aliases] = await anonymizeForDisplay(
    await Promise.all([listFirewallRules(), listFirewallAliases()]),
  );

  const ruleDtos: FirewallRuleDto[] = rules.map((r) => ({
    id: r.id,
    sequence: r.sequence,
    action: r.action,
    interfaceName: r.interfaceName,
    direction: r.direction,
    protocol: r.protocol,
    sourceSpec: r.sourceSpec,
    destSpec: r.destSpec,
    destPort: r.destPort,
    descriptionText: r.descriptionText,
    enabled: r.enabled,
    status: r.status,
    annotation: r.annotation,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }));
  const aliasDtos: FirewallAliasDto[] = aliases.map((a) => ({
    name: a.name,
    aliasType: a.aliasType,
    content: a.content,
  }));

  const empty = (
    <EmptyState
      icon={ShieldCheck}
      title="No firewall rules yet"
      description="Connect an OPNsense integration and run a sync to populate the rule set."
      action={
        <Button asChild>
          <Link href="/settings/integrations">Go to integrations</Link>
        </Button>
      }
    />
  );

  if (await isMobileView()) {
    if (ruleDtos.length === 0) return <MobilePage>{empty}</MobilePage>;
    return <MobileFirewallRules rules={ruleDtos} aliases={aliasDtos} />;
  }

  return <>{ruleDtos.length === 0 ? empty : <RulesExplorer rules={ruleDtos} aliases={aliasDtos} />}</>;
}
