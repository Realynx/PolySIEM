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

/** Build a plain-text fact sheet for an inventory entity, for use as prompt context. */
export async function buildEntityFactSheet(entityType: DescribableEntityType, entityId: string): Promise<string> {
  switch (entityType) {
    case "device": {
      const d = await getDevice(entityId);
      return joinLines([
        `Fact sheet for a homelab device:`,
        line("Name", d.name),
        line("Kind", d.kind),
        line("Manufacturer / model", [d.manufacturer, d.model].filter(Boolean).join(" ") || null),
        line("CPU", d.cpuModel ? `${d.cpuModel}${d.cpuCores ? ` (${d.cpuCores} cores)` : ""}` : d.cpuCores ? `${d.cpuCores} cores` : null),
        line("Memory", d.memoryBytes != null ? formatBytes(d.memoryBytes) : null),
        line("OS", [d.osName, d.osVersion].filter(Boolean).join(" ") || null),
        line("Location", d.location),
        line("Hosts", d.vms.length || d.containers.length ? `${d.vms.length} VM(s) (${d.vms.map((v) => v.name).join(", ") || "none"}), ${d.containers.length} container(s)` : null),
        line("Storage pools", d.storagePools.length ? d.storagePools.map((p) => `${p.name}${p.totalBytes != null ? ` (${formatBytes(p.totalBytes)})` : ""}`).join(", ") : null),
        interfaceLines(d.interfaces),
        serviceLines(d.services),
        tagLine(d.tags),
        line("Existing description", d.description),
      ]);
    }
    case "vm": {
      const v = await getVm(entityId);
      return joinLines([
        `Fact sheet for a homelab virtual machine:`,
        line("Name", v.name),
        line("Host", v.host?.name),
        line("Power state", v.powerState),
        line("CPU cores", v.cpuCores),
        line("Memory", v.memoryBytes != null ? formatBytes(v.memoryBytes) : null),
        line("Disk", v.diskBytes != null ? formatBytes(v.diskBytes) : null),
        line("OS", v.osName),
        line("Containers inside", v.containers.length ? v.containers.map((c) => c.name).join(", ") : null),
        interfaceLines(v.interfaces),
        serviceLines(v.services),
        tagLine(v.tags),
        line("Existing description", v.description),
      ]);
    }
    case "container": {
      const c = await getContainer(entityId);
      return joinLines([
        `Fact sheet for a homelab container:`,
        line("Name", c.name),
        line("Runtime", c.runtime),
        line("Host", c.host?.name),
        line("Parent VM", c.vm?.name),
        line("Power state", c.powerState),
        line("CPU cores", c.cpuCores),
        line("Memory", c.memoryBytes != null ? formatBytes(c.memoryBytes) : null),
        line("OS", c.osName),
        interfaceLines(c.interfaces),
        serviceLines(c.services),
        tagLine(c.tags),
        line("Existing description", c.description),
      ]);
    }
    case "network": {
      const n = await getNetwork(entityId);
      const attached = n.interfaces
        .map((i) => i.device?.name ?? i.vm?.name ?? i.container?.name)
        .filter((name): name is string => Boolean(name));
      return joinLines([
        `Fact sheet for a homelab network:`,
        line("Name", n.name),
        line("VLAN ID", n.vlanId),
        line("CIDR", n.cidr),
        line("Gateway", n.gateway),
        line("Domain", n.domain),
        line("Purpose", n.purpose),
        line("Known IP addresses", n.ipAddresses.length || null),
        line("Attached hosts", attached.length ? attached.join(", ") : null),
        line("DHCP leases", n.dhcpLeases.length || null),
        tagLine(n.tags),
        line("Existing description", n.description),
      ]);
    }
    case "service": {
      const s = await getService(entityId);
      return joinLines([
        `Fact sheet for a homelab service:`,
        line("Name", s.name),
        line("URL", s.url),
        line("Port", s.port ? `${s.port}${s.protocol ? `/${s.protocol}` : ""}` : null),
        line("Runs on", s.device?.name ?? s.vm?.name ?? s.container?.name),
        tagLine(s.tags),
        line("Existing description", s.description),
      ]);
    }
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
