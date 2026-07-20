import { DoorOpen, ListTree, Network, Radio, ShieldCheck, ShieldX } from "lucide-react";
import { formatRelative } from "@/lib/format";
import { SyncStatusBadge } from "@/components/shared/badges";
import { SyncNowButton } from "@/components/integrations-sync/sync-now-button";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import { MobileStat, MobileStatStrip } from "@/components/mobile/ui/mobile-stats";
import type { SyncStatusValue } from "@/lib/types";

interface ActionCounts {
  PASS: number;
  BLOCK: number;
  REJECT: number;
}

interface OverviewInterface {
  name: string;
  PASS: number;
  BLOCK: number;
  REJECT: number;
  total: number;
}

interface OverviewProvider {
  integration: {
    id: string;
    name: string;
    type: string;
    lastSyncAt: Date | null;
    lastSyncStatus: SyncStatusValue | null;
    lastSyncError: string | null;
  };
  actions: ActionCounts;
  interfaces: OverviewInterface[];
  publishedPorts: number;
  gateways: { name: string; online: boolean | null; isDefault: boolean }[];
}

interface MobileFirewallOverviewProps {
  isAdmin: boolean;
  providers: OverviewProvider[];
  totals: {
    actions: ActionCounts;
    aliases: number;
    leases: number;
    networks: number;
    publishedPorts: number;
    unrestrictedPorts: number;
  };
  totalRules: number;
  blockedRules: number;
  interfaces: OverviewInterface[];
  maxInterfaceRules: number;
  providerName: (type: string) => string;
}

/** Phone presentation of the firewall overview: stat strip, posture, providers. */
export function MobileFirewallOverview({
  isAdmin,
  providers,
  totals,
  totalRules,
  blockedRules,
  interfaces,
  maxInterfaceRules,
  providerName,
}: MobileFirewallOverviewProps) {
  return (
    <MobilePage>
      <MobileStatStrip>
        <MobileStat label="Rules" value={totalRules.toLocaleString()} icon={<ShieldCheck />} />
        <MobileStat
          label="Block"
          value={blockedRules.toLocaleString()}
          icon={<ShieldX />}
          tone={blockedRules > 0 ? "text-destructive" : undefined}
        />
        <MobileStat
          label="Published"
          value={totals.publishedPorts.toLocaleString()}
          icon={<DoorOpen />}
          tone={totals.unrestrictedPorts > 0 ? "text-warning" : undefined}
        />
        <MobileStat label="Clients" value={totals.leases.toLocaleString()} icon={<Radio />} />
        <MobileStat label="Aliases" value={totals.aliases.toLocaleString()} icon={<ListTree />} />
        <MobileStat label="Networks" value={totals.networks.toLocaleString()} icon={<Network />} />
      </MobileStatStrip>

      <MobileSection title="Rule posture">
        <div className="flex flex-col gap-2.5 rounded-xl border bg-card px-3.5 py-3">
          <div className="flex h-2 overflow-hidden rounded-full bg-muted">
            {totalRules > 0 && (
              <>
                <span className="bg-chart-2" style={{ width: `${(totals.actions.PASS / totalRules) * 100}%` }} />
                <span className="bg-chart-5" style={{ width: `${(totals.actions.BLOCK / totalRules) * 100}%` }} />
                <span className="bg-chart-4" style={{ width: `${(totals.actions.REJECT / totalRules) * 100}%` }} />
              </>
            )}
          </div>
          <PostureLegend color="bg-chart-2" label="Pass" value={totals.actions.PASS} total={totalRules} />
          <PostureLegend color="bg-chart-5" label="Block" value={totals.actions.BLOCK} total={totalRules} />
          <PostureLegend color="bg-chart-4" label="Reject" value={totals.actions.REJECT} total={totalRules} />
        </div>
      </MobileSection>

      <MobileSection title="Rules by interface">
        {interfaces.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            No interface-specific rules were synchronized.
          </p>
        ) : (
          <div className="flex flex-col gap-2.5 rounded-xl border bg-card px-3.5 py-3">
            {interfaces.map((iface) => (
              <div key={iface.name} className="grid grid-cols-[5.5rem_minmax(0,1fr)_2rem] items-center gap-2.5 text-xs">
                <span className="truncate font-medium" title={iface.name}>
                  {iface.name}
                </span>
                <div
                  className="flex h-2 overflow-hidden rounded-full bg-muted"
                  title={`${iface.PASS} pass, ${iface.BLOCK} block, ${iface.REJECT} reject`}
                >
                  <span className="bg-chart-2" style={{ width: `${(iface.PASS / maxInterfaceRules) * 100}%` }} />
                  <span className="bg-chart-5" style={{ width: `${(iface.BLOCK / maxInterfaceRules) * 100}%` }} />
                  <span className="bg-chart-4" style={{ width: `${(iface.REJECT / maxInterfaceRules) * 100}%` }} />
                </div>
                <span className="text-right text-muted-foreground tabular-nums">{iface.total}</span>
              </div>
            ))}
          </div>
        )}
      </MobileSection>

      <MobileSection title="Providers">
        <MobileList>
          {providers.map((provider) => {
            const ruleCount = provider.actions.PASS + provider.actions.BLOCK + provider.actions.REJECT;
            const gatewaysUp = provider.gateways.filter((gateway) => gateway.online === true).length;
            return (
              <MobileListRow
                key={provider.integration.id}
                title={
                  <>
                    <span className="truncate">{provider.integration.name}</span>
                    <SyncStatusBadge status={provider.integration.lastSyncStatus} className="text-[10px]" />
                  </>
                }
                subtitle={
                  <>
                    {providerName(provider.integration.type)} · {ruleCount} rules · {provider.publishedPorts} published ·{" "}
                    {gatewaysUp} gw up · synced {formatRelative(provider.integration.lastSyncAt)}
                    {provider.integration.lastSyncError && (
                      <span className="block truncate text-destructive">{provider.integration.lastSyncError}</span>
                    )}
                  </>
                }
                trailing={
                  isAdmin ? (
                    <SyncNowButton integrationId={provider.integration.id} name={provider.integration.name} />
                  ) : undefined
                }
              />
            );
          })}
        </MobileList>
      </MobileSection>
    </MobilePage>
  );
}

function PostureLegend({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="flex items-center gap-2">
        <span className={`size-2 rounded-full ${color}`} />
        {label}
      </span>
      <span className="tabular-nums">
        <strong>{value}</strong>
        <span className="ml-1.5 text-muted-foreground">{total ? Math.round((value / total) * 100) : 0}%</span>
      </span>
    </div>
  );
}
