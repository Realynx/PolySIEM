import "server-only";
import { ApiError } from "@/lib/api";
import { audit, type AuditActor } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { toDriverConfig } from "@/lib/integrations/config";
import {
  createCloudflareTunnelDnsRecord,
  deleteCloudflareDnsRecord,
  findCloudflareDnsRecords,
  getCloudflareTunnelConfig,
  putCloudflareTunnelConfig,
} from "@/lib/integrations/cloudflare/client";
import { runSync } from "@/lib/integrations/engine";
import { cloudflareSettingsSchema } from "@/lib/validators/integrations";
import type { CloudflarePublishedRouteInput, DeleteCloudflarePublishedRouteInput } from "@/lib/validators/cloudflare-routes";

async function cloudflareIntegration(id: string) {
  const row = await prisma.integrationConfig.findUnique({ where: { id } });
  if (!row || row.type !== "CLOUDFLARE" || !row.enabled) {
    throw new ApiError(404, "not_found", "Enabled Cloudflare integration not found");
  }
  return row;
}

function hostnameOf(rule: Record<string, unknown>): string {
  return typeof rule.hostname === "string" ? rule.hostname.toLowerCase() : "";
}

function insertBeforeCatchAll(ingress: Array<Record<string, unknown>>, rule: Record<string, unknown>) {
  const index = ingress.findIndex((item) => !hostnameOf(item));
  if (index < 0) {
    throw new ApiError(409, "missing_catch_all", "This tunnel configuration has no catch-all ingress rule. Add one in Cloudflare before managing published routes here.");
  }
  return [...ingress.slice(0, index), rule, ...ingress.slice(index)];
}

function assertSelection(settings: ReturnType<typeof cloudflareSettingsSchema.parse>, tunnelId: string, zoneId: string, hostname: string) {
  const snapshot = settings.syncedSnapshot;
  const tunnel = snapshot?.tunnels.find((item) => item.id === tunnelId);
  const zone = snapshot?.zones.find((item) => item.id === zoneId);
  if (!tunnel) throw new ApiError(400, "unknown_tunnel", "That tunnel is not present in the latest Cloudflare sync.");
  if (tunnel.configSource !== "cloudflare") {
    throw new ApiError(409, "local_tunnel_config", "Only remotely managed tunnels can be edited here. This tunnel is configured by a local cloudflared YAML file.");
  }
  if (!zone) throw new ApiError(400, "unknown_zone", "That DNS zone is not present in the latest Cloudflare sync.");
  if (hostname !== zone.name && !hostname.endsWith(`.${zone.name}`)) {
    throw new ApiError(400, "hostname_zone_mismatch", `The hostname must belong to ${zone.name}.`);
  }
  return { tunnel, zone };
}

async function refreshAfterWrite(integrationId: string, actor: AuditActor): Promise<string | null> {
  try {
    await runSync(integrationId, "manual", actor);
    return null;
  } catch (error) {
    return `The Cloudflare change succeeded, but PolySIEM could not refresh its snapshot: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function withRouteLock<T>(integrationId: string, work: () => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('polysiem-cloudflare-routes-' || ${integrationId}))::text AS lock_result`;
    return work();
  }, { maxWait: 10_000, timeout: 60_000 });
}

export async function setCloudflareRouteCapability(
  integrationId: string,
  status: "unknown" | "granted" | "denied",
  reason: string | null,
): Promise<void> {
  const row = await prisma.integrationConfig.findUnique({ where: { id: integrationId }, select: { settings: true, type: true } });
  if (!row || row.type !== "CLOUDFLARE") return;
  const settings = cloudflareSettingsSchema.parse(row.settings ?? {});
  if (!settings.syncedSnapshot) return;
  await prisma.integrationConfig.update({
    where: { id: integrationId },
    data: {
      settings: {
        ...settings,
        syncedSnapshot: {
          ...settings.syncedSnapshot,
          routeManagementCapability: { status, checkedAt: new Date().toISOString(), reason },
        },
      },
    },
  });
}

