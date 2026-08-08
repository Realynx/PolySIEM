import "server-only";
import { prisma } from "@/lib/db";
import { getInstanceName } from "@/lib/settings";

const NOT_REMOVED = { status: { not: "REMOVED" as const } };
const OVERVIEW_HOST_LIMIT = 100;
const OVERVIEW_GUESTS_PER_HOST_LIMIT = 50;
const OVERVIEW_NETWORK_LIMIT = 200;
const OVERVIEW_INTEGRATION_LIMIT = 1_000;

function mdCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

interface OverviewIntegration {
  name: string;
  type: string;
  enabled: boolean;
  lastSyncAt: Date | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
}

function appendIntegrationOverview(
  lines: string[],
  integrations: OverviewIntegration[],
  total: number,
): void {
  lines.push("## Integrations", "");
  if (integrations.length === 0) {
    lines.push("_No integrations configured._", "");
    return;
  }
  if (total > integrations.length) {
    lines.push(`_Showing the first ${integrations.length} of ${total} integrations._`, "");
  }
  lines.push("| Name | Type | Enabled | Last sync | Status | Error |");
  lines.push("| --- | --- | --- | --- | --- | --- |");
  for (const integration of integrations) {
    lines.push(
      `| ${mdCell(integration.name)} | ${integration.type} | ${integration.enabled ? "yes" : "no"} | ${mdCell(
        integration.lastSyncAt?.toISOString(),
      )} | ${mdCell(integration.lastSyncStatus)} | ${mdCell(integration.lastSyncError)} |`,
    );
  }
  lines.push("");
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
    integrationCount,
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
    prisma.integrationConfig.count(),
    prisma.device.findMany({
      where: NOT_REMOVED,
      orderBy: { name: "asc" },
      take: OVERVIEW_HOST_LIMIT,
      select: {
        name: true,
        kind: true,
        source: true,
        vms: {
          where: NOT_REMOVED,
          orderBy: { name: "asc" },
          take: OVERVIEW_GUESTS_PER_HOST_LIMIT,
          select: { name: true, powerState: true },
        },
        containers: {
          where: NOT_REMOVED,
          orderBy: { name: "asc" },
          take: OVERVIEW_GUESTS_PER_HOST_LIMIT,
          select: { name: true, runtime: true, powerState: true },
        },
        _count: {
          select: {
            vms: { where: NOT_REMOVED },
            containers: { where: NOT_REMOVED },
          },
        },
      },
    }),
    prisma.network.findMany({
      where: NOT_REMOVED,
      orderBy: [{ vlanId: "asc" }, { name: "asc" }],
      take: OVERVIEW_NETWORK_LIMIT,
      select: { name: true, vlanId: true, cidr: true, purpose: true },
    }),
    prisma.integrationConfig.findMany({
      orderBy: { name: "asc" },
      take: OVERVIEW_INTEGRATION_LIMIT,
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
  } else if (deviceCount > hosts.length) {
    lines.push(`_Showing the first ${hosts.length} of ${deviceCount} devices._`);
    lines.push("");
  }
  for (const host of hosts) {
    lines.push(`### ${host.name} (${host.kind}, source: ${host.source})`);
    if (host.vms.length > 0) {
      const suffix = host._count.vms > host.vms.length ? `, … ${host._count.vms - host.vms.length} more` : "";
      lines.push(`- VMs: ${host.vms.map((v) => `${v.name} [${v.powerState}]`).join(", ")}${suffix}`);
    }
    if (host.containers.length > 0) {
      const suffix = host._count.containers > host.containers.length
        ? `, … ${host._count.containers - host.containers.length} more`
        : "";
      lines.push(
        `- Containers: ${host.containers.map((c) => `${c.name} (${c.runtime}) [${c.powerState}]`).join(", ")}${suffix}`,
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
    if (networkCount > networks.length) {
      lines.push(`_Showing the first ${networks.length} of ${networkCount} networks._`);
      lines.push("");
    }
    lines.push("| Name | VLAN | CIDR | Purpose |");
    lines.push("| --- | --- | --- | --- |");
    for (const n of networks) {
      lines.push(`| ${mdCell(n.name)} | ${mdCell(n.vlanId)} | ${mdCell(n.cidr)} | ${mdCell(n.purpose)} |`);
    }
  }
  lines.push("");

  appendIntegrationOverview(lines, integrations, integrationCount);

  return lines.join("\n");
}
