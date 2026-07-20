import "server-only";

import { ApiError } from "@/lib/api";
import { redactSecrets } from "@/lib/ai/agent/redact";
import { buildOverviewMarkdown } from "@/lib/mcp/overview";
import { getIntegrationHealth as readIntegrationHealth } from "@/lib/services/integrations";
import { getTicket, listTickets } from "@/lib/services/tickets";
import { loadFootprintInput } from "@/lib/topology/footprint-data";
import {
  deriveFootprint,
  focusFootprintGraph,
  type FootprintGraph,
} from "@/lib/topology/footprint";
import type {
  IntegrationHealth,
  SecurityTicketDto,
  TicketSeverityValue,
} from "@/lib/types";

/*
 * Bounded, secret-free read models for the global assistant. These wrappers
 * intentionally do not return raw Prisma rows, raw Elasticsearch evidence, or
 * the full dashboard graph. That keeps tool messages useful to the model and
 * prevents a large lab from consuming the whole conversation context.
 */

const MAX_OVERVIEW_CHARS = 20_000;
const MAX_SUMMARY_CHARS = 1_200;
const MAX_DETAIL_CHARS = 3_000;
const MAX_EVIDENCE_SAMPLES = 12;
const MAX_TOPOLOGY_ITEMS = 24;

function bounded(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function take<T>(items: readonly T[], limit: number): T[] {
  return items.slice(0, limit);
}

function safeIntegrationError(value: string | null): string | null {
  if (!value) return null;
  const withoutEndpoints = redactSecrets(value).replace(
    /\b(?:https?|mock):\/\/[^\s|)]+/gi,
    "[endpoint]",
  );
  return bounded(withoutEndpoints, 1_000);
}

/** A broad orientation snapshot. Markdown is capped even for very large labs. */
export async function getLabOverview(): Promise<{
  markdown: string;
  truncated: boolean;
}> {
  const raw = await buildOverviewMarkdown();
  const markdown = redactSecrets(raw).replace(
    /\b(?:https?|mock):\/\/[^\s|)]+/gi,
    "[endpoint]",
  );
  return {
    markdown:
      markdown.length > MAX_OVERVIEW_CHARS
        ? `${markdown.slice(0, MAX_OVERVIEW_CHARS)}\n\n_Overview truncated._`
        : markdown,
    truncated: markdown.length > MAX_OVERVIEW_CHARS,
  };
}

export interface CompactAssetTopology {
  entityId: string;
  subject: {
    id: string;
    name: string;
    kind: string;
    ips: string[];
    hostId: string | null;
    primaryNetworkId: string | null;
    secondaryNetworkIds: string[];
  };
  networks: Array<{
    id: string;
    name: string;
    vlanId: number | null;
    cidr: string | null;
    category: string;
    machineIds: string[];
  }>;
  machines: Array<{
    id: string;
    name: string;
    kind: string;
    ips: string[];
    hostId: string | null;
  }>;
  reachability: Array<{
    source: string;
    target: string;
    label: string;
    rules: Array<{
      description: string;
      protocol: string | null;
      ports: string | null;
    }>;
  }>;
  inbound: Array<{
    type: "nat" | "tunnel";
    targetId: string;
    label: string;
    enabled: boolean;
    sourceRestricted: boolean;
    detail: Array<{ primary: string; secondary: string }>;
  }>;
  publishedRoutes: Array<{
    hostname: string;
    tunnelId: string;
    tunnelName: string;
    provider: string;
    classification: string;
    serviceTarget: string | null;
    targetId: string;
  }>;
  physicalLinks: Array<{
    switchId: string;
    kind: "uplink" | "carriage";
    targetId: string;
    label: string;
  }>;
  gateways: Array<{
    name: string;
    interfaceName: string | null;
    ipAddress: string | null;
    isDefault: boolean;
    online: boolean | null;
  }>;
  stats: FootprintGraph["stats"];
  truncated: boolean;
}

