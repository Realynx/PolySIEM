/**
 * Pure parsers for external-lookup responses (RDAP-WHOIS, reverse DNS,
 * AbuseIPDB). No network, no server-only imports — the tools do the I/O and
 * hand the payloads here so parsing is unit-testable with recorded fixtures.
 */

/* ------------------------------- reverse DNS ------------------------------ */

/** First PTR hostname (trailing dot stripped), or null when none resolved. */
export function pickPtr(hostnames: readonly string[]): string | null {
  for (const name of hostnames) {
    const trimmed = name.trim().replace(/\.$/, "");
    if (trimmed) return trimmed;
  }
  return null;
}

/* --------------------------------- RDAP ----------------------------------- */

interface VcardEntry {
  [index: number]: unknown;
}

interface RdapEntity {
  handle?: string;
  roles?: string[];
  vcardArray?: [string, VcardEntry[]];
  entities?: RdapEntity[];
}

export interface RdapResponse {
  name?: string;
  handle?: string;
  country?: string;
  startAddress?: string;
  endAddress?: string;
  type?: string;
  entities?: RdapEntity[];
  arin_originas0_originautnums?: number[];
  cidr0_cidrs?: Array<{ v4prefix?: string; v6prefix?: string; length?: number }>;
  remarks?: Array<{ description?: string[] }>;
}

export interface AsnInfo {
  /** Organisation / network name. */
  org: string | null;
  /** ASN like "AS13335" when present. */
  asn: string | null;
  /** ISO country code. */
  country: string | null;
  /** One-line summary for IpFindings.asn. */
  summary: string | null;
}

/** Pull the "fn" (full name) field out of a jCard/vcardArray. */
function vcardName(entity: RdapEntity): string | null {
  const vcard = entity.vcardArray?.[1];
  if (!Array.isArray(vcard)) return null;
  for (const field of vcard) {
    if (Array.isArray(field) && field[0] === "fn" && typeof field[3] === "string" && field[3].trim()) {
      return field[3].trim();
    }
  }
  return null;
}

/** Search for an entity org name, honouring role priority order. */
function findOrg(entities: RdapEntity[] | undefined, preferredRoles: string[]): string | null {
  if (!entities) return null;
  // Honour role priority: a registrant name beats a technical-contact name.
  for (const role of preferredRoles) {
    for (const entity of entities) {
      if (entity.roles?.includes(role)) {
        const name = vcardName(entity);
        if (name) return name;
      }
    }
  }
  // Otherwise, the first entity (or nested entity) that has a name at all.
  for (const entity of entities) {
    const name = vcardName(entity);
    if (name) return name;
    const nested = findOrg(entity.entities, preferredRoles);
    if (nested) return nested;
  }
  return null;
}

/** Extract org / ASN / country from an RDAP IP-network response. */
export function parseRdap(res: RdapResponse): AsnInfo {
  const org =
    findOrg(res.entities, ["registrant", "administrative", "abuse", "technical"]) ?? res.name ?? null;
  const country = res.country?.trim() || null;

  let asn: string | null = null;
  const autnums = res.arin_originas0_originautnums;
  if (Array.isArray(autnums) && autnums.length > 0 && typeof autnums[0] === "number") {
    asn = `AS${autnums[0]}`;
  }

  const parts = [org, asn, country].filter((p): p is string => Boolean(p));
  const summary = parts.length ? `${org ?? "unknown org"}${asn ? ` (${asn}${country ? `, ${country}` : ""})` : country ? ` (${country})` : ""}` : null;

  return { org, asn, country, summary };
}

/* ------------------------------- AbuseIPDB -------------------------------- */

export interface AbuseIpdbResponse {
  data?: {
    ipAddress?: string;
    abuseConfidenceScore?: number;
    totalReports?: number;
    countryCode?: string;
    isp?: string;
    domain?: string;
    isWhitelisted?: boolean;
    usageType?: string;
    lastReportedAt?: string | null;
  };
}

export interface ReputationInfo {
  score: number | null;
  totalReports: number | null;
  summary: string;
  /** True when the confidence score is high enough to treat as malicious. */
  flagged: boolean;
}

/** Turn an AbuseIPDB /check response into a one-line reputation verdict. */
export function parseAbuseIpdb(res: AbuseIpdbResponse): ReputationInfo {
  const data = res.data ?? {};
  const score = typeof data.abuseConfidenceScore === "number" ? data.abuseConfidenceScore : null;
  const totalReports = typeof data.totalReports === "number" ? data.totalReports : null;
  const flagged = (score ?? 0) >= 25;

  if (score === null) {
    return { score, totalReports, summary: "AbuseIPDB returned no confidence score", flagged: false };
  }

  const bits = [`AbuseIPDB confidence ${score}%`];
  if (totalReports !== null) bits.push(`${totalReports} report${totalReports === 1 ? "" : "s"}`);
  if (data.usageType) bits.push(data.usageType);
  if (data.isWhitelisted) bits.push("whitelisted");
  const summary = bits.join(", ");
  return { score, totalReports, summary, flagged };
}
