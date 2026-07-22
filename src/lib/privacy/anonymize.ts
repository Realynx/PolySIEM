/**
 * Deterministic anonymization helpers for "anonymous mode" (safe for client
 * and server). The same real value always maps to the same fake value, and
 * IPv4 subnets are preserved (same real /24 → same fake /24) so topology
 * views stay coherent in screenshots/recordings.
 */

/* ------------------------------------------------------------------ */
/* Hashing                                                             */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit hash. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/* ------------------------------------------------------------------ */
/* Wordlists (48 x 48)                                                 */
/* ------------------------------------------------------------------ */

const ADJECTIVES = [
  "amber", "arctic", "bold", "brisk", "calm", "candid", "cedar", "civic",
  "coral", "crisp", "daring", "deft", "dusky", "eager", "early", "fabled",
  "fleet", "gentle", "gilded", "glad", "golden", "grand", "hardy", "hazel",
  "humble", "ivory", "jolly", "keen", "kindly", "lively", "lucid", "lunar",
  "mellow", "misty", "noble", "nimble", "opal", "placid", "plucky", "quiet",
  "rapid", "rustic", "silver", "solid", "stout", "sunny", "tidy", "vivid",
];

const NOUNS = [
  "otter", "badger", "falcon", "heron", "lynx", "marten", "osprey", "puffin",
  "raven", "robin", "seal", "stork", "swift", "tern", "vole", "wren",
  "beaver", "bison", "crane", "dove", "elk", "ferret", "finch", "fox",
  "gecko", "hare", "ibis", "jay", "kestrel", "koala", "lark", "lemur",
  "mole", "moose", "newt", "owl", "panda", "pika", "quail", "rook",
  "sparrow", "stoat", "swan", "tapir", "toad", "walrus", "weasel", "yak",
];

/* ------------------------------------------------------------------ */
/* Simple value anonymizers                                            */
/* ------------------------------------------------------------------ */

/** Deterministic word-pair pseudonym, e.g. "brisk-otter". */
export function anonymizeName(value: string): string {
  if (value.trim() === "") return value;
  const h = fnv1a(`name:${value}`);
  const adj = ADJECTIVES[h % ADJECTIVES.length];
  const noun = NOUNS[Math.floor(h / ADJECTIVES.length) % NOUNS.length];
  return `${adj}-${noun}`;
}

/** "user-" + 4 lowercase base36 chars derived from the hash. */
export function anonymizeUsername(value: string): string {
  if (value.trim() === "") return value;
  const h = fnv1a(`user:${value}`);
  return `user-${(h % 36 ** 4).toString(36).padStart(4, "0")}`;
}

/* ------------------------------------------------------------------ */
/* IPv4                                                                */
/* ------------------------------------------------------------------ */

const IPV4_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function parseIpv4(ip: string): [number, number, number, number] | null {
  const m = IPV4_RE.exec(ip);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  const c = Number(m[3]);
  const d = Number(m[4]);
  if (a > 255 || b > 255 || c > 255 || d > 255) return null;
  return [a, b, c, d];
}

function hashHostOctet(octet: number): number {
  return fnv1a(`v4host:${octet}`) % 256;
}

const DOC_RANGES = ["192.0.2", "198.51.100", "203.0.113"];

/**
 * Subnet-preserving IPv4 anonymizer. The /24 network portion and the host
 * octet are hashed separately, so members of the same real /24 land in the
 * same fake /24. RFC1918 stays in its private family; public addresses map
 * into the documentation ranges. Loopback/link-local and invalid input are
 * returned unchanged.
 */
export function anonymizeIpv4(ip: string): string {
  const parsed = parseIpv4(ip);
  if (!parsed) return ip;
  const [a, b, c, d] = parsed;
  if (a === 127) return ip; // loopback
  if (a === 169 && b === 254) return ip; // link-local
  const net = fnv1a(`v4net:${a}.${b}.${c}`);
  const host = hashHostOctet(d);
  if (a === 10) return `10.${net & 0xff}.${(net >>> 8) & 0xff}.${host}`;
  if (a === 192 && b === 168) return `192.168.${net & 0xff}.${host}`;
  if (a === 172 && b >= 16 && b <= 31) {
    return `172.${16 + (net & 0x0f)}.${(net >>> 8) & 0xff}.${host}`;
  }
  return `${DOC_RANGES[net % 3]}.${host}`;
}

