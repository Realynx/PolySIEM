/**
 * `node:net`'s IP validation, with nothing from `node:net` in it.
 *
 * WHY THIS FILE EXISTS. `isIP` is used by validators — `src/lib/ssh/target.ts`,
 * `src/lib/validators/*` — and those validators are deliberately NOT
 * `server-only`, because client components import the same schemas the API
 * routes parse with. Importing a Node builtin from a module in the client graph
 * is unbundleable no matter how small the use is, and Turbopack fails the whole
 * chunk:
 *
 *     the chunking context (unknown) does not support external modules
 *     (request: node:net)
 *
 * WHY IT IS A TRANSCRIPTION AND NOT A REWRITE. `isIP` decides which hosts an
 * operator is allowed to save. A stricter implementation locks people out of
 * addresses that used to work; a looser one accepts addresses the rest of the
 * stack cannot resolve. So the grammar below is copied verbatim from Node's
 * `lib/internal/net.js` (v22) rather than reasoned out from RFC 4291 — Node's
 * own `net.isIP` is exactly these two regexes, so "match Node" is not an
 * approximation here, it is the same test. `ip.test.ts` re-checks that against
 * the real `node:net` on every run, including a fuzz corpus, so a future Node
 * release that changes the grammar shows up as a failing test rather than as a
 * silent validation change.
 *
 * Pure, dependency-free, and safe to import from anywhere — server, client,
 * edge, or a test.
 */

/** What {@link isIP} answers: `4`, `6`, or `0` for "not an IP address at all". */
export type IpVersion = 0 | 4 | 6;

/**
 * One IPv4 octet, spelled out as ranges rather than as `\d{1,3}` with a bounds
 * check. That is what rejects `01.2.3.4` (leading zero) and `1.2.3.256`
 * (out of range) without either one needing its own branch.
 */
const IPV4_SEGMENT = "(?:[0-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5])";
const IPV4_ADDRESS = `(?:${IPV4_SEGMENT}\\.){3}${IPV4_SEGMENT}`;

/** One IPv6 hextet. Case-insensitive by enumeration, so no `i` flag is needed. */
const IPV6_SEGMENT = "(?:[0-9a-fA-F]{1,4})";

/**
 * The eight alternatives are "how many hextets appear before the `::`", from
 * seven down to zero. Each one allows the remainder to be more hextets, a
 * trailing `::`, or an embedded IPv4 tail (`::ffff:127.0.0.1`). The optional
 * `%…` suffix is a zone index, e.g. `fe80::1%eth0`, which Node accepts.
 */
const IPV6_ADDRESS =
  "(?:"
  + `(?:${IPV6_SEGMENT}:){7}(?:${IPV6_SEGMENT}|:)|`
  + `(?:${IPV6_SEGMENT}:){6}(?:${IPV4_ADDRESS}|:${IPV6_SEGMENT}|:)|`
  + `(?:${IPV6_SEGMENT}:){5}(?::${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,2}|:)|`
  + `(?:${IPV6_SEGMENT}:){4}(?:(?::${IPV6_SEGMENT}){0,1}:${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,3}|:)|`
  + `(?:${IPV6_SEGMENT}:){3}(?:(?::${IPV6_SEGMENT}){0,2}:${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,4}|:)|`
  + `(?:${IPV6_SEGMENT}:){2}(?:(?::${IPV6_SEGMENT}){0,3}:${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,5}|:)|`
  + `(?:${IPV6_SEGMENT}:){1}(?:(?::${IPV6_SEGMENT}){0,4}:${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,6}|:)|`
  + `(?::(?:(?::${IPV6_SEGMENT}){0,5}:${IPV4_ADDRESS}|(?::${IPV6_SEGMENT}){1,7}|:))`
  + ")(?:%[0-9a-zA-Z-.:]{1,})?";

const IPV4_PATTERN = new RegExp(`^${IPV4_ADDRESS}$`);
const IPV6_PATTERN = new RegExp(`^${IPV6_ADDRESS}$`);

/**
 * True for a dotted-quad IPv4 literal and nothing else. No surrounding
 * whitespace, no leading zeros, no CIDR suffix, no port.
 */
export function isIPv4(value: string): boolean {
  return typeof value === "string" && IPV4_PATTERN.test(value);
}

/** True for an IPv6 literal, with or without `::` compression or a `%zone`. */
export function isIPv6(value: string): boolean {
  return typeof value === "string" && IPV6_PATTERN.test(value);
}

/**
 * `4` for an IPv4 literal, `6` for an IPv6 literal, `0` for anything else.
 *
 * Never throws — an empty string, whitespace, a hostname, a CIDR, or a
 * non-string all answer `0`, exactly as `net.isIP` does.
 */
export function isIP(value: string): IpVersion {
  if (isIPv4(value)) return 4;
  if (isIPv6(value)) return 6;
  return 0;
}
