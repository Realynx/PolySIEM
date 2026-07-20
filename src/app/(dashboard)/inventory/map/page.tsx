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

export default async function LabMapPage() {
  const { user } = await requirePageUser();

  const devices = await prisma.device.findMany({
    where: { status: { not: "REMOVED" } },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      kind: true,
      status: true,
      osName: true,
      integrationId: true,
      externalId: true,
      cpuCores: true,
      memoryBytes: true,
      vms: {
        where: { status: { not: "REMOVED" } },
        orderBy: { name: "asc" },
        select: guestSelect,
      },
      containers: {
        where: { status: { not: "REMOVED" } },
        orderBy: { name: "asc" },
        select: guestSelect,
      },
    },
  });

  // Physical uplinks documented by parsed switch configs: one edge per
  // (switch, connected device), labeled with its port-channels/ports.
  const switchPorts = await prisma.switchPort.findMany({
    where: { switchConfig: { device: { status: { not: "REMOVED" } } } },
    select: {
      shortName: true,
      isPortChannel: true,
      channelGroup: true,
      connectedDeviceId: true,
      switchConfig: { select: { deviceId: true } },
    },
  });
  const memberCounts = new Map<string, number>();
  for (const port of switchPorts) {
    if (port.isPortChannel || port.channelGroup === null) continue;
    const key = `${port.switchConfig.deviceId}:${port.channelGroup}`;
    memberCounts.set(key, (memberCounts.get(key) ?? 0) + 1);
  }
  const uplinkLabels = new Map<string, string[]>();
  for (const port of switchPorts) {
    if (!port.connectedDeviceId) continue;
    // Members of a labeled port-channel are represented by the Po edge.
    if (!port.isPortChannel && port.channelGroup !== null) continue;
    const pairKey = `${port.switchConfig.deviceId}->${port.connectedDeviceId}`;
    let label = port.shortName;
    if (port.isPortChannel) {
      const channel = /(\d+)$/.exec(port.shortName)?.[1];
      const members = channel ? (memberCounts.get(`${port.switchConfig.deviceId}:${channel}`) ?? 0) : 0;
      if (members > 0) label = `${port.shortName} · ${members}×`;
    }
    const labels = uplinkLabels.get(pairKey) ?? [];
    labels.push(label);
    uplinkLabels.set(pairKey, labels);
  }
  const uplinksData: MapUplink[] = [...uplinkLabels.entries()].map(([pairKey, labels]) => {
    const [sourceId, targetId] = pairKey.split("->");
    return { id: `uplink:${pairKey}`, sourceId, targetId, label: labels.join(", ") };
  });

  // Serialize to plain JSON props (BigInt memoryBytes -> number).
  const hostsData: MapHost[] = devices.map((device) => ({
    id: device.id,
    name: device.name,
    kind: device.kind,
    status: device.status,
    osName: device.osName,
    cpuCores: device.cpuCores,
    memoryBytes: device.memoryBytes == null ? null : Number(device.memoryBytes),
    metricKey:
      device.integrationId && device.externalId
        ? computeMetricKey(device.integrationId, device.externalId)
        : null,
    guests: [
      ...device.vms.map((vm) => ({
        id: vm.id,
        type: "vm" as const,
        name: vm.name,
        vmid: vm.vmid,
        status: vm.status,
        powerState: vm.powerState,
        osName: vm.osName,
        metricKey:
          vm.integrationId && vm.externalId
            ? computeMetricKey(vm.integrationId, vm.externalId)
            : null,
      })),
      ...device.containers.map((ct) => ({
        id: ct.id,
        type: "container" as const,
        name: ct.name,
        vmid: ct.vmid,
        status: ct.status,
        powerState: ct.powerState,
        osName: ct.osName,
        metricKey:
          ct.integrationId && ct.externalId
            ? computeMetricKey(ct.integrationId, ct.externalId)
            : null,
      })),
    ],
  }));

  const { hosts, uplinks } = await anonymizeForDisplay({
    hosts: hostsData,
    uplinks: uplinksData,
  });

  if (await isMobileView()) {
    return <MobileLabMap hosts={hosts} uplinks={uplinks} isAdmin={user.role === "ADMIN"} />;
  }

  return (
    <div>
      <PageHeader
        title="Lab map"
        description="A live map of your lab built from synced inventory — hosts with the virtual machines and containers running on them."
      />
      {hosts.length === 0 ? (
        <EmptyState
          icon={Network}
          title="Nothing to map yet"
          description="Add hosts manually or connect a Proxmox integration and the lab map will draw your hosts, VMs and containers automatically."
          action={
            user.role === "ADMIN" ? (
              <Button asChild>
                <Link href="/settings/integrations">Add an integration</Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <InventoryMap hosts={hosts} uplinks={uplinks} />
      )}
    </div>
  );
}