/* ------------------------------------------------------------------ */
/* IPv6                                                                */
/* ------------------------------------------------------------------ */

/** Expand an IPv6 literal to its 8 numeric groups, or null if invalid. */
function expandIpv6(ip: string): number[] | null {
  if (ip.includes(".")) return null; // embedded IPv4 forms not supported
  const halves = ip.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (s: string): number[] | null => {
    if (s === "") return [];
    const out: number[] = [];
    for (const g of s.split(":")) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };

  if (halves.length === 1) {
    const groups = parseGroups(ip);
    return groups !== null && groups.length === 8 ? groups : null;
  }
  const left = parseGroups(halves[0]);
  const right = parseGroups(halves[1]);
  if (left === null || right === null) return null;
  if (left.length + right.length > 7) return null;
  const fill = new Array<number>(8 - left.length - right.length).fill(0);
  return [...left, ...fill, ...right];
}

/**
 * Map an IPv6 address into 2001:db8::/32. The network half (first 4 groups)
 * and host half (last 4 groups) are hashed separately, so addresses sharing
 * a real /64 share their fake network groups. Non-IPv6 input is returned
 * unchanged.
 */
export function anonymizeIpv6(ip: string): string {
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  const netHash = fnv1a(`v6net:${groups.slice(0, 4).join(",")}`);
  const hostKey = groups.slice(4).join(",");
  const hostHashA = fnv1a(`v6hostA:${hostKey}`);
  const hostHashB = fnv1a(`v6hostB:${hostKey}`);
  const g = (n: number) => (n & 0xffff).toString(16);
  return [
    "2001", "db8",
    g(netHash), g(netHash >>> 16),
    g(hostHashA), g(hostHashA >>> 16),
    g(hostHashB), g(hostHashB >>> 16),
  ].join(":");
}

/* ------------------------------------------------------------------ */
/* MAC                                                                 */
/* ------------------------------------------------------------------ */

const MAC_RE = /^[0-9A-Fa-f]{2}([:-])(?:[0-9A-Fa-f]{2}\1){4}[0-9A-Fa-f]{2}$/;

/**
 * "02:" + 5 hash-derived octets (locally-administered). Preserves the
 * input's separator (":" or "-") and letter case. Invalid input unchanged.
 */
export function anonymizeMac(mac: string): string {
  const m = MAC_RE.exec(mac);
  if (!m) return mac;
  const sep = m[1];
  const uppercase = /[A-F]/.test(mac) && !/[a-f]/.test(mac);
  const norm = mac.toLowerCase().replace(/-/g, ":");
  const h1 = fnv1a(`macA:${norm}`);
  const h2 = fnv1a(`macB:${norm}`);
  const octets = [h1 & 0xff, (h1 >>> 8) & 0xff, (h1 >>> 16) & 0xff, (h1 >>> 24) & 0xff, h2 & 0xff];
  const out = ["02", ...octets.map((o) => o.toString(16).padStart(2, "0"))].join(sep);
  return uppercase ? out.toUpperCase() : out;
}

/* ------------------------------------------------------------------ */
/* CIDR                                                                */
/* ------------------------------------------------------------------ */

function looksLikeCidr(value: string): boolean {
  const slash = value.indexOf("/");
  if (slash <= 0) return false;
  const addr = value.slice(0, slash);
  const prefix = value.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefix)) return false;
  return parseIpv4(addr) !== null || expandIpv6(addr) !== null;
}

/**
 * Anonymize a CIDR's address with the same subnet-preserving hashing as
 * anonymizeIpv4/anonymizeIpv6 and keep the prefix length. For IPv4 prefixes
 * <= 24 the fake host octet is zeroed, so a /24's network address lands in
 * the exact fake /24 its member IPs map into. Invalid input unchanged.
 */
