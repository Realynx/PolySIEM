import "server-only";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import { getDevice, getVm, getContainer, getNetwork, getService } from "@/lib/services/inventory";

/** Entity types that describe_entity can build a fact sheet for. */
export const DESCRIBABLE_ENTITY_TYPES = ["device", "vm", "container", "network", "service"] as const;
export type DescribableEntityType = (typeof DESCRIBABLE_ENTITY_TYPES)[number];

interface InterfaceFacts {
  name: string;
  macAddress: string | null;
  ip: { address: string } | null;
  network: { name: string } | null;
}

interface ServiceFacts {
  name: string;
  port: number | null;
  protocol: string | null;
  url: string | null;
}

interface TagFacts {
  tag: { name: string };
}

function line(label: string, value: string | number | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return `- ${label}: ${value}`;
}

function joinLines(lines: Array<string | null>): string {
  return lines.filter((l): l is string => l !== null).join("\n");
}

function interfaceLines(interfaces: InterfaceFacts[]): string | null {
  if (interfaces.length === 0) return null;
  const rows = interfaces.map((i) => {
    const parts = [i.name];
    if (i.ip?.address) parts.push(i.ip.address);
    if (i.network?.name) parts.push(`on network "${i.network.name}"`);
    if (i.macAddress) parts.push(`(${i.macAddress})`);
    return `  - ${parts.join(" ")}`;
  });
  return `- Network interfaces:\n${rows.join("\n")}`;
}

function serviceLines(services: ServiceFacts[]): string | null {
  if (services.length === 0) return null;
  const rows = services.map((s) => {
    const parts = [s.name];
    if (s.port) parts.push(`port ${s.port}${s.protocol ? `/${s.protocol}` : ""}`);
    if (s.url) parts.push(s.url);
    return `  - ${parts.join(", ")}`;
  });
  return `- Services running here:\n${rows.join("\n")}`;
}

function tagLine(tags: TagFacts[]): string | null {
  if (tags.length === 0) return null;
  return line("Tags", tags.map((t) => t.tag.name).join(", "));
}

type DeviceDetails = Awaited<ReturnType<typeof getDevice>>;
type VmDetails = Awaited<ReturnType<typeof getVm>>;
type ContainerDetails = Awaited<ReturnType<typeof getContainer>>;
type NetworkDetails = Awaited<ReturnType<typeof getNetwork>>;
type ServiceDetails = Awaited<ReturnType<typeof getService>>;

function deviceCpu(device: DeviceDetails): string | null {
  if (device.cpuModel) return `${device.cpuModel}${device.cpuCores ? ` (${device.cpuCores} cores)` : ""}`;
  return device.cpuCores ? `${device.cpuCores} cores` : null;
}

function deviceHosts(device: DeviceDetails): string | null {
  if (device.vms.length === 0 && device.containers.length === 0) return null;
  const names = device.vms.map((vm) => vm.name).join(", ") || "none";
  return `${device.vms.length} VM(s) (${names}), ${device.containers.length} container(s)`;
}

function deviceFactSheet(device: DeviceDetails): string {
  const pools = device.storagePools.map((pool) =>
    `${pool.name}${pool.totalBytes != null ? ` (${formatBytes(pool.totalBytes)})` : ""}`,
  );
  return joinLines([
    "Fact sheet for a homelab device:", line("Name", device.name), line("Kind", device.kind),
    line("Manufacturer / model", [device.manufacturer, device.model].filter(Boolean).join(" ") || null),
    line("CPU", deviceCpu(device)), line("Memory", device.memoryBytes != null ? formatBytes(device.memoryBytes) : null),
    line("OS", [device.osName, device.osVersion].filter(Boolean).join(" ") || null), line("Location", device.location),
    line("Hosts", deviceHosts(device)), line("Storage pools", pools.join(", ") || null),
    interfaceLines(device.interfaces), serviceLines(device.services), tagLine(device.tags),
    line("Existing description", device.description),
  ]);
}