/** Convert an already-focused graph to a compact model-facing relationship list. */
export function compactFocusedTopology(
  graph: FootprintGraph,
  entityId: string,
): CompactAssetTopology {
  const laneMachines = graph.lanes.flatMap((lane) => lane.machines);
  const allMachines = [...laneMachines, ...graph.firewalls, ...graph.switches];
  const uniqueMachines = [
    ...new Map(allMachines.map((machine) => [machine.id, machine])).values(),
  ];
  const subject = uniqueMachines.find((machine) => machine.id === entityId);
  if (!subject) {
    throw new ApiError(404, "not_found", "Inventory asset not found in topology");
  }

  const networks = take(graph.lanes, MAX_TOPOLOGY_ITEMS).map((lane) => ({
    id: lane.id,
    name: bounded(lane.name, 255) ?? lane.id,
    vlanId: lane.vlanId,
    cidr: lane.cidr,
    category: lane.category,
    machineIds: take(
      lane.machines.map((machine) => machine.id),
      MAX_TOPOLOGY_ITEMS,
    ),
  }));
  const machines = take(uniqueMachines, MAX_TOPOLOGY_ITEMS).map((machine) => ({
    id: machine.id,
    name: bounded(machine.name, 255) ?? machine.id,
    kind: machine.kind,
    ips: take(machine.ips, 16),
    hostId: machine.hostId ?? null,
  }));
  const reachability = take(graph.reachability, MAX_TOPOLOGY_ITEMS).map(
    (edge) => ({
      source: edge.source,
      target: edge.target,
      label: bounded(edge.label, 500) ?? "",
      rules: take(edge.rules, 8).map((rule) => ({
        description: bounded(rule.description, 500) ?? "",
        protocol: rule.protocol,
        ports: rule.ports,
      })),
    }),
  );
  const inbound = take(graph.inbound, MAX_TOPOLOGY_ITEMS).map((edge) => ({
    type: edge.type,
    targetId: edge.targetId,
    label: bounded(edge.label, 500) ?? "",
    enabled: edge.enabled,
    sourceRestricted: edge.sourceRestricted,
    detail: take(edge.detail, 8).map((item) => ({
      primary: bounded(item.primary, 500) ?? "",
      secondary: bounded(item.secondary, 500) ?? "",
    })),
  }));
  const publishedRoutes = take(graph.routes, MAX_TOPOLOGY_ITEMS).map(
    (route) => ({
      hostname: route.hostname,
      tunnelId: route.tunnelId,
      tunnelName: bounded(route.tunnelName, 255) ?? route.tunnelId,
      provider: route.provider,
      classification: route.classification,
      serviceTarget: bounded(route.serviceTarget, 500),
      targetId: route.targetId,
    }),
  );
  const physicalLinks = take(graph.switchLinks, MAX_TOPOLOGY_ITEMS).map(
    (link) => ({
      switchId: link.switchId,
      kind: link.kind,
      targetId: link.targetId,
      label: bounded(link.label, 500) ?? "",
    }),
  );
  const gateways = take(graph.gateways, 12).map((gateway) => ({
    name: bounded(gateway.name, 255) ?? gateway.id,
    interfaceName: bounded(gateway.interfaceName, 255),
    ipAddress: gateway.ipAddress ?? null,
    isDefault: gateway.isDefault,
    online: gateway.online ?? null,
  }));

  const nestedTruncation = graph.lanes.some(
    (lane) => lane.machines.length > MAX_TOPOLOGY_ITEMS,
  );
  return {
    entityId,
    subject: {
      id: subject.id,
      name: bounded(subject.name, 255) ?? subject.id,
      kind: subject.kind,
      ips: take(subject.ips, 16),
      hostId: subject.hostId ?? null,
      primaryNetworkId: subject.primaryNetworkId,
      secondaryNetworkIds: take(subject.secondaryNetworkIds, 16),
    },
    networks,
    machines,
    reachability,
    inbound,
    publishedRoutes,
    physicalLinks,
    gateways,
    stats: graph.stats,
    truncated:
      graph.lanes.length > networks.length ||
      uniqueMachines.length > machines.length ||
      graph.reachability.length > reachability.length ||
      graph.inbound.length > inbound.length ||
      graph.routes.length > publishedRoutes.length ||
      graph.switchLinks.length > physicalLinks.length ||
      graph.gateways.length > gateways.length ||
      nestedTruncation,
  };
}

/** Asset-scoped network placement, policy reachability, and inbound exposure. */
export async function getAssetTopology(
  entityId: string,
): Promise<CompactAssetTopology> {
  const focused = focusFootprintGraph(
    deriveFootprint(await loadFootprintInput()),
    entityId,
  );
  if (!focused) {
    throw new ApiError(404, "not_found", "Inventory asset not found in topology");
  }
  return compactFocusedTopology(focused, entityId);
}

function boundedRefs(ticket: SecurityTicketDto) {
  return ticket.refs
    ? {
        srcIps: take(ticket.refs.srcIps ?? [], 20),
        destIps: take(ticket.refs.destIps ?? [], 20),
        signatures: take(ticket.refs.signatures ?? [], 20).map(
          (value) => bounded(value, 500) ?? "",
        ),
        hosts: take(ticket.refs.hosts ?? [], 20),
      }
    : null;
}