export function anonymizeCidr(cidr: string): string {
  const slash = cidr.indexOf("/");
  if (slash <= 0) return cidr;
  const addr = cidr.slice(0, slash);
  const prefixStr = cidr.slice(slash + 1);
  if (!/^\d{1,3}$/.test(prefixStr)) return cidr;
  const prefix = Number(prefixStr);

  if (parseIpv4(addr)) {
    if (prefix > 32) return cidr;
    const fake = anonymizeIpv4(addr);
    if (fake === addr) return cidr; // loopback/link-local families stay put
    if (prefix <= 24) {
      const octets = fake.split(".");
      octets[3] = "0";
      return `${octets.join(".")}/${prefix}`;
    }
    return `${fake}/${prefix}`;
  }
  if (expandIpv6(addr)) {
    if (prefix > 128) return cidr;
    return `${anonymizeIpv6(addr)}/${prefix}`;
  }
  return cidr;
}

/* ------------------------------------------------------------------ */
/* Hostname / URL                                                      */
/* ------------------------------------------------------------------ */

/**
 * IP literals delegate to the IP anonymizers. Otherwise the first DNS label
 * is pseudonymized: multi-label hosts become "<fake>.example.com", single
 * labels become just the fake name. A trailing dot is preserved.
 */
export function anonymizeHostname(host: string): string {
  if (host.trim() === "") return host;
  const trailingDot = host.length > 1 && host.endsWith(".");
  const core = trailingDot ? host.slice(0, -1) : host;
  if (parseIpv4(core)) return anonymizeIpv4(core) + (trailingDot ? "." : "");
  if (core.includes(":") && expandIpv6(core)) return anonymizeIpv6(core);
  const labels = core.split(".");
  const fake = anonymizeName(labels[0]);
  const out = labels.length > 1 ? `${fake}.example.com` : fake;
  return out + (trailingDot ? "." : "");
}

/**
 * Replace the hostname, keep scheme + port, scrub the path, and drop the
 * query, fragment, and userinfo (they can carry identifiers). Unparseable
 * input falls back to scrubText.
 */
export function anonymizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return scrubText(url);
  }
  if (!parsed.hostname) return scrubText(url);
  let host: string;
  if (parsed.hostname.startsWith("[") && parsed.hostname.endsWith("]")) {
    host = `[${anonymizeIpv6(parsed.hostname.slice(1, -1))}]`;
  } else {
    host = anonymizeHostname(parsed.hostname);
  }
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//${host}${port}${scrubText(parsed.pathname)}`;
}

/* ------------------------------------------------------------------ */
/* Free-text scrubbing                                                 */
/* ------------------------------------------------------------------ */

// Built with the RegExp constructor because lookbehind is an ES2018 regex
// feature and tsconfig targets ES2017 (runtime support is fine in every
// environment LabDash runs in).
const MAC_TEXT_RE = new RegExp(
  "(?<![0-9A-Fa-f:])(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f:])" +
    "|(?<![0-9A-Fa-f-])(?:[0-9A-Fa-f]{2}-){5}[0-9A-Fa-f]{2}(?![0-9A-Fa-f-])",
  "g",
);

// Candidate runs of hex digits and colons; each match is validated as real
// IPv6 (>= 2 colons and a valid expansion) before being replaced, so times
// like "12:30" and plain hex words pass through untouched.
const IPV6_TEXT_RE = new RegExp("(?<![0-9A-Za-z:.])[0-9A-Fa-f:]{2,}(?![0-9A-Za-z:])", "g");

// IPv4 with an optional /prefix; the lookarounds keep it from matching the
// middle of longer dotted runs while still allowing a sentence-ending dot.
const IPV4_TEXT_RE = new RegExp(
  "(?<![0-9.])((?:\\d{1,3}\\.){3}\\d{1,3})(/\\d{1,3})?(?!\\d)(?!\\.\\d)",
  "g",
);

const REGEXP_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Replace IPv4 addresses/CIDRs, IPv6 addresses, MACs, and every occurrence
 * of each nameMap key (case-insensitive, bounded by characters that are not
 * alphanumeric or "-") everywhere in free text. Longer keys win over
 * shorter ones.
 */
