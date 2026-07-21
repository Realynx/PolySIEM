/**
 * Shared cross-cutting types (safe for client and server import).
 * Prisma model types come from "@prisma/client" on the server; the types here
 * are the serializable shapes used across API responses and UI components.
 */

export type EntityKind =
  "device" | "vm" | "container" | "network" | "service" | "doc";

/**
 * Kinds a global-search result can have: the inventory entities plus "ip"
 * (an address matched from IpAddress / DHCP leases / ARP neighbors).
 * Kept separate from EntityKind so exhaustive entity maps (tags, etc.) are
 * unaffected — "ip" is a search hit, not a taggable entity.
 */
export type SearchKind = EntityKind | "ip";

export const ENTITY_KINDS: SearchKind[] = [
  "device",
  "vm",
  "container",
  "network",
  "service",
  "doc",
  "ip",
];

export type SourceValue = "MANUAL" | "PROXMOX" | "OPNSENSE" | "UNIFI" | "CLOUDFLARE" | "TAILSCALE" | "EDGE_NAT_SERVER";
export type EntityStatusValue = "ACTIVE" | "STALE" | "REMOVED";
export type PowerStateValue = "RUNNING" | "STOPPED" | "PAUSED" | "UNKNOWN";
export type SyncStatusValue = "RUNNING" | "SUCCESS" | "PARTIAL" | "FAILED";

export interface SearchResult {
  kind: SearchKind;
  id: string;
  name: string;
  subtitle?: string;
  href: string;
}

export type IntegrationTypeValue =
  "PROXMOX" | "OPNSENSE" | "ELASTICSEARCH" | "UNIFI" | "OTX" | "CLOUDFLARE" | "TAILSCALE" | "EDGE_NAT_SERVER" | "CENSYS" | "SECURITYTRAILS";

/** Integrations queried live at view time — they have no inventory sync loop. */
export function isLiveQueryType(type: IntegrationTypeValue): boolean {
  return type === "ELASTICSEARCH" || type === "OTX" || type === "CENSYS" || type === "SECURITYTRAILS";
}

export interface IntegrationHealth {
  id: string;
  type: IntegrationTypeValue;
  name: string;
  enabled: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: SyncStatusValue | null;
  lastSyncError: string | null;
}

/** A normalized log entry returned by the Elasticsearch integration. */
export interface LogEntry {
  id: string;
  timestamp: string;
  level: string | null;
  message: string;
  host: string | null;
  index: string;
  raw?: Record<string, unknown>;
}

export interface LogStats {
  total: number;
  byLevel: { level: string; count: number }[];
  overTime: { bucket: string; count: number }[];
}

/** A secret-free Elasticsearch event associated with one inventory asset. */
export interface AssociatedLogRow {
  id: string;
  index: string;
  timestamp: string;
  kind: "http" | "error" | "event";
  host: string | null;
  message: string | null;
  error: string | null;
  url: string | null;
  scheme: string | null;
  domain: string | null;
  path: string | null;
  originService: string | null;
  sourceIp: string | null;
  destinationIp: string | null;
  method: string | null;
  statusCode: string | null;
  userAgent: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  level: string | null;
  application: string | null;
  user: string | null;
  requestId: string | null;
  details: { label: string; value: string }[];
  /** Original embedded structured event, formatted for inspection/copying. */
  eventJson: string | null;
}

export interface AssociatedLogsResponse {
  rows: AssociatedLogRow[];
  total: number;
  source: { id: string; name: string };
  matchedBy: { ips: string[]; names: string[]; domains: string[] };
}

export interface SyncRunStats {
  [entityFamily: string]: { created: number; updated: number; stale: number };
}

/* ---------- threat watch (AI log scanning) ---------- */

export type TicketStatusValue = "OPEN" | "CLOSED";
export type TicketSeverityValue =
  "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export const TICKET_SEVERITIES: TicketSeverityValue[] = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
];

export const TICKET_CATEGORIES = [
  "anomaly",
  "ids-alert",
  "correlation",
  "recon",
  "auth",
  "traffic",
  "other",
] as const;
export type TicketCategory = (typeof TICKET_CATEGORIES)[number];

/** One log event kept as ticket evidence. */
export interface TicketEvidenceSample {
  timestamp: string;
  message: string;
  index?: string;
  raw?: Record<string, unknown>;
}

export interface TicketRefs {
  srcIps?: string[];
  destIps?: string[];
  signatures?: string[];
  hosts?: string[];
}

export interface TicketEvidence {
  samples: TicketEvidenceSample[];
  scope?: string;
  timeRange?: { from: string; to: string };
}