function vmFactSheet(vm: VmDetails): string {
  return joinLines([
    "Fact sheet for a homelab virtual machine:", line("Name", vm.name), line("Host", vm.host?.name),
    line("Power state", vm.powerState), line("CPU cores", vm.cpuCores),
    line("Memory", vm.memoryBytes != null ? formatBytes(vm.memoryBytes) : null),
    line("Disk", vm.diskBytes != null ? formatBytes(vm.diskBytes) : null), line("OS", vm.osName),
    line("Containers inside", vm.containers.map((container) => container.name).join(", ") || null),
    interfaceLines(vm.interfaces), serviceLines(vm.services), tagLine(vm.tags), line("Existing description", vm.description),
  ]);
}

function containerFactSheet(container: ContainerDetails): string {
  return joinLines([
    "Fact sheet for a homelab container:", line("Name", container.name), line("Runtime", container.runtime),
    line("Host", container.host?.name), line("Parent VM", container.vm?.name), line("Power state", container.powerState),
    line("CPU cores", container.cpuCores),
    line("Memory", container.memoryBytes != null ? formatBytes(container.memoryBytes) : null), line("OS", container.osName),
    interfaceLines(container.interfaces), serviceLines(container.services), tagLine(container.tags),
    line("Existing description", container.description),
  ]);
}

function networkFactSheet(network: NetworkDetails): string {
  const attached = network.interfaces
    .map((item) => item.device?.name ?? item.vm?.name ?? item.container?.name)
    .filter((name): name is string => Boolean(name));
  return joinLines([
    "Fact sheet for a homelab network:", line("Name", network.name), line("VLAN ID", network.vlanId),
    line("CIDR", network.cidr), line("Gateway", network.gateway), line("Domain", network.domain),
    line("Purpose", network.purpose), line("Known IP addresses", network.ipAddresses.length || null),
    line("Attached hosts", attached.join(", ") || null), line("DHCP leases", network.dhcpLeases.length || null),
    tagLine(network.tags), line("Existing description", network.description),
  ]);
}

function serviceFactSheet(service: ServiceDetails): string {
  const endpoint = service.port ? `${service.port}${service.protocol ? `/${service.protocol}` : ""}` : null;
  return joinLines([
    "Fact sheet for a homelab service:", line("Name", service.name), line("URL", service.url), line("Port", endpoint),
    line("Runs on", service.device?.name ?? service.vm?.name ?? service.container?.name),
    tagLine(service.tags), line("Existing description", service.description),
  ]);
}

/** Build a plain-text fact sheet for an inventory entity, for use as prompt context. */
export async function buildEntityFactSheet(entityType: DescribableEntityType, entityId: string): Promise<string> {
  switch (entityType) {
    case "device": return deviceFactSheet(await getDevice(entityId));
    case "vm": return vmFactSheet(await getVm(entityId));
    case "container": return containerFactSheet(await getContainer(entityId));
    case "network": return networkFactSheet(await getNetwork(entityId));
    case "service": return serviceFactSheet(await getService(entityId));
  }
}

/** Build a plain-text rendering of a firewall rule (with alias expansion) for explain_rule. */
export async function buildFirewallRuleContext(ruleId: string): Promise<string> {
  const rule = await prisma.firewallRule.findUnique({ where: { id: ruleId } });
  if (!rule) throw new ApiError(404, "not_found", "Firewall rule not found");

  const specNames = [rule.sourceSpec, rule.destSpec].filter((s): s is string => Boolean(s));
  const aliases = specNames.length
    ? await prisma.firewallAlias.findMany({
        where: { name: { in: specNames }, status: { not: "REMOVED" } },
      })
    : [];

  const src = rule.sourceSpec || "any";
  const dst = rule.destSpec || "any";
  const port = rule.destPort ? `:${rule.destPort}` : "";
  return joinLines([
    `Firewall rule:`,
    line("Action", rule.action),
    line("Interface", rule.interfaceName),
    line("Direction", rule.direction),
    line("Protocol", rule.protocol || "any"),
    line("Traffic", `${src} -> ${dst}${port}`),
    ...aliases.map((a) =>
      line(
        `Alias "${a.name}"`,
        `${a.aliasType ?? "alias"} containing [${a.content.join(", ")}]${a.descriptionText ? ` — ${a.descriptionText}` : ""}`,
      ),
    ),
    line("Rule description", rule.descriptionText),
    line("Operator note", rule.annotation),
    line("Enabled", rule.enabled ? "yes" : "no (currently disabled)"),
  ]);
}
