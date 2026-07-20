import { formatRelative } from "@/lib/format";
import type { getSwitch } from "@/lib/services/switches";
import { Badge } from "@/components/ui/badge";
import { RawConfig } from "@/components/switches/raw-config";
import { MobilePage, MobileSection } from "@/components/mobile/ui/mobile-page";
import { MobilePageHeader } from "@/components/mobile/ui/mobile-page-header";
import { MobileList, MobileListRow } from "@/components/mobile/ui/mobile-list";
import {
  MobileSwitchPorts,
  type MobileSwitchPort,
} from "@/components/mobile/pages/network-edge/mobile-switch-ports";

type SwitchDetail = Awaited<ReturnType<typeof getSwitch>>;
type SwitchPort = SwitchDetail["ports"][number];

const VENDOR_LABELS: Record<string, string> = { "cisco-ios": "Cisco IOS" };

function toPortDto(port: SwitchPort): MobileSwitchPort {
  return {
    id: port.id,
    shortName: port.shortName,
    name: port.name,
    description: port.description,
    mode: port.mode,
    accessVlanId: port.accessVlanId,
    voiceVlanId: port.voiceVlanId,
    nativeVlanId: port.nativeVlanId,
    allowedVlans: port.allowedVlans,
    channelGroup: port.channelGroup,
    channelMode: port.channelMode,
    isPortChannel: port.isPortChannel,
    isShutdown: port.isShutdown,
    ipAddress: port.ipAddress,
    connectedDevice: port.connectedDevice ? { id: port.connectedDevice.id, name: port.connectedDevice.name } : null,
  };
}

/** Phone presentation of one parsed switch: VLANs, port-channels, ports. */
export function MobileSwitchDetail({
  sw,
  portChannels,
  physicalPorts,
  membersOf,
}: {
  sw: SwitchDetail;
  portChannels: SwitchPort[];
  physicalPorts: SwitchPort[];
  membersOf: (channel: SwitchPort) => SwitchPort[];
}) {
  const membersByChannel = Object.fromEntries(
    portChannels.map((channel) => [channel.id, membersOf(channel).map(toPortDto)]),
  );

  return (
    <>
      <MobilePageHeader title={sw.device.name} backHref="/network/switches">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {VENDOR_LABELS[sw.vendor] ?? sw.vendor}
          </Badge>
          {sw.hostname && (
            <Badge variant="outline" className="font-mono text-[10px]">
              {sw.hostname}
            </Badge>
          )}
        </div>
      </MobilePageHeader>
      <MobilePage>
        <MobileSection title={`VLANs · ${sw.vlans.length}`}>
          {sw.vlans.length === 0 ? (
            <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
              No VLANs found in this config.
            </p>
          ) : (
            <MobileList>
              {sw.vlans.map((vlan) => (
                <MobileListRow
                  key={vlan.id}
                  href={vlan.network ? `/network/${vlan.network.id}` : undefined}
                  leading={
                    <span className="w-9 text-right font-mono text-xs font-medium text-foreground tabular-nums">
                      {vlan.vlanId}
                    </span>
                  }
                  title={
                    <span className="truncate">
                      {vlan.name ?? vlan.network?.name ?? <span className="text-muted-foreground">unnamed</span>}
                    </span>
                  }
                  subtitle={
                    vlan.network ? (
                      <>
                        {vlan.network.name}
                        {vlan.network.cidr && <span className="font-mono"> · {vlan.network.cidr}</span>}
                      </>
                    ) : (
                      "not synced"
                    )
                  }
                  trailing={
                    vlan.svIpAddress ? <span className="font-mono text-[11px]">{vlan.svIpAddress}</span> : undefined
                  }
                />
              ))}
            </MobileList>
          )}
        </MobileSection>

        <MobileSwitchPorts
          physicalPorts={physicalPorts.map(toPortDto)}
          portChannels={portChannels.map(toPortDto)}
          membersByChannel={membersByChannel}
        />

        <RawConfig rawConfig={sw.rawConfig} />

        <p className="px-0.5 text-[11px] text-muted-foreground">
          Parsed {formatRelative(sw.parsedAt)} — repaste the config to update.
        </p>
      </MobilePage>
    </>
  );
}
