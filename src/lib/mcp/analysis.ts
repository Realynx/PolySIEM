import "server-only";

import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import {
  checkThreatIntel,
  gatherIpIdentity,
  getFirewallContextForIp,
  queryLogsForTerm,
} from "@/lib/ai/agent/research";
import { findRelatedThreats } from "@/lib/ai/agent/related";
import { runSecurityChecks } from "@/lib/security/checks";
import { collectSecuritySnapshot } from "@/lib/security/collect";
import { computeScore, sortFindings } from "@/lib/security/score";
import type { SecurityFinding, SecuritySeverity } from "@/lib/security/types";
import { SETTING_KEYS, getSetting } from "@/lib/settings";
import { loadFootprintInput } from "@/lib/topology/footprint-data";
import { deriveFootprint, type FootprintGraph } from "@/lib/topology/footprint";
import { resolveOne } from "@/lib/mcp/entity-resolve";
import { endpointFor, evaluateAccess, type AccessEndpoint } from "@/lib/mcp/access-check";
import { pageArray } from "@/lib/mcp/pagination";

/* ------------------------------------------------------------------ access */

export async function loadFootprintGraph(): Promise<FootprintGraph> {
  return deriveFootprint(await loadFootprintInput());
}

const FULL_IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

async function serviceHostId(id: string): Promise<string | null> {
  const svc = await prisma.service.findUnique({ where: { id }, select: { deviceId: true, vmId: true, containerId: true } });
  return svc?.containerId ?? svc?.vmId ?? svc?.deviceId ?? null;
}

/** Turn "internet", an IP, or any entity reference into an access endpoint. */
export async function resolveAccessEndpoint(graph: FootprintGraph, refText: string): Promise<AccessEndpoint> {
  const value = refText.trim();
  if (/^(internet|wan|public|any external)$/i.test(value)) return endpointFor(graph, { internet: true, label: "Internet" });
  if (FULL_IPV4.test(value)) return endpointFor(graph, { ip: value, label: value });
  const ref = await resolveOne(value);
  switch (ref.type) {
    case "network":
      return endpointFor(graph, { laneId: ref.id, label: ref.name });
    case "device":
    case "vm":
    case "container":
      return endpointFor(graph, { machineId: ref.id, label: ref.name });
    case "service": {
      const host = await serviceHostId(ref.id);
      return endpointFor(graph, { machineId: host ?? undefined, label: ref.name });
    }
    case "ip":
      return endpointFor(graph, { ip: ref.name, label: ref.name });
    default:
      throw new ApiError(400, "validation_error", `"${refText}" resolved to a ${ref.type}; pass a host, VM, container, service, network, IP address, or "internet".`);
  }
}

export async function checkAccess(fromRef: string, toRef: string) {
  const graph = await loadFootprintGraph();
  const [from, to] = await Promise.all([resolveAccessEndpoint(graph, fromRef), resolveAccessEndpoint(graph, toRef)]);
  return evaluateAccess(graph, from, to);
}

/* ---------------------------------------------------------------- security */

const SEVERITY_RANK: Record<SecuritySeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

export interface SecurityReportArgs {
  minSeverity?: SecuritySeverity;
  category?: string;
  includeDismissed?: boolean;
  cursor?: string;
  limit?: number;
}

function compactFinding(f: SecurityFinding) {
  return {
    id: f.id,
    severity: f.severity,
    category: f.category,
    title: f.title,
    detail: f.detail,
    remediation: f.remediation,
    affected: f.affected.slice(0, 15),
    ...(f.affected.length > 15 ? { affectedTotal: f.affected.length } : {}),
  };
}

/** Same computation as GET /api/security: live score, subscores and findings. */
export async function securityReport(args: SecurityReportArgs = {}) {
  const snapshot = await collectSecuritySnapshot();
  const all = runSecurityChecks(snapshot);
  const dismissedRaw = await getSetting<unknown>(SETTING_KEYS.securityDismissed, []);
  const dismissedIds = new Set(Array.isArray(dismissedRaw) ? dismissedRaw.filter((id): id is string => typeof id === "string") : []);
  const active = all.filter((f) => !dismissedIds.has(f.id));
  const { score, categories, bySeverity } = computeScore(active);
  const pool = args.includeDismissed ? all : active;
  const threshold = SEVERITY_RANK[args.minSeverity ?? "info"];
  const filtered = sortFindings(pool).filter(
    (f) => SEVERITY_RANK[f.severity] <= threshold && (!args.category || f.category === args.category),
  );
  const page = pageArray(filtered.map(compactFinding), args);
  return {
    score,
    categories,
    bySeverity,
    dismissedCount: all.length - active.length,
    generatedAt: snapshot.now,
    findings: page.items,
    totalFindings: page.total,
    nextCursor: page.nextCursor,
  };
}

/* ----------------------------------------------------------- investigation */

async function settle<T>(label: string, fn: () => Promise<T>): Promise<T | { unavailable: string }> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return { unavailable: `${label}: ${message}` };
  }
}

export interface InvestigateArgs {
  ip: string;
  includeLogs?: boolean;
  hours?: number;
  userId?: string;
}

/** One-shot IP dossier: identity, firewall/NAT exposure, OTX, related tickets and logs. */
export async function investigateIp(args: InvestigateArgs) {
  const ip = args.ip.trim();
  const [identity, firewall, threatIntel, relatedTickets, logs] = await Promise.all([
    settle("identity", () => gatherIpIdentity(ip)),
    settle("firewall", () => getFirewallContextForIp(ip)),
    settle("threat intel", () => checkThreatIntel(ip, args.userId)),
    settle("related tickets", () => findRelatedThreats({ ips: [ip], signatures: [], limit: 8 })),
    args.includeLogs === false
      ? Promise.resolve({ skipped: "includeLogs=false" })
      : settle("logs", () => queryLogsForTerm(ip, args.hours ?? 24, "all")),
  ]);
  return { ip, identity, firewall, threatIntel, relatedTickets, logs };
}
