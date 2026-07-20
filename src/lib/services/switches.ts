import "server-only";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { parseCiscoConfig } from "@/lib/switch/cisco";
import type { CreateSwitchInput } from "@/lib/validators/switches";

/** List shape for the switches page. */
export interface SwitchSummary {
  id: string;
  deviceId: string;
  name: string;
  hostname: string | null;
  vendor: string;
  vlanCount: number;
  portCount: number;
  portChannelCount: number;
  connectedCount: number;
  parsedAt: Date;
}

export async function listSwitches(): Promise<SwitchSummary[]> {
  const rows = await prisma.switchConfig.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      device: { select: { name: true } },
      ports: { select: { isPortChannel: true, connectedDeviceId: true } },
      _count: { select: { vlans: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    deviceId: row.deviceId,
    name: row.device.name,
    hostname: row.hostname,
    vendor: row.vendor,
    vlanCount: row._count.vlans,
    portCount: row.ports.filter((p) => !p.isPortChannel).length,
    portChannelCount: row.ports.filter((p) => p.isPortChannel).length,
    connectedCount: new Set(row.ports.map((p) => p.connectedDeviceId).filter(Boolean)).size,
    parsedAt: row.parsedAt,
  }));
}

export async function getSwitch(id: string) {
  const row = await prisma.switchConfig.findUnique({
    where: { id },
    include: {
      device: { select: { id: true, name: true, kind: true } },
      ports: {
        orderBy: { sortOrder: "asc" },
        include: { connectedDevice: { select: { id: true, name: true } } },
      },
      vlans: {
        orderBy: { vlanId: "asc" },
        include: { network: { select: { id: true, name: true, cidr: true } } },
      },
    },
  });
  if (!row) throw new ApiError(404, "not_found", "Switch not found");
  return row;
}

/** Normalize for fuzzy device-name matching: lowercase alphanumerics only. */
function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Match a port description ("dixie lag 1", "uplink to alice") to a known
 * device. A device matches when its normalized name appears as a word in the
 * normalized description (or equals it). Longest device name wins so "alice2"
 * beats "alice" when both appear.
 */
export function matchDescriptionToDevice(
  description: string | null,
  devices: { id: string; name: string }[],
): string | null {
  if (!description) return null;
  const descWords = description
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const descKey = nameKey(description);
  let best: { id: string; length: number } | null = null;
  for (const device of devices) {
    const key = nameKey(device.name);
    if (key.length < 3) continue; // too short to match confidently
    const hit = descWords.includes(key) || descKey === key;
    if (hit && (!best || key.length > best.length)) best = { id: device.id, length: key.length };
  }
  return best?.id ?? null;
}

/**
 * Parse a pasted configuration and store it: upserts the switch Device,
 * replaces any previous parsed config for it, links VLANs to synced Networks
 * by VLAN id, and resolves port descriptions to known devices.
 */
export async function createSwitchFromConfig(actor: AuditActor, input: CreateSwitchInput) {
  const parsed = parseCiscoConfig(input.rawConfig);
  if (parsed.ports.length === 0 && parsed.vlans.length === 0) {
    throw new ApiError(422, "unparsable", "That doesn't look like a Cisco switch configuration — no interfaces or VLANs found");
  }

  const name = input.name?.trim() || parsed.hostname || "switch";

  const [networks, devices] = await Promise.all([
    prisma.network.findMany({
      where: { status: { not: "REMOVED" }, vlanId: { not: null } },
      select: { id: true, vlanId: true },
    }),
    prisma.device.findMany({
      where: { status: { not: "REMOVED" } },
      select: { id: true, name: true },
    }),
  ]);
  const networkByVlan = new Map(networks.map((n) => [n.vlanId!, n.id]));

  const device =
    (await prisma.device.findFirst({ where: { name, kind: "switch" } })) ??
    (await prisma.device.create({
      data: { name, kind: "switch", source: "MANUAL", manufacturer: "Cisco" },
    }));
  const otherDevices = devices.filter((d) => d.id !== device.id);

  // Port-channel members inherit the channel's connection when their own
  // description doesn't resolve (common: only the Po interface is labeled).
  const channelConnection = new Map<number, string | null>();
  for (const port of parsed.ports) {
    if (port.isPortChannel) {
      const match = /(\d+)$/.exec(port.shortName);
      if (match) channelConnection.set(Number(match[1]), matchDescriptionToDevice(port.description, otherDevices));
    }
  }

  const config = await prisma.$transaction(async (tx) => {
    await tx.switchConfig.deleteMany({ where: { deviceId: device.id } });
    return tx.switchConfig.create({
      data: {
        deviceId: device.id,
        vendor: "cisco-ios",
        hostname: parsed.hostname,
        rawConfig: input.rawConfig,
        parsedAt: new Date(),
        vlans: {
          create: parsed.vlans.map((vlan) => ({
            vlanId: vlan.vlanId,
            name: vlan.name,
            svIpAddress: vlan.svIpAddress,
            networkId: networkByVlan.get(vlan.vlanId) ?? null,
          })),
        },
        ports: {
          create: parsed.ports.map((port, index) => ({
            name: port.name,
            shortName: port.shortName,
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
            connectedDeviceId:
              matchDescriptionToDevice(port.description, otherDevices) ??
              (port.channelGroup !== null ? (channelConnection.get(port.channelGroup) ?? null) : null),
            sortOrder: index,
          })),
        },
      },
    });
  });

  await audit(actor, "switch.create", { type: "switch", id: config.id }, {
    name,
    hostname: parsed.hostname,
    vlans: parsed.vlans.length,
    ports: parsed.ports.length,
    warnings: parsed.warnings.length,
  });

  return { config: await getSwitch(config.id), warnings: parsed.warnings };
}

/** Remove a parsed switch config. The inventory Device stays. */
export async function deleteSwitch(actor: AuditActor, id: string): Promise<void> {
  const existing = await prisma.switchConfig.findUnique({
    where: { id },
    include: { device: { select: { name: true } } },
  });
  if (!existing) throw new ApiError(404, "not_found", "Switch not found");
  await prisma.switchConfig.delete({ where: { id } });
  await audit(actor, "switch.delete", { type: "switch", id }, { name: existing.device.name });
}
