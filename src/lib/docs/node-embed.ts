/**
 * Pure helpers for "live node embeds" in documentation pages.
 *
 * A live node embed is a stable inline token stored in the markdown source that
 * the renderer turns into a live `<NodeEmbed>` card. This module owns the token
 * grammar (parse / serialize / split), the embeddable-kind allow list, and the
 * entity → compact-summary mapping. Everything here is environment-agnostic
 * (no "server-only", no Prisma runtime) so it is safe to import from the client
 * renderer, the resolver route, and unit tests alike.
 *
 * Token syntax: `{{node:<kind>:<id>}}`
 *   kind ∈ device | vm | container | network | service
 *   id   ∈ the entity's cuid (url-safe chars)
 * e.g. `{{node:vm:clx8p0q2h0001abcd1234efgh}}`
 */
import { formatBytes } from "@/lib/format";
import type { EntityStatusValue, PowerStateValue } from "@/lib/types";

/** Entity kinds that can be embedded as a live node card in a doc. */
export const EMBEDDABLE_KINDS = ["device", "vm", "container", "network", "service"] as const;
export type NodeEmbedKind = (typeof EMBEDDABLE_KINDS)[number];

/** Narrow an unknown value to an embeddable kind. */
export function isEmbeddableKind(value: unknown): value is NodeEmbedKind {
  return typeof value === "string" && (EMBEDDABLE_KINDS as readonly string[]).includes(value);
}

// ids are cuids today (and cuid2 in future); allow the broader url-safe set so
// the grammar stays forward-compatible without matching whitespace/punctuation.
const ID_PATTERN = "[A-Za-z0-9_-]+";
const KIND_PATTERN = EMBEDDABLE_KINDS.join("|");

/** Global matcher used to split a run of text on every embed token. */
export const NODE_EMBED_TOKEN_RE = new RegExp(`\\{\\{node:(${KIND_PATTERN}):(${ID_PATTERN})\\}\\}`, "g");
/** Whole-string matcher used to parse a single, isolated token. */
const NODE_EMBED_TOKEN_EXACT_RE = new RegExp(`^\\{\\{node:(${KIND_PATTERN}):(${ID_PATTERN})\\}\\}$`);

/** Serialize a `{kind, id}` pair into the exact inline token stored in markdown. */
export function serializeNodeToken(kind: NodeEmbedKind, id: string): string {
  return `{{node:${kind}:${id}}}`;
}

export interface ParsedNodeToken {
  kind: NodeEmbedKind;
  id: string;
}

/** Parse a single token string. Returns null when it is not a well-formed token. */
export function parseNodeToken(token: string): ParsedNodeToken | null {
  const match = NODE_EMBED_TOKEN_EXACT_RE.exec(token.trim());
  if (!match) return null;
  return { kind: match[1] as NodeEmbedKind, id: match[2] };
}

export type NodeEmbedSegment =
  | { type: "text"; value: string }
  | { type: "embed"; kind: NodeEmbedKind; id: string };

/**
 * Split a run of text into ordered literal-text and embed-token segments.
 * Text with no tokens yields a single text segment (the original string), so
 * callers can cheaply detect the no-op case. Empty gaps (e.g. two adjacent
 * tokens) are dropped.
 */
export function splitTextOnToken(text: string): NodeEmbedSegment[] {
  const segments: NodeEmbedSegment[] = [];
  // Fresh regex instance so the shared /g lastIndex is never a hidden dependency.
  const re = new RegExp(NODE_EMBED_TOKEN_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: "text", value: text.slice(lastIndex, match.index) });
    }
    segments.push({ type: "embed", kind: match[1] as NodeEmbedKind, id: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    segments.push({ type: "text", value: text.slice(lastIndex) });
  }
  if (segments.length === 0) segments.push({ type: "text", value: text });
  return segments;
}

// ---------------- entity → compact summary ----------------

/** In-app link to an entity's detail page, matching the inventory/network routes. */
const HREF_BASE: Record<NodeEmbedKind, string> = {
  device: "/inventory/hosts",
  vm: "/inventory/vms",
  container: "/inventory/containers",
  network: "/network",
  service: "/inventory/services",
};

export function nodeEmbedHref(kind: NodeEmbedKind, id: string): string {
  return `${HREF_BASE[kind]}/${id}`;
}

export interface NodeEmbedFact {
  label: string;
  value: string;
}

/**
 * The compact, JSON-safe (strings/enums only — no BigInt/Date) entity summary
 * the resolver returns and the `<NodeEmbed>` card renders.
 */
export interface NodeEmbedSummary {
  kind: NodeEmbedKind;
  id: string;
  name: string;
  href: string;
  /** Sync lifecycle status; null for records without one. */
  status: EntityStatusValue | null;
  /** Power state for vm/container; null for kinds without one. */
  power: PowerStateValue | null;
  /** A few key facts, already formatted for display. */
  facts: NodeEmbedFact[];
}

