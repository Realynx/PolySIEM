/**
 * Security advisor contracts — plain serializable types shared by the pure
 * check modules, the scoring engine, the API route, and the client dashboard.
 * No server imports allowed here (client components import these types).
 */

export type SecuritySeverity = "critical" | "high" | "medium" | "low" | "info";

/** Display order, worst first. */
export const SECURITY_SEVERITIES: SecuritySeverity[] = ["critical", "high", "medium", "low", "info"];

/**
 * Default deduction points per finding severity. A finding may override this
 * with an explicit `weight` (e.g. to scale by the number of affected entities
 * or to make a single catastrophic issue heavier). The full deduction pool
 * across all checks sums to ~250 points (SCORE_CEILING) so the 0-100 score is
 * granular: each individual finding moves the needle a little, not a lot.
 */
export const SEVERITY_DEDUCTION: Record<SecuritySeverity, number> = {
  critical: 35,
  high: 18,
  medium: 8,
  low: 3,
  info: 0,
};

export type SecurityCategoryId = "exposure" | "firewall" | "access" | "hardening" | "documentation";

export interface SecurityCategoryDef {
  id: SecurityCategoryId;
  label: string;
  blurb: string;
  /** Max deduction points this category can accrue; drives its 0-100 subscore. */
  ceiling: number;
}

export const SECURITY_CATEGORIES: SecurityCategoryDef[] = [
  {
    id: "exposure",
    label: "Network exposure",
    blurb: "What the internet can reach — port forwards, public DNS names, tunnel edges, open WiFi.",
    ceiling: 65,
  },
  {
    id: "firewall",
    label: "Firewall hygiene",
    blurb: "Rule quality on the edge firewall and the Proxmox guest firewall.",
    ceiling: 55,
  },
  {
    id: "access",
    label: "Access & identity",
    blurb: "PolySIEM accounts and API tokens, integration transport security, credential hygiene.",
    ceiling: 45,
  },
  {
    id: "hardening",
    label: "Host hardening",
    blurb: "SSH key coverage vs password auth, WiFi encryption, exposed services, guest isolation.",
    ceiling: 55,
  },
  {
    id: "documentation",
    label: "Documentation",
    blurb: "Coverage and freshness of the inventory this dashboard exists to document.",
    ceiling: 30,
  },
];

/** Total deduction pool — the reference denominator for the 0-100 score. */
export const SCORE_CEILING = SECURITY_CATEGORIES.reduce((sum, c) => sum + c.ceiling, 0);

export type AffectedKind =
  | "device"
  | "vm"
  | "container"
  | "rule"
  | "port-forward"
  | "dyndns"
  | "tunnel-hostname"
  | "integration"
  | "user"
  | "api-token"
  | "ssh-key"
  | "wireless"
  | "network"
  | "service"
  | "storage";

export interface AffectedEntity {
  kind: AffectedKind;
  /** PolySIEM row id when the entity has a detail page to link to. */
  id?: string;
  name: string;
}

export interface SecurityFinding {
  /** Stable slug — dismissals are keyed on it, so it must not change run-to-run. */
  id: string;
  severity: SecuritySeverity;
  category: SecurityCategoryId;
  title: string;
  detail: string;
  remediation: string;
  affected: AffectedEntity[];
  /**
   * Explicit deduction points; falls back to SEVERITY_DEDUCTION[severity] when
   * absent. Use to scale by affected count (with a per-finding cap) or to make
   * a single high-impact finding heavier — keep a category's total within its
   * ceiling so subscores stay meaningful.
   */
  weight?: number;
}

/* ---------- snapshot input contract (plain JSON shapes of prisma rows) ---------- */

export interface SnapshotUser {
  id: string;
  username: string;
  role: "ADMIN" | "USER";
  disabled: boolean;
  createdAt: string;
  /** Number of sessions ever recorded for this user (0 = never logged in). */
  sessionCount: number;
}

export interface SnapshotApiToken {
  id: string;
  name: string;
  scopes: string[];
  createdAt: string;
  lastUsedAt: string | null;
  revoked: boolean;
  expired: boolean;
  /** Whether an expiry was ever set (a token with none is a standing credential). */
  hasExpiry: boolean;
}

export interface SnapshotIntegration {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  verifyTls: boolean;
  /** baseUrl uses https — TLS verification only matters when it does. */
  usesTls: boolean;
}

export interface SnapshotSshKey {
  id: string;
  name: string;
  keyType: string;
  bits: number | null;
  /** How many machines this key is documented as deployed to (0 = unused). */
  deploymentCount: number;
}

