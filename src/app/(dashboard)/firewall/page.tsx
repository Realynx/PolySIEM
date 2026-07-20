import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Cable,
  DoorOpen,
  ListTree,
  Network,
  Radio,
  Router,
  Shield,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { prisma } from "@/lib/db";
import { requirePageUser } from "@/lib/auth/guards";
import { formatRelative } from "@/lib/format";
import { FirewallTrafficDashboard, type FirewallTrafficProvider } from "@/components/firewall/firewall-traffic-dashboard";
import { EmptyState } from "@/components/shared/empty-state";
import { SyncStatusBadge } from "@/components/shared/badges";
import { SyncNowButton } from "@/components/integrations-sync/sync-now-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = { title: "Firewall" };

interface ActionCounts {
  PASS: number;
  BLOCK: number;
  REJECT: number;
}

function emptyActions(): ActionCounts {
  return { PASS: 0, BLOCK: 0, REJECT: 0 };
}

function providerName(type: string): string {
  if (type === "OPNSENSE") return "OPNsense";
  if (type === "UNIFI") return "UniFi";
  return type.replaceAll("_", " ");
}

export default async function FirewallOverviewPage() {
  const { user } = await requirePageUser();
  const integrations = await prisma.integrationConfig.findMany({
    where: {
      OR: [
        { type: "OPNSENSE" },
        { firewallRules: { some: { status: { not: "REMOVED" } } } },
        { portForwards: { some: { status: { not: "REMOVED" } } } },
        { trafficSamples: { some: {} } },
      ],
    },
    orderBy: [{ enabled: "desc" }, { name: "asc" }],
  });

  if (integrations.length === 0) {
    return (
      <EmptyState
        icon={Shield}
        title="No firewall integration configured"
        description="Connect OPNsense to synchronize policy and traffic evidence. Other firewall providers, including UniFi, can feed the same overview as collectors become available."
        action={<Button asChild><Link href="/settings/integrations">Add an integration</Link></Button>}
      />
    );
  }

  const providers = await Promise.all(integrations.map(async (integration) => {
    const where = { integrationId: integration.id, status: { not: "REMOVED" as const } };
    const [byAction, byInterface, rules, aliasCount, leaseCount, networkCount, publishedPorts, unrestrictedPorts, gateways, trafficSampleCount] = await Promise.all([
      prisma.firewallRule.groupBy({ by: ["action"], where: { ...where, enabled: true }, _count: { _all: true } }),
      prisma.firewallRule.groupBy({ by: ["interfaceName", "action"], where: { ...where, enabled: true }, _count: { _all: true } }),
      prisma.firewallRule.findMany({ where: { ...where, enabled: true, externalId: { not: null } }, select: { externalId: true, descriptionText: true, interfaceName: true, action: true } }),
      prisma.firewallAlias.count({ where }),
      prisma.dhcpLease.count({ where }),
      prisma.network.count({ where }),
      prisma.portForward.count({ where: { ...where, enabled: true } }),
      prisma.portForward.count({ where: { ...where, enabled: true, OR: [{ sourceSpec: null }, { sourceSpec: "" }] } }),
      prisma.networkGateway.findMany({ where, select: { name: true, online: true, isDefault: true } }),
      prisma.trafficCounterSample.count({ where: { integrationId: integration.id } }),
    ]);
    const actions = emptyActions();
    for (const row of byAction) actions[row.action] = row._count._all;
    const interfaces = new Map<string, ActionCounts>();
    for (const row of byInterface) {
      const name = row.interfaceName || "Unassigned";
      const counts = interfaces.get(name) ?? emptyActions();
      counts[row.action] += row._count._all;
      interfaces.set(name, counts);
    }
    return {
      integration,
      actions,
      interfaces: [...interfaces.entries()].map(([name, counts]) => ({ name, ...counts, total: counts.PASS + counts.BLOCK + counts.REJECT })).sort((a, b) => b.total - a.total),
      rules,
      aliasCount,
      leaseCount,
      networkCount,
      publishedPorts,
      unrestrictedPorts,
      gateways,
      trafficSampleCount,
    };
  }));

  const totals = providers.reduce((summary, provider) => ({
    actions: {
      PASS: summary.actions.PASS + provider.actions.PASS,
      BLOCK: summary.actions.BLOCK + provider.actions.BLOCK,
      REJECT: summary.actions.REJECT + provider.actions.REJECT,
    },
    aliases: summary.aliases + provider.aliasCount,
    leases: summary.leases + provider.leaseCount,
    networks: summary.networks + provider.networkCount,
    publishedPorts: summary.publishedPorts + provider.publishedPorts,
    unrestrictedPorts: summary.unrestrictedPorts + provider.unrestrictedPorts,
  }), { actions: emptyActions(), aliases: 0, leases: 0, networks: 0, publishedPorts: 0, unrestrictedPorts: 0 });
  const totalRules = totals.actions.PASS + totals.actions.BLOCK + totals.actions.REJECT;
  const blockedRules = totals.actions.BLOCK + totals.actions.REJECT;
  const interfaceTotals = new Map<string, ActionCounts>();
  for (const provider of providers) for (const iface of provider.interfaces) {
    const counts = interfaceTotals.get(iface.name) ?? emptyActions();
    counts.PASS += iface.PASS;
    counts.BLOCK += iface.BLOCK;
    counts.REJECT += iface.REJECT;
    interfaceTotals.set(iface.name, counts);
  }
  const interfaces = [...interfaceTotals.entries()].map(([name, counts]) => ({ name, ...counts, total: counts.PASS + counts.BLOCK + counts.REJECT })).sort((a, b) => b.total - a.total).slice(0, 8);
  const maxInterfaceRules = Math.max(1, ...interfaces.map((iface) => iface.total));
  const trafficProviders: FirewallTrafficProvider[] = providers.filter((provider) =>
    provider.integration.enabled && (provider.integration.type === "OPNSENSE" || provider.trafficSampleCount > 0),
  ).map((provider) => ({
    id: provider.integration.id,
    name: provider.integration.name,
    type: provider.integration.type,
    rules: provider.rules.flatMap((rule) => rule.externalId ? [{ externalId: rule.externalId, label: rule.descriptionText || `${rule.action} · ${rule.interfaceName || "any interface"}` }] : []),
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <MetricCard icon={ShieldCheck} label="Synchronized rules" value={totalRules} detail={`${providers.length} provider${providers.length === 1 ? "" : "s"}`} />
        <MetricCard icon={ShieldX} label="Block or reject" value={blockedRules} detail={totalRules ? `${Math.round((blockedRules / totalRules) * 100)}% of policy` : "No policy found"} tone="danger" />
        <MetricCard icon={DoorOpen} label="Published ports" value={totals.publishedPorts} detail={`${totals.unrestrictedPorts} allow any source`} tone={totals.unrestrictedPorts > 0 ? "warning" : "default"} />
        <MetricCard icon={Radio} label="Known clients" value={totals.leases} detail="Active DHCP evidence" />
        <MetricCard icon={ListTree} label="Aliases" value={totals.aliases} detail="Named policy groups" />
        <MetricCard icon={Network} label="Networks" value={totals.networks} detail={`${interfaces.length} filtered interfaces`} />
      </div>

      {trafficProviders.length > 0 && <FirewallTrafficDashboard providers={trafficProviders} />}

      <div className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader>
            <CardTitle>Rule posture</CardTitle>
            <CardDescription>What the synchronized policy is designed to do.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-6 sm:flex-row">
            <PolicyDonut actions={totals.actions} />
            <div className="w-full space-y-3">
              <PolicyLegend color="bg-chart-2" label="Pass" value={totals.actions.PASS} total={totalRules} />
              <PolicyLegend color="bg-chart-5" label="Block" value={totals.actions.BLOCK} total={totalRules} />
              <PolicyLegend color="bg-chart-4" label="Reject" value={totals.actions.REJECT} total={totalRules} />
              <Button asChild variant="outline" size="sm" className="mt-2 w-full"><Link href="/firewall/rules">Inspect policy rules <ArrowRight /></Link></Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Policy density by interface</CardTitle>
            <CardDescription>Enabled rules grouped by their enforcement surface.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {interfaces.length === 0 ? <p className="py-10 text-center text-sm text-muted-foreground">No interface-specific rules were synchronized.</p> : interfaces.map((iface) => (
              <div key={iface.name} className="grid grid-cols-[7rem_minmax(0,1fr)_2.5rem] items-center gap-3 text-sm">
                <span className="truncate font-medium" title={iface.name}>{iface.name}</span>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-muted" title={`${iface.PASS} pass, ${iface.BLOCK} block, ${iface.REJECT} reject`}>
                  <span className="bg-chart-2" style={{ width: `${(iface.PASS / maxInterfaceRules) * 100}%` }} />
                  <span className="bg-chart-5" style={{ width: `${(iface.BLOCK / maxInterfaceRules) * 100}%` }} />
                  <span className="bg-chart-4" style={{ width: `${(iface.REJECT / maxInterfaceRules) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums text-muted-foreground">{iface.total}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3" aria-labelledby="firewall-providers-heading">
        <div>
          <h2 id="firewall-providers-heading" className="text-lg font-semibold">Firewall providers</h2>
          <p className="text-sm text-muted-foreground">Health and inventory coverage for every integration contributing firewall evidence.</p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {providers.map((provider) => (
            <Card key={provider.integration.id} size="sm">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Router className="size-4" /></div>
                    <div><CardTitle>{provider.integration.name}</CardTitle><CardDescription>{providerName(provider.integration.type)} · last sync {formatRelative(provider.integration.lastSyncAt)}</CardDescription></div>
                  </div>
                  <div className="flex items-center gap-2"><SyncStatusBadge status={provider.integration.lastSyncStatus} />{user.role === "ADMIN" && <SyncNowButton integrationId={provider.integration.id} name={provider.integration.name} />}</div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <ProviderFact icon={Shield} label="Rules" value={provider.actions.PASS + provider.actions.BLOCK + provider.actions.REJECT} />
                  <ProviderFact icon={Cable} label="Interfaces" value={provider.interfaces.length} />
                  <ProviderFact icon={DoorOpen} label="Published" value={provider.publishedPorts} />
                  <ProviderFact icon={Activity} label="Gateways up" value={provider.gateways.filter((gateway) => gateway.online === true).length} />
                </div>
                {provider.integration.lastSyncError && <p className="mt-3 text-xs text-destructive">{provider.integration.lastSyncError}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value, detail, tone = "default" }: { icon: typeof Shield; label: string; value: number; detail: string; tone?: "default" | "warning" | "danger" }) {
  return <Card size="sm"><CardContent><div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">{label}</span><Icon className={tone === "danger" ? "size-4 text-destructive" : tone === "warning" ? "size-4 text-warning" : "size-4 text-muted-foreground"} /></div><p className="mt-1 text-2xl font-semibold tabular-nums">{value.toLocaleString()}</p><p className="truncate text-xs text-muted-foreground" title={detail}>{detail}</p></CardContent></Card>;
}

function PolicyDonut({ actions }: { actions: ActionCounts }) {
  const total = actions.PASS + actions.BLOCK + actions.REJECT;
  const pass = total ? (actions.PASS / total) * 100 : 0;
  const block = total ? (actions.BLOCK / total) * 100 : 0;
  const background = total
    ? `conic-gradient(var(--color-chart-2) 0 ${pass}%, var(--color-chart-5) ${pass}% ${pass + block}%, var(--color-chart-4) ${pass + block}% 100%)`
    : "var(--color-muted)";
  return <div className="relative size-40 shrink-0 rounded-full" style={{ background }}><div className="absolute inset-5 flex flex-col items-center justify-center rounded-full bg-card"><span className="text-3xl font-semibold tabular-nums">{total}</span><span className="text-xs text-muted-foreground">active rules</span></div></div>;
}

function PolicyLegend({ color, label, value, total }: { color: string; label: string; value: number; total: number }) {
  return <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-sm"><span className={`size-2.5 rounded-full ${color}`} />{label}</span><span className="text-sm tabular-nums"><strong>{value}</strong><span className="ml-2 text-xs text-muted-foreground">{total ? Math.round((value / total) * 100) : 0}%</span></span></div>;
}

function ProviderFact({ icon: Icon, label, value }: { icon: typeof Shield; label: string; value: number }) {
  return <div className="rounded-md border bg-muted/20 p-2.5"><span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="size-3.5" />{label}</span><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>;
}