export function scrubText(text: string, nameMap?: ReadonlyMap<string, string>): string {
  let out = text;
  out = out.replace(MAC_TEXT_RE, (m) => anonymizeMac(m));
  out = out.replace(IPV6_TEXT_RE, (m) => {
    if ((m.match(/:/g) ?? []).length < 2) return m;
    return expandIpv6(m) ? anonymizeIpv6(m) : m;
  });
  out = out.replace(IPV4_TEXT_RE, (m, addr: string, prefix: string | undefined) =>
    prefix ? anonymizeCidr(m) : anonymizeIpv4(addr),
  );
  if (nameMap && nameMap.size > 0) {
    const keys = [...nameMap.keys()]
      .filter((k) => k.length > 0)
      .sort((a, b) => b.length - a.length);
    for (const key of keys) {
      const replacement = nameMap.get(key);
      if (replacement === undefined) continue;
      const escaped = key.replace(REGEXP_ESCAPE_RE, "\\$&");
      const re = new RegExp(`(?<![A-Za-z0-9-])${escaped}(?![A-Za-z0-9-])`, "gi");
      out = out.replace(re, () => replacement);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Deep object anonymization                                           */
/* ------------------------------------------------------------------ */

type KeyKind = "name" | "username" | "host" | "ip" | "mac" | "cidr" | "url";

// "title" is deliberately excluded (too generic). "hostname" lives in
// HOST_KEYS (anonymizeHostname), which the spec's collectNames rules require;
// for single-label hostnames the output equals anonymizeName anyway.
const NAME_KEYS = new Set([
  "name", "devicename", "displayname", "label", "ssid", "accountname",
  "owner", "tailnet", "instancename", "sitename", "subject",
]);
const USERNAME_KEYS = new Set(["username", "user", "createdby", "actor"]);
const HOST_KEYS = new Set([
  "hostname", "host", "fqdn", "dnsname", "domain", "server", "endpoint", "sshhost",
]);
const IP_KEYS = new Set([
  "ip", "ipaddress", "address", "gateway", "wanip", "sourceaddress",
  "destaddress", "sourceip", "destip", "svipaddress", "externalip",
  "publicip", "internalip", "lanip",
]);
const MAC_KEYS = new Set(["mac", "macaddress", "hwaddress"]);
const CIDR_KEYS = new Set(["cidr", "subnet"]);
const URL_KEYS = new Set(["url", "baseurl", "weburl", "endpointurl"]);
const SKIP_KEYS = new Set(["id", "key", "token", "fingerprint", "hash", "externalid", "vmid"]);

/*
 * Machine discriminants: enum-ish fields the UI branches on or uses as lookup
 * keys (INTEGRATION_ICONS[type], badge maps, kind switches). These must never
 * be rewritten — a user-chosen name that case-insensitively matches an enum
 * value ("OpnSense" vs type "OPNSENSE") would otherwise get pseudonymized and
 * break the lookup (crashed the dashboard with an undefined icon component).
 * Deliberately NOT listed: "source" — on firewall rules it carries real
 * IP/alias specs that anonymization must keep scrubbing.
 */
const DISCRIMINANT_KEY_SUFFIXES = [
  "type", "kind", "status", "severity", "level", "state", "protocol",
  "action", "role", "verdict", "scope",
];

const MAX_DEPTH = 32;

function matchesSet(set: ReadonlySet<string>, lowerKey: string): boolean {
  if (set.has(lowerKey)) return true;
  // Plural forms ("ips", "addresses", "dnsNames", ...) use the same key set.
  if (lowerKey.endsWith("es") && set.has(lowerKey.slice(0, -2))) return true;
  if (lowerKey.endsWith("s") && set.has(lowerKey.slice(0, -1))) return true;
  return false;
}

function resolveKeyKind(key: string): KeyKind | undefined {
  const lower = key.toLowerCase();
  if (matchesSet(USERNAME_KEYS, lower)) return "username";
  if (matchesSet(HOST_KEYS, lower)) return "host";
  if (matchesSet(NAME_KEYS, lower)) return "name";
  if (matchesSet(IP_KEYS, lower)) return "ip";
  if (matchesSet(MAC_KEYS, lower)) return "mac";
  if (matchesSet(CIDR_KEYS, lower)) return "cidr";
  if (matchesSet(URL_KEYS, lower)) return "url";
  return undefined;
}

function isSkippedKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (SKIP_KEYS.has(lower) || /Ids?$/.test(key)) return true;
  // Suffix match covers compounds: lastSyncStatus, aliasType, powerState, …
  return DISCRIMINANT_KEY_SUFFIXES.some((s) => lower.endsWith(s));
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function outsideNameTraversal(node: unknown, depth: number): boolean {
  return node === null || node === undefined || depth > MAX_DEPTH;
}

function isObjectNode(node: unknown): node is object {
  return node !== null && typeof node === "object";
}

/**
 * Pass 1 of anonymizeDeep: walk the value and record real → fake mappings
 * for every string under a name-like key, so composed labels and log lines
 * can be scrubbed consistently with the fields themselves. Strings shorter
 * than 3 chars are skipped (too many false text matches).
 */
export function collectNames(value: unknown): Map<string, string> {
  const map = new Map<string, string>();
  const seen = new WeakSet<object>();

  const walk = (node: unknown, kind: KeyKind | undefined, depth: number): void => {
    if (outsideNameTraversal(node, depth)) return;
    if (typeof node === "string") {
      collectStringName(map, node, kind);
      return;
    }
    if (!isObjectNode(node)) return;
    if (node instanceof Date) return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const el of node) walk(el, kind, depth + 1);
      return;
    }
    if (!isPlainObject(node)) return;
    for (const [k, v] of Object.entries(node)) {
      if (isSkippedKey(k)) continue;
      const kind_ = resolveKeyKind(k);
      const nameLike = kind_ === "name" || kind_ === "username" || kind_ === "host";
      walk(v, nameLike ? kind_ : undefined, depth + 1);
    }
  };

  walk(value, undefined, 0);
  return map;
}

function collectStringName(map: Map<string, string>, value: string, kind: KeyKind | undefined): void {
  if (value.length < 3) return;
  if (kind === "name") map.set(value, anonymizeName(value));
  else if (kind === "username") map.set(value, anonymizeUsername(value));
  else if (kind === "host") map.set(value, anonymizeHostname(value));
}

function transformString(
  value: string,
  kind: KeyKind | undefined,
  nameMap: ReadonlyMap<string, string>,
): string {
  // Value-shape guards win over the key-based rules.
  if (parseIpv4(value)) return anonymizeIpv4(value);
  if (looksLikeCidr(value)) return anonymizeCidr(value);
  if (value.includes(":") && expandIpv6(value)) return anonymizeIpv6(value);
  if (MAC_RE.test(value)) return anonymizeMac(value);

  switch (kind) {
    case "name": {
      // Composed labels ("pve-01 (10.0.20.15)") get scrubbed so embedded
      // IPs/names stay consistent with the dedicated fields; plain names
      // fall through to anonymizeName.
      const scrubbed = scrubText(value, nameMap);
      return scrubbed !== value ? scrubbed : anonymizeName(value);
    }
    case "username":
      return anonymizeUsername(value);
    case "host": {
      const at = value.lastIndexOf("@");
      if (at > 0) {
        // "user@host" — anonymize both sides.
        return `${anonymizeUsername(value.slice(0, at))}@${anonymizeHostname(value.slice(at + 1))}`;
      }
      return anonymizeHostname(value);
    }
    case "url":
      return anonymizeUrl(value);
    // "ip" / "mac" / "cidr" keys whose values are not shaped like one
    // (e.g. address = "some label") fall back to text scrubbing, as does
    // every other string value.
    default:
      return scrubText(value, nameMap);
  }
}

/**
 * Anonymize an entire payload: collectNames first, then rebuild the value
 * with every string transformed (never mutates the input). Numbers,
 * booleans, Dates, ids/keys/tokens, and class instances pass through
 * untouched.
 */
export function anonymizeDeep<T>(value: T): T {
  const nameMap = collectNames(value);
  const seen = new WeakSet<object>();

  const visit = (node: unknown, kind: KeyKind | undefined, depth: number): unknown => {
    if (node === null || node === undefined) return node;
    if (typeof node === "string") return transformString(node, kind, nameMap);
    if (typeof node !== "object") return node;
    if (node instanceof Date) return node;
    if (depth >= MAX_DEPTH || seen.has(node)) return node;
    seen.add(node);
    if (Array.isArray(node)) {
      // Arrays under a keyed property ("ips", "dnsNames", ...) apply the
      // key's anonymizer per element.
      return node.map((el) => visit(el, kind, depth + 1));
    }
    if (!isPlainObject(node)) return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = isSkippedKey(k) ? v : visit(v, resolveKeyKind(k), depth + 1);
    }
    return out;
  };

  return visit(value, undefined, 0) as T;
}