/** Compact ticket list row; evidence and investigation transcripts are omitted. */
export function securityTicketSummary(ticket: SecurityTicketDto) {
  return {
    id: ticket.id,
    title: bounded(ticket.title, 300) ?? ticket.id,
    summary: bounded(ticket.summary, MAX_SUMMARY_CHARS),
    severity: ticket.severity,
    status: ticket.status,
    category: ticket.category,
    refs: boundedRefs(ticket),
    timesSeen: ticket.timesSeen,
    lastSeenAt: ticket.lastSeenAt,
    investigationStatus: ticket.investigationStatus,
    verdict: ticket.investigation?.verdict ?? null,
    confidence: ticket.investigation?.confidence ?? null,
  };
}

export interface SecurityTicketListInput {
  status?: "open" | "closed" | "all";
  severities?: TicketSeverityValue[];
  query?: string;
  limit?: number;
}

/** List bounded security-ticket summaries, most severe/recent first. */
export async function listSecurityTicketSummaries(
  input: SecurityTicketListInput = {},
) {
  const limit = Math.min(Math.max(input.limit ?? 20, 1), 50);
  const result = await listTickets({
    status: input.status ?? "open",
    severity: input.severities?.join(","),
    q: input.query,
    page: 1,
    pageSize: limit,
  });
  return {
    total: result.total,
    openCounts: result.openCounts,
    tickets: result.tickets.map(securityTicketSummary),
    truncated: result.total > result.tickets.length,
  };
}

/** Full-enough ticket context for chat, with raw structured evidence removed. */
export function compactSecurityTicketContext(ticket: SecurityTicketDto) {
  const evidenceSamples = take(
    ticket.evidence?.samples ?? [],
    MAX_EVIDENCE_SAMPLES,
  ).map((sample) => ({
    timestamp: sample.timestamp,
    index: bounded(sample.index, 255),
    message: bounded(sample.message, 800) ?? "",
  }));
  const report = ticket.investigation;
  return {
    ...securityTicketSummary(ticket),
    suggestions: bounded(ticket.suggestions, MAX_DETAIL_CHARS),
    resolution: bounded(ticket.resolution, MAX_DETAIL_CHARS),
    createdBy: ticket.createdBy,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    closedAt: ticket.closedAt,
    closedByName: ticket.closedByName,
    evidence: ticket.evidence
      ? {
          scope: bounded(ticket.evidence.scope, 255),
          timeRange: ticket.evidence.timeRange ?? null,
          sampleCount: ticket.evidence.samples.length,
          samples: evidenceSamples,
          truncated: ticket.evidence.samples.length > evidenceSamples.length,
        }
      : null,
    investigation: report
      ? {
          summary: bounded(report.summary, MAX_DETAIL_CHARS),
          verdict: report.verdict,
          confidence: report.confidence,
          ips: take(report.ips, 20).map((ip) => ({
            ip: ip.ip,
            scope: ip.scope,
            identity: bounded(ip.identity, 800),
            reverseDns: bounded(ip.reverseDns, 500),
            asn: bounded(ip.asn, 500),
            reputation: bounded(ip.reputation, 800),
            activity: bounded(ip.activity, 1_200),
          })),
          resolution: take(report.resolution, 20).map((step) => ({
            order: step.order,
            action: bounded(step.action, 1_000) ?? "",
            rationale: bounded(step.rationale, 1_000) ?? "",
            changesState: step.changesState,
            command: bounded(step.command, 1_000),
          })),
          generatedAt: report.meta.generatedAt,
          model: bounded(report.meta.model, 255),
          externalSourcesUsed: take(report.meta.externalSourcesUsed, 12),
        }
      : null,
  };
}

export async function getSecurityTicketContext(id: string) {
  return compactSecurityTicketContext(await getTicket(id));
}

/** Integration state only: never base URLs, settings, or credentials. */
export async function getIntegrationHealth(): Promise<IntegrationHealth[]> {
  return (await readIntegrationHealth()).map((integration) => ({
    id: integration.id,
    type: integration.type,
    name: bounded(integration.name, 255) ?? integration.id,
    enabled: integration.enabled,
    lastSyncAt: integration.lastSyncAt,
    lastSyncStatus: integration.lastSyncStatus,
    lastSyncError: safeIntegrationError(integration.lastSyncError),
  }));
}