/** A documented service, for the exposed-service hardening check. */
export interface SnapshotService {
  id: string;
  name: string;
  status: string;
  port: number | null;
  protocol: string | null;
  /** Whether the service URL is plain http:// (vs https or none). */
  plaintextHttp: boolean;
}

export interface SnapshotFirewallRule {
  id: string;
  source: string; // "OPNSENSE" | "PROXMOX" | ...
  action: string; // "PASS" | "BLOCK" | "REJECT"
  enabled: boolean;
  status: string; // EntityStatus
  interfaceName: string | null;
  direction: string | null;
  protocol: string | null;
  sourceSpec: string | null;
  destSpec: string | null;
  destPort: string | null;
  description: string | null;
  sequence: number | null;
}

export interface SnapshotPortForward {
  id: string;
  enabled: boolean;
  status: string;
  interfaceName: string | null;
  protocol: string | null;
  sourceSpec: string | null;
  destSpec: string | null;
  destPort: string | null;
  targetIp: string;
  targetPort: string | null;
  description: string | null;
}

export interface SnapshotDyndnsHost {
  id: string;
  hostname: string;
  enabled: boolean;
  status: string;
  /** From metadata.matchesWan (written by the DNS refresher); null = never resolved. */
  matchesWan: boolean | null;
}

export interface SnapshotTunnelHostname {
  id: string;
  tunnelName: string;
  hostname: string;
  /** From metadata.classification: "proxied" | "unproxied-wan-exposed" | "unproxied-other" | "unresolved". */
  classification: string | null;
}

export interface SnapshotWirelessNetwork {
  id: string;
  name: string;
  enabled: boolean;
  status: string;
  security: string | null; // open | wpapsk | wpaeap
  wpaMode: string | null;
}

export interface SnapshotGuest {
  id: string;
  kind: "vm" | "container";
  name: string;
  source: string;
  status: string;
  powerState: string;
  lastSeenAt: string | null;
  hasDescription: boolean;
  /** True when Proxmox datacenter-firewall metadata was synced for this guest. */
  firewallPresent: boolean;
  firewallEnabled: boolean;
  /** Documented SSH keys deployed to this guest (0 = likely password auth). */
  sshKeyCount: number;
}

export interface SnapshotHost {
  id: string;
  name: string;
  kind: string;
  source: string;
  status: string;
  lastSeenAt: string | null;
  hasDescription: boolean;
  /** Documented SSH keys deployed to this host (0 = likely password auth). */
  sshKeyCount: number;
}

/** Everything the checks look at, gathered server-side in one pass. */
export interface SecuritySnapshot {
  /** ISO time reference so the pure checks stay deterministic. */
  now: string;
  /** True when the seeded "admin" account still verifies against "admin". */
  defaultAdminPasswordActive: boolean;
  users: SnapshotUser[];
  apiTokens: SnapshotApiToken[];
  integrations: SnapshotIntegration[];
  sshKeys: SnapshotSshKey[];
  firewallRules: SnapshotFirewallRule[];
  portForwards: SnapshotPortForward[];
  dyndnsHosts: SnapshotDyndnsHost[];
  tunnelHostnames: SnapshotTunnelHostname[];
  wirelessNetworks: SnapshotWirelessNetwork[];
  services: SnapshotService[];
  guests: SnapshotGuest[];
  hosts: SnapshotHost[];
}

/** An all-empty snapshot — the base for tests and for absent integrations. */
export function emptySnapshot(now: string): SecuritySnapshot {
  return {
    now,
    defaultAdminPasswordActive: false,
    users: [],
    apiTokens: [],
    integrations: [],
    sshKeys: [],
    firewallRules: [],
    portForwards: [],
    dyndnsHosts: [],
    tunnelHostnames: [],
    wirelessNetworks: [],
    services: [],
    guests: [],
    hosts: [],
  };
}

/* ---------- report DTO (GET /api/security) ---------- */

export interface SecurityCategoryReport {
  id: SecurityCategoryId;
  label: string;
  blurb: string;
  score: number;
  deducted: number;
  findingCount: number;
}

export interface SecurityReport {
  score: number;
  deducted: number;
  /** Total deduction pool (SCORE_CEILING) — the denominator behind the score. */
  ceiling: number;
  categories: SecurityCategoryReport[];
  bySeverity: Record<SecuritySeverity, number>;
  findings: SecurityFinding[];
  dismissed: SecurityFinding[];
  generatedAt: string;
}
