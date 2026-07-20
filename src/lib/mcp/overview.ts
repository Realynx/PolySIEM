import "server-only";
import { prisma } from "@/lib/db";
import { getInstanceName } from "@/lib/settings";

const NOT_REMOVED = { status: { not: "REMOVED" as const } };

function mdCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Markdown snapshot of the whole lab: instance name, entity counts, hosts with
 * nested VMs/containers, networks, and integration health. Served both as the
 * `polysiem://overview` resource and the `get_lab_overview` tool.
 */
export async function buildOverviewMarkdown(): Promise<string> {
  const [
    instanceName,
    deviceCount,
    vmCount,
    containerCount,
    networkCount,
    serviceCount,
    storageCount,
    docCount,
    hosts,
    networks,
    integrations,
  ] = await Promise.all([
    getInstanceName(),
    prisma.device.count({ where: NOT_REMOVED }),
    prisma.virtualMachine.count({ where: NOT_REMOVED }),
    prisma.container.count({ where: NOT_REMOVED }),
    prisma.network.count({ where: NOT_REMOVED }),
    prisma.service.count({ where: NOT_REMOVED }),
    prisma.storagePool.count({ where: NOT_REMOVED }),
    prisma.docPage.count(),
    prisma.device.findMany({
      where: NOT_REMOVED,
      orderBy: { name: "asc" },
      select: {
        name: true,
        kind: true,
        source: true,
        vms: { where: NOT_REMOVED, orderBy: { name: "asc" }, select: { name: true, powerState: true } },
        containers: { where: NOT_REMOVED, orderBy: { name: "asc" }, select: { name: true, runtime: true, powerState: true } },
      },
    }),
    prisma.network.findMany({
      where: NOT_REMOVED,
      orderBy: [{ vlanId: "asc" }, { name: "asc" }],
      select: { name: true, vlanId: true, cidr: true, purpose: true },
    }),
    prisma.integrationConfig.findMany({
      orderBy: { name: "asc" },
      select: {
        name: true,
        type: true,
        enabled: true,
        lastSyncAt: true,
        lastSyncStatus: true,
        lastSyncError: true,
      },
    }),
  ]);

  const lines: string[] = [];
  lines.push(`# ${instanceName} — lab overview`);
  lines.push("");
  lines.push(`_Generated ${new Date().toISOString()}_`);
  lines.push("");

  lines.push("## Inventory counts");
  lines.push("");
  lines.push("| Entity | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Devices | ${deviceCount} |`);
  lines.push(`| Virtual machines | ${vmCount} |`);
  lines.push(`| Containers | ${containerCount} |`);
  lines.push(`| Networks | ${networkCount} |`);
  lines.push(`| Services | ${serviceCount} |`);
  lines.push(`| Storage pools | ${storageCount} |`);
  lines.push(`| Documentation pages | ${docCount} |`);
  lines.push("");

  lines.push("## Hosts");
  lines.push("");
  if (hosts.length === 0) {
    lines.push("_No devices recorded._");
  }
  for (const host of hosts) {
    lines.push(`### ${host.name} (${host.kind}, source: ${host.source})`);
    if (host.vms.length > 0) {
      lines.push(`- VMs: ${host.vms.map((v) => `${v.name} [${v.powerState}]`).join(", ")}`);
    }
    if (host.containers.length > 0) {
      lines.push(
        `- Containers: ${host.containers.map((c) => `${c.name} (${c.runtime}) [${c.powerState}]`).join(", ")}`,
      );
    }
    if (host.vms.length === 0 && host.containers.length === 0) {
      lines.push("- No VMs or containers.");
    }
    lines.push("");
  }

  lines.push("## Networks");
  lines.push("");
  if (networks.length === 0) {
    lines.push("_No networks recorded._");
  } else {
    lines.push("| Name | VLAN | CIDR | Purpose |");
    lines.push("| --- | --- | --- | --- |");
    for (const n of networks) {
      lines.push(`| ${mdCell(n.name)} | ${mdCell(n.vlanId)} | ${mdCell(n.cidr)} | ${mdCell(n.purpose)} |`);
    }
  }
  lines.push("");

  lines.push("## Integrations");
  lines.push("");
  if (integrations.length === 0) {
    lines.push("_No integrations configured._");
  } else {
    lines.push("| Name | Type | Enabled | Last sync | Status | Error |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const i of integrations) {
      lines.push(
        `| ${mdCell(i.name)} | ${i.type} | ${i.enabled ? "yes" : "no"} | ${mdCell(
          i.lastSyncAt?.toISOString(),
        )} | ${mdCell(i.lastSyncStatus)} | ${mdCell(i.lastSyncError)} |`,
      );
    }
  }
  lines.push("");

  return lines.join("\n");
}
