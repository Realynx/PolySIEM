import Link from "next/link";
import { Network } from "lucide-react";
import { requirePageUser } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { isMobileView } from "@/lib/device";
import { anonymizeForDisplay } from "@/lib/privacy/server";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { InventoryMap, type MapHost, type MapUplink } from "@/components/topology/inventory-map";
import { MobileLabMap } from "@/components/mobile/pages/maps/mobile-lab-map";
import { computeMetricKey } from "@/lib/compute/metrics";

export const dynamic = "force-dynamic";

export const metadata = { title: "Lab map" };

const guestSelect = {
  id: true,
  name: true,
  vmid: true,
  status: true,
  powerState: true,
  osName: true,
  integrationId: true,
  externalId: true,
} as const;

async function loadMapDevices() {
  return prisma.device.findMany({
    where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" },
    select: {
      id: true, name: true, kind: true, status: true, osName: true,
      integrationId: true, externalId: true, cpuCores: true, memoryBytes: true,
      vms: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" }, select: guestSelect },
      containers: { where: { status: { not: "REMOVED" } }, orderBy: { name: "asc" }, select: guestSelect },
    },
  });
}

type SwitchPortRow = Awaited<ReturnType<typeof loadSwitchPorts>>[number];

async function loadSwitchPorts() {
  return prisma.switchPort.findMany({
    where: { switchConfig: { device: { status: { not: "REMOVED" } } } },
    select: {
      shortName: true, isPortChannel: true, channelGroup: true, connectedDeviceId: true,
      switchConfig: { select: { deviceId: true } },
    },
  });
}

function portChannelMemberCounts(ports: SwitchPortRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const port of ports) {
    if (port.isPortChannel || port.channelGroup === null) continue;
    const key = `${port.switchConfig.deviceId}:${port.channelGroup}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function uplinkLabel(port: SwitchPortRow, memberCounts: ReadonlyMap<string, number>): string {
  if (!port.isPortChannel) return port.shortName;
  const channel = /(\d+)$/.exec(port.shortName)?.[1];
  const members = channel ? (memberCounts.get(`${port.switchConfig.deviceId}:${channel}`) ?? 0) : 0;
  return members > 0 ? `${port.shortName} · ${members}×` : port.shortName;
}

function mapUplinks(ports: SwitchPortRow[]): MapUplink[] {
  const memberCounts = portChannelMemberCounts(ports);
  const labelsByPair = new Map<string, string[]>();
  for (const port of ports) {
    if (!port.connectedDeviceId || (!port.isPortChannel && port.channelGroup !== null)) continue;
    const pairKey = `${port.switchConfig.deviceId}->${port.connectedDeviceId}`;
    const labels = labelsByPair.get(pairKey) ?? [];
    labels.push(uplinkLabel(port, memberCounts));
    labelsByPair.set(pairKey, labels);
  }
  return Array.from(labelsByPair, ([pairKey, labels]) => {
    const [sourceId, targetId] = pairKey.split("->");
    return { id: `uplink:${pairKey}`, sourceId, targetId, label: labels.join(", ") };
  });
}

function metricKey(integrationId: string | null, externalId: string | null): string | null {
  if (!integrationId || !externalId) return null;
  return computeMetricKey(integrationId, externalId);
}

function mapHosts(devices: Awaited<ReturnType<typeof loadMapDevices>>): MapHost[] {
  return devices.map((device) => ({
    id: device.id, name: device.name, kind: device.kind, status: device.status,
    osName: device.osName, cpuCores: device.cpuCores,
    memoryBytes: device.memoryBytes == null ? null : Number(device.memoryBytes),
    metricKey: metricKey(device.integrationId, device.externalId),
    guests: [
      ...device.vms.map((vm) => ({
        id: vm.id, type: "vm" as const, name: vm.name, vmid: vm.vmid, status: vm.status,
        powerState: vm.powerState, osName: vm.osName,
        metricKey: metricKey(vm.integrationId, vm.externalId),
      })),
      ...device.containers.map((container) => ({
        id: container.id, type: "container" as const, name: container.name, vmid: container.vmid,
        status: container.status, powerState: container.powerState, osName: container.osName,
        metricKey: metricKey(container.integrationId, container.externalId),
      })),
    ],
  }));
}

function DesktopLabMap({ hosts, uplinks, isAdmin }: { hosts: MapHost[]; uplinks: MapUplink[]; isAdmin: boolean }) {
  return (
    <div>
      <PageHeader title="Lab map" description="A live map of your lab built from synced inventory — hosts with the virtual machines and containers running on them." />
      {hosts.length === 0 ? (
        <EmptyState
          icon={Network} title="Nothing to map yet"
          description="Add hosts manually or connect a Proxmox integration and the lab map will draw your hosts, VMs and containers automatically."
          action={isAdmin ? <Button asChild><Link href="/settings/integrations">Add an integration</Link></Button> : undefined}
        />
      ) : <InventoryMap hosts={hosts} uplinks={uplinks} />}
    </div>
  );
}

export default async function LabMapPage() {
  const { user } = await requirePageUser();
  const [devices, switchPorts] = await Promise.all([loadMapDevices(), loadSwitchPorts()]);
  const { hosts, uplinks } = await anonymizeForDisplay({ hosts: mapHosts(devices), uplinks: mapUplinks(switchPorts) });

  if (await isMobileView()) {
    return <MobileLabMap hosts={hosts} uplinks={uplinks} isAdmin={user.role === "ADMIN"} />;
  }

  return <DesktopLabMap hosts={hosts} uplinks={uplinks} isAdmin={user.role === "ADMIN"} />;
}
