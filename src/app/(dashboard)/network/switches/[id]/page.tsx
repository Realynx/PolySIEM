import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/lib/auth/guards";
import { isMobileView } from "@/lib/device";
import { getSwitch } from "@/lib/services/switches";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { expandVlanSpec } from "@/lib/switch/cisco";
import { formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EntityLink, SectionCard } from "@/components/inventory/detail-bits";
import { RawConfig } from "@/components/switches/raw-config";
import { MobileSwitchDetail } from "@/components/mobile/pages/network-edge/mobile-switch-detail";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

type SwitchDetail = Awaited<ReturnType<typeof getSwitch>>;
type SwitchPort = SwitchDetail["ports"][number];

const VENDOR_LABELS: Record<string, string> = { "cisco-ios": "Cisco IOS" };

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sw = await anonymizeForDisplay(await getSwitch(id).catch(() => null));
  return { title: sw?.device.name ?? "Switch" };
}

function ModeBadge({ mode }: { mode: string | null }) {
  if (mode === "access") return <Badge variant="secondary">access</Badge>;
  if (mode === "trunk") return <Badge>trunk</Badge>;
  if (mode === "routed") return <Badge variant="outline">routed</Badge>;
  return (
    <Badge variant="outline" className="text-muted-foreground">
      unknown
    </Badge>
  );
}

/** Allowed-VLAN spec for a trunk: compact badges when small, raw spec otherwise. */
function AllowedVlans({ spec }: { spec: string | null }) {
  if (spec === null) return <span className="text-muted-foreground">all VLANs</span>;
  const ids = expandVlanSpec(spec);
  if (ids.length > 0 && ids.length <= 12) {
    return (
      <span className="inline-flex flex-wrap gap-1">
        {ids.map((id) => (
          <Badge key={id} variant="outline" className="px-1.5 font-mono tabular-nums">
            {id}
          </Badge>
        ))}
      </span>
    );
  }
  return <span className="font-mono text-xs">{spec}</span>;
}

function DeviceLink({ device }: { device: { id: string; name: string } | null }) {
  if (!device) return <span className="text-muted-foreground">—</span>;
  return <EntityLink href={`/inventory/hosts/${device.id}`}>{device.name}</EntityLink>;
}

/** Access/voice VLAN summary for a physical port row. */
function PortVlans({ port }: { port: SwitchPort }) {
  if (port.mode === "routed" && port.ipAddress) {
    return <span className="font-mono text-xs">{port.ipAddress}</span>;
  }
  if (port.mode === "trunk") return <AllowedVlans spec={port.allowedVlans} />;
  if (port.accessVlanId == null && port.voiceVlanId == null) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span className="tabular-nums">
      {port.accessVlanId ?? "—"}
      {port.voiceVlanId != null && (
        <span className="text-muted-foreground"> · voice {port.voiceVlanId}</span>
      )}
    </span>
  );
}