type Maybe<T> = T | null | undefined;

function fact(label: string, value: Maybe<string | number>): NodeEmbedFact | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? { label, value: text } : null;
}

function facts(...items: (NodeEmbedFact | null)[]): NodeEmbedFact[] {
  return items.filter((f): f is NodeEmbedFact => f !== null);
}

// Minimal structural inputs — the inventory getters return supersets of these.

export interface DeviceSummaryInput {
  id: string;
  name: string;
  status: EntityStatusValue;
  kind: string;
  manufacturer?: Maybe<string>;
  model?: Maybe<string>;
  osName?: Maybe<string>;
  osVersion?: Maybe<string>;
  memoryBytes?: Maybe<bigint | number>;
}

export function buildDeviceSummary(d: DeviceSummaryInput): NodeEmbedSummary {
  const os = [d.osName, d.osVersion].filter(Boolean).join(" ");
  const hardware = [d.manufacturer, d.model].filter(Boolean).join(" ");
  return {
    kind: "device",
    id: d.id,
    name: d.name,
    href: nodeEmbedHref("device", d.id),
    status: d.status,
    power: null,
    facts: facts(
      fact("Type", d.kind),
      fact("OS", os),
      fact("Hardware", hardware),
      fact("Memory", d.memoryBytes != null ? formatBytes(d.memoryBytes) : null),
    ),
  };
}

export interface VmSummaryInput {
  id: string;
  name: string;
  status: EntityStatusValue;
  powerState: PowerStateValue;
  host?: Maybe<{ name: string }>;
  cpuCores?: Maybe<number>;
  memoryBytes?: Maybe<bigint | number>;
  osName?: Maybe<string>;
}

export function buildVmSummary(v: VmSummaryInput): NodeEmbedSummary {
  return {
    kind: "vm",
    id: v.id,
    name: v.name,
    href: nodeEmbedHref("vm", v.id),
    status: v.status,
    power: v.powerState,
    facts: facts(
      fact("Host", v.host?.name),
      fact("vCPU", v.cpuCores),
      fact("Memory", v.memoryBytes != null ? formatBytes(v.memoryBytes) : null),
      fact("OS", v.osName),
    ),
  };
}

export interface ContainerSummaryInput {
  id: string;
  name: string;
  status: EntityStatusValue;
  powerState: PowerStateValue;
  runtime: string;
  host?: Maybe<{ name: string }>;
  memoryBytes?: Maybe<bigint | number>;
}

export function buildContainerSummary(c: ContainerSummaryInput): NodeEmbedSummary {
  return {
    kind: "container",
    id: c.id,
    name: c.name,
    href: nodeEmbedHref("container", c.id),
    status: c.status,
    power: c.powerState,
    facts: facts(
      fact("Runtime", c.runtime),
      fact("Host", c.host?.name),
      fact("Memory", c.memoryBytes != null ? formatBytes(c.memoryBytes) : null),
    ),
  };
}

export interface NetworkSummaryInput {
  id: string;
  name: string;
  status: EntityStatusValue;
  cidr?: Maybe<string>;
  vlanId?: Maybe<number>;
  gateway?: Maybe<string>;
}

export function buildNetworkSummary(n: NetworkSummaryInput): NodeEmbedSummary {
  return {
    kind: "network",
    id: n.id,
    name: n.name,
    href: nodeEmbedHref("network", n.id),
    status: n.status,
    power: null,
    facts: facts(
      fact("CIDR", n.cidr),
      fact("VLAN", n.vlanId),
      fact("Gateway", n.gateway),
    ),
  };
}

export interface ServiceSummaryInput {
  id: string;
  name: string;
  status: EntityStatusValue;
  url?: Maybe<string>;
  port?: Maybe<number>;
  protocol?: Maybe<string>;
  device?: Maybe<{ name: string }>;
  vm?: Maybe<{ name: string }>;
  container?: Maybe<{ name: string }>;
}

export function buildServiceSummary(s: ServiceSummaryInput): NodeEmbedSummary {
  const owner = s.device?.name ?? s.vm?.name ?? s.container?.name ?? null;
  const portProto =
    s.port != null ? `${s.port}${s.protocol ? `/${s.protocol}` : ""}` : null;
  return {
    kind: "service",
    id: s.id,
    name: s.name,
    href: nodeEmbedHref("service", s.id),
    status: s.status,
    power: null,
    facts: facts(
      fact("URL", s.url ? s.url.replace(/^https?:\/\//, "") : null),
      fact("Port", portProto),
      fact("On", owner),
    ),
  };
}