async function permissionError(integrationId: string, error: unknown): Promise<never> {
  const message = error instanceof Error ? error.message : String(error);
  if (/HTTP 403|permission|authentication/i.test(message)) {
    await setCloudflareRouteCapability(integrationId, "denied", "Cloudflare denied a route-management request");
    throw new ApiError(403, "cloudflare_write_permission", "Cloudflare denied the change. Use the Upgrade token guide for Cloudflare Tunnel Edit, Zone Read, and DNS Edit on the selected account and zone.");
  }
  throw error;
}

export async function createCloudflarePublishedRoute(actor: AuditActor, integrationId: string, input: CloudflarePublishedRouteInput) {
  const integration = await cloudflareIntegration(integrationId);
  const settings = cloudflareSettingsSchema.parse(integration.settings ?? {});
  assertSelection(settings, input.tunnelId, input.zoneId, input.hostname);
  const cfg = toDriverConfig(integration);

  const result = await withRouteLock(integrationId, async () => {
    try {
      const config = await getCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId);
      if (config.ingress.some((rule) => hostnameOf(rule) === input.hostname)) {
        throw new ApiError(409, "route_exists", `${input.hostname} is already configured on this tunnel.`);
      }
      const dns = await findCloudflareDnsRecords(cfg, input.zoneId, input.hostname);
      const target = `${input.tunnelId}.cfargotunnel.com`.toLowerCase();
      const matchingDns = dns.find((record) => record.type === "CNAME" && record.content?.toLowerCase() === target);
      if (dns.length > 0 && !matchingDns) {
        throw new ApiError(409, "dns_conflict", `${input.hostname} already has a DNS record that does not point to this tunnel.`);
      }

      const previous = config.ingress;
      config.ingress = insertBeforeCatchAll(previous, {
        hostname: input.hostname,
        service: input.service,
        ...(input.path ? { path: input.path } : {}),
      });
      await putCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId, config);
      if (!matchingDns) {
        try {
          await createCloudflareTunnelDnsRecord(cfg, input.zoneId, input.hostname, input.tunnelId);
        } catch (error) {
          config.ingress = previous;
          await putCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId, config).catch(() => undefined);
          throw error;
        }
      }
      return { created: true, hostname: input.hostname, service: input.service };
    } catch (error) {
      return permissionError(integrationId, error);
    }
  });

  await setCloudflareRouteCapability(integrationId, "granted", null);
  await audit(actor, "cloudflare.published_route.create", { type: "integration", id: integrationId }, input);
  return { ...result, warning: await refreshAfterWrite(integrationId, actor) };
}

export async function deleteCloudflarePublishedRoute(actor: AuditActor, integrationId: string, input: DeleteCloudflarePublishedRouteInput) {
  const integration = await cloudflareIntegration(integrationId);
  const settings = cloudflareSettingsSchema.parse(integration.settings ?? {});
  assertSelection(settings, input.tunnelId, input.zoneId, input.hostname);
  const cfg = toDriverConfig(integration);

  const result = await withRouteLock(integrationId, async () => {
    try {
      const config = await getCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId);
      const previous = config.ingress;
      const next = previous.filter((rule) => hostnameOf(rule) !== input.hostname);
      if (next.length === previous.length) throw new ApiError(404, "route_not_found", `${input.hostname} is not configured on this tunnel.`);
      config.ingress = next;
      await putCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId, config);

      try {
        const target = `${input.tunnelId}.cfargotunnel.com`.toLowerCase();
        const dns = await findCloudflareDnsRecords(cfg, input.zoneId, input.hostname);
        const managed = dns.filter((record) => record.type === "CNAME" && record.content?.toLowerCase() === target);
        for (const record of managed) if (record.id) await deleteCloudflareDnsRecord(cfg, input.zoneId, record.id);
      } catch (error) {
        config.ingress = previous;
        await putCloudflareTunnelConfig(cfg, settings.accountId, input.tunnelId, config).catch(() => undefined);
        throw error;
      }
      return { deleted: true, hostname: input.hostname };
    } catch (error) {
      return permissionError(integrationId, error);
    }
  });

  await setCloudflareRouteCapability(integrationId, "granted", null);
  await audit(actor, "cloudflare.published_route.delete", { type: "integration", id: integrationId }, input);
  return { ...result, warning: await refreshAfterWrite(integrationId, actor) };
}