function PortChannelCard({ channel, members }: { channel: SwitchPort; members: SwitchPort[] }) {
  return (
    <Card className={cn("gap-3 py-4", channel.isShutdown && "opacity-60")}>
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold">{channel.shortName}</span>
          {channel.description && (
            <span className="text-sm text-muted-foreground">· {channel.description}</span>
          )}
          <ModeBadge mode={channel.mode} />
          {channel.isShutdown && <Badge variant="destructive">shut</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {channel.mode === "trunk" && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">allowed</span>
              <AllowedVlans spec={channel.allowedVlans} />
            </span>
          )}
          {channel.nativeVlanId != null && (
            <span className="text-muted-foreground">
              native <span className="font-medium text-foreground tabular-nums">{channel.nativeVlanId}</span>
            </span>
          )}
          {channel.mode === "access" && channel.accessVlanId != null && (
            <span className="text-muted-foreground">
              VLAN <span className="font-medium text-foreground tabular-nums">{channel.accessVlanId}</span>
            </span>
          )}
          {channel.ipAddress && <span className="font-mono text-xs">{channel.ipAddress}</span>}
          <span className="flex items-center gap-1.5">
            <span className="text-muted-foreground">connected to</span>
            <DeviceLink device={channel.connectedDevice} />
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-4">
        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No member ports found in the config.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {members.map((member) => (
              <li
                key={member.id}
                className={cn(
                  "flex flex-wrap items-center gap-2 px-3 py-2 text-sm",
                  member.isShutdown && "opacity-60",
                )}
              >
                <span className="font-mono text-xs font-medium">{member.shortName}</span>
                {member.description && (
                  <span className="truncate text-muted-foreground">{member.description}</span>
                )}
                <span className="ml-auto flex items-center gap-1.5">
                  {member.isShutdown && <Badge variant="destructive">shut</Badge>}
                  {member.channelMode && (
                    <Badge variant="outline" className="text-muted-foreground">
                      {member.channelMode}
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default async function SwitchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requirePageUser();
  const { id } = await params;
  const found = await getSwitch(id).catch(() => null);
  if (!found) notFound();
  const sw = await anonymizeForDisplay(found);

  const portChannels = sw.ports.filter((p) => p.isPortChannel);
  const channelGroups = new Set(
    portChannels
      .map((p) => /(\d+)$/.exec(p.shortName)?.[1])
      .filter((n): n is string => n !== undefined)
      .map(Number),
  );
  const membersOf = (channel: SwitchPort) => {
    const group = /(\d+)$/.exec(channel.shortName)?.[1];
    if (group === undefined) return [];
    return sw.ports.filter((p) => !p.isPortChannel && p.channelGroup === Number(group));
  };
  const physicalPorts = sw.ports.filter(
    (p) => !p.isPortChannel && (p.channelGroup === null || !channelGroups.has(p.channelGroup)),
  );

  if (await isMobileView()) {
    return (
      <MobileSwitchDetail
        sw={sw}
        portChannels={portChannels}
        physicalPorts={physicalPorts}
        membersOf={membersOf}
      />
    );
  }

  return (
    <div>
      <PageHeader title={sw.device.name} description={sw.hostname ?? undefined}>
        <div className="-mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{VENDOR_LABELS[sw.vendor] ?? sw.vendor}</Badge>
          {sw.hostname && (
            <Badge variant="outline" className="font-mono text-xs">
              {sw.hostname}
            </Badge>
          )}
        </div>
      </PageHeader>

      <div className="space-y-6">
        <SectionCard title="VLANs" count={sw.vlans.length} flush>
          {sw.vlans.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">No VLANs found in this config.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">VLAN</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden sm:table-cell">SVI address</TableHead>
                  <TableHead>Network</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sw.vlans.map((vlan) => (
                  <TableRow key={vlan.id}>
                    <TableCell className="font-medium tabular-nums">{vlan.vlanId}</TableCell>
                    <TableCell>
                      {vlan.name ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden font-mono text-xs sm:table-cell">
                      {vlan.svIpAddress ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {vlan.network ? (
                        <EntityLink href={`/network/${vlan.network.id}`}>
                          {vlan.network.name}
                          {vlan.network.cidr && (
                            <span className="ml-1.5 font-mono text-xs text-muted-foreground">
                              {vlan.network.cidr}
                            </span>
                          )}
                        </EntityLink>
                      ) : (
                        <span className="text-muted-foreground">— not synced</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        {portChannels.length > 0 && (
          <div className="space-y-4">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              Port-channels
              <Badge variant="secondary" className="tabular-nums">
                {portChannels.length}
              </Badge>
            </h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {portChannels.map((channel) => (
                <PortChannelCard key={channel.id} channel={channel} members={membersOf(channel)} />
              ))}
            </div>
          </div>
        )}

        <SectionCard title="Ports" count={physicalPorts.length} flush>
          {physicalPorts.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              Every physical port belongs to a port-channel above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Port</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead className="hidden sm:table-cell">VLAN</TableHead>
                  <TableHead>Connected device</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {physicalPorts.map((port) => (
                  <TableRow key={port.id} className={cn(port.isShutdown && "opacity-60")}>
                    <TableCell className="font-mono text-xs font-medium">
                      <span className="flex items-center gap-1.5">
                        {port.shortName}
                        {port.isShutdown && <Badge variant="destructive">shut</Badge>}
                      </span>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {port.description ?? "—"}
                    </TableCell>
                    <TableCell>
                      <ModeBadge mode={port.mode} />
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <PortVlans port={port} />
                    </TableCell>
                    <TableCell>
                      <DeviceLink device={port.connectedDevice} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </SectionCard>

        <RawConfig rawConfig={sw.rawConfig} />

        <p className="text-xs text-muted-foreground">
          Parsed {formatRelative(sw.parsedAt)} — repaste the config to update.
        </p>
      </div>
    </div>
  );
}