/** Serialized SecurityTicket row as returned by /api/logs/tickets. */
export interface SecurityTicketDto {
  id: string;
  title: string;
  summary: string;
  severity: TicketSeverityValue;
  status: TicketStatusValue;
  category: string;
  createdBy: string; // "ai" | "user"
  suggestions: string | null;
  refs: TicketRefs | null;
  evidence: TicketEvidence | null;
  /** Structured AI investigation report; null until an investigation has run. */
  investigation: import("@/lib/ai/agent/contract").InvestigationReport | null;
  investigatedAt: string | null;
  /** Background investigation lifecycle; null when never investigated. */
  investigationStatus:
    import("@/lib/ai/agent/contract").InvestigationStatus | null;
  /** Live progress while queued/running; null when idle or finished. */
  investigationProgress:
    import("@/lib/ai/agent/contract").InvestigationProgress | null;
  timesSeen: number;
  lastSeenAt: string;
  scanRunId: string | null;
  closedAt: string | null;
  closedByName: string | null;
  resolution: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiScanRunStats {
  docsScanned?: number;
  suricataAlerts?: number;
  ticketsCreated?: number;
  ticketsUpdated?: number;
  scopesRun?: string[];
}

/** Serialized AiScanRun row as returned by /api/logs/scan/runs. */
export interface AiScanRunDto {
  id: string;
  status: SyncStatusValue;
  trigger: string;
  model: string;
  startedAt: string;
  finishedAt: string | null;
  timeRangeFrom: string;
  timeRangeTo: string;
  stats: AiScanRunStats | null;
  error: string | null;
}

/** AI scan configuration (AppSetting "ai_scan_config"). */
export interface AiScanConfigDto {
  enabled: boolean;
  provider?: "ollama" | "openai" | "deepseek" | "anthropic" | "azure";
  baseUrl: string;
  model: string;
  integrationId: string; // "" = first enabled ES integration
  intervalMinutes: number;
  lookbackMinutes: number;
  maxLogsPerQuery: number;
  scopes: { suricata: boolean; cloudflared: boolean; general: boolean };
  customIndices: string; // comma-separated extra index patterns
}

export interface TicketListResponse {
  tickets: SecurityTicketDto[];
  total: number;
  openCounts: Record<TicketSeverityValue, number>;
}

/* ---------- threat intelligence (AlienVault OTX) ---------- */

export type OtxFeedValue = "subscribed" | "activity";

/** Source-switcher id for a user's personal OTX key (vs. an integration id). */
export const PERSONAL_OTX_SOURCE_ID = "personal";

/** One indicator of compromise inside a pulse. */
export interface PulseIndicatorView {
  indicator: string;
  /** OTX indicator type, e.g. "IPv4", "domain", "FileHash-SHA256", "URL". */
  type: string;
  description: string | null;
}

/** A normalized OTX pulse (threat report) as rendered in the feed. */
export interface PulseView {
  id: string;
  name: string;
  description: string;
  author: string;
  created: string;
  modified: string;
  /** Traffic Light Protocol marking, lowercase ("white", "green", "amber", "red"). */
  tlp: string;
  adversary: string | null;
  tags: string[];
  targetedCountries: string[];
  malwareFamilies: string[];
  attackIds: string[];
  references: string[];
  indicatorCount: number;
  indicatorTypeCounts: { type: string; count: number }[];
  /** Capped list for the detail sheet — indicatorCount may be larger. */
  indicators: PulseIndicatorView[];
  /** Link to the pulse on otx.alienvault.com. */
  url: string;
}

/** A pulse in a signed-in user's feed, annotated with their reading state. */
export interface ThreatIntelPulseView extends PulseView {
  readAt: string | null;
}

export interface ThreatIntelFeedResponse {
  pulses: ThreatIntelPulseView[];
  /** Reports on this page that the current user has not opened. */
  unreadCount: number;
  /** Total pulses on the remote feed (falls back to cachedCount when unknown). */
  totalCount: number;
  /** Pulses held in the local incremental cache — the navigable set. */
  cachedCount: number;
  page: number;
  hasMore: boolean;
  feed: OtxFeedValue;
  source: { id: string; name: string };
}

/** One threat-feed indicator that actually appeared in the local logs. */
export interface IocMatch {
  indicator: string;
  hitCount: number;
  lastSeen: string | null;
  pulses: { id: string; name: string }[];
  samples: { timestamp: string; message: string; index: string }[];
}

export interface IocMatchReport {
  matches: IocMatch[];
  /** Public IP indicators actually checked against the logs. */
  scannedIndicators: number;
  pulsesConsidered: number;
  windowHours: number;
  /** Elasticsearch integration the logs were searched in; null when none is configured. */
  logSource: { id: string; name: string } | null;
}

/* ---------- network insights (live Elasticsearch dashboard) ---------- */

/**
 * One dashboard panel's result. Rows are a capped, newest-first sample;
 * `total` is the full match count in the window. A per-panel `error` means
 * only this panel failed — the rest of the page still renders.
 */
export interface InsightPanel<TRow> {
  total: number;
  rows: TRow[];
  error?: string;
}

/** One aggregated geo cell for the traffic-origins world map. */
export interface OriginPoint {
  lat: number;
  lon: number;
  count: number;
  series: "ids" | "visitors";
}

/** Traffic-origins panel: world-map points + the merged country table. */
export interface OriginsPanel extends InsightPanel<CountryOriginRow> {
  points: OriginPoint[];
}

/** Merged country series for the traffic-origins list under the map. */
export interface CountryOriginRow {
  country: string;
  /** Suricata IDS events whose source geo-resolves to this country. */
  ids: number;
  /** Cloudflared tunnel requests from visitors in this country. */
  visitors: number;
}

export interface InboundIpRow {
  ip: string;
  count: number;
}

export interface BootLogRow {
  timestamp: string;
  message: string;
}

export interface CloudflaredConnectionRow {
  timestamp: string;
  host: string | null;
  url: string | null;
  sourceIp: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  userAgent: string | null;
}

export interface CloudflaredMessageRow {
  timestamp: string;
  host: string | null;
  error: string;
}

export interface IdsAlertRow {
  timestamp: string;
  sourceAddress: string | null;
  userAgent: string | null;
  category: string | null;
  signature: string | null;
  destinationAddress: string | null;
}

export interface IdsSshRow {
  timestamp: string;
  iface: string | null;
  clientSoftware: string | null;
  serverSoftware: string | null;
  sourceAddress: string | null;
  destinationAddress: string | null;
  direction: string | null;
}

export interface NextcloudLogRow {
  timestamp: string;
  user: string | null;
  app: string | null;
  message: string | null;
  remoteAddr: string | null;
  userAgent: string | null;
  method: string | null;
  url: string | null;
}

export interface OpnsenseWebRow {
  timestamp: string;
  sourceIp: string | null;
  method: string | null;
  statusCode: string | null;
  url: string | null;
  userAgent: string | null;
  bytes: number | null;
}

export interface IdsTlsRow {
  timestamp: string;
  destinationAddress: string | null;
  destinationPort: number | null;
  organization: string | null;
  protocol: string | null;
  direction: string | null;
}

export interface IdsOverviewRow {
  timestamp: string;
  eventType: string | null;
  sourceAddress: string | null;
  sourceOrg: string | null;
  anomalyEvent: string | null;
  destinationAddress: string | null;
  transport: string | null;
}

/** IDS overview additionally carries the event-type breakdown for the bars. */
export interface IdsOverviewPanel extends InsightPanel<IdsOverviewRow> {
  types: { type: string; count: number }[];
}

export interface NetworkInsightsStats {
  totalEvents: number;
  idsAlerts: number;
  cloudflaredRequests: number;
  sourceCountries: number;
}

/** Full payload of /api/logs/insights — the Kibana "Network Insights" recreation. */
export interface NetworkInsights {
  windowHours: number;
  /** Auto-detected search targets per source family (empty when detection found nothing). */
  detected: Partial<Record<"suricata" | "cloudflared" | "nextcloud", string[]>>;
  stats: NetworkInsightsStats;
  origins: OriginsPanel;
  cloudflareInbound: InsightPanel<InboundIpRow>;
  bootLogs: InsightPanel<BootLogRow>;
  cloudflaredConnections: InsightPanel<CloudflaredConnectionRow>;
  cloudflaredMessages: InsightPanel<CloudflaredMessageRow>;
  idsAlerts: InsightPanel<IdsAlertRow>;
  idsSsh: InsightPanel<IdsSshRow>;
  nextcloud: InsightPanel<NextcloudLogRow>;
  opnsenseWeb: InsightPanel<OpnsenseWebRow>;
  idsTls: InsightPanel<IdsTlsRow>;
  ids: IdsOverviewPanel;
}

export interface NetworkInsightsResponse extends NetworkInsights {
  source: { id: string; name: string };
}

/** Theme colors offered in the picker; "blue" is the install default. */
export const THEME_COLORS = [
  "blue",
  "emerald",
  "violet",
  "amber",
  "rose",
] as const;
export type ThemeColor = (typeof THEME_COLORS)[number];
export const DEFAULT_THEME_COLOR: ThemeColor = "blue";

export const THEME_MODES = ["light", "dark", "system"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];
