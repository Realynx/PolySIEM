/**
 * The address PolySIEM tells a MANAGED HOST to reach it at.
 *
 * Several features hand a remote machine a URL pointing back at this instance:
 * a privacy router downloads its SNI proxy from one, and a connector polls one
 * forever after the installer bakes it into `/etc/polysiem-connector/config`.
 * That URL is derived, by default, from the request headers of the ADMIN'S OWN
 * BROWSER — which is a convenience, not a fact. It is right whenever the admin
 * reaches PolySIEM the same way the managed host would, and wrong whenever they
 * do not: a dev server on `localhost:3000`, a VPN-only hostname, an SSH
 * port-forward, a container-internal address.
 *
 * When it is wrong, the failure lands on the far end, minutes later, as a
 * download that could not connect — with nothing anywhere naming the cause. This
 * module is the check that stops that: some addresses cannot possibly be
 * reachable from another machine, and those are worth refusing BEFORE they are
 * written into a remote box's configuration.
 *
 * Two kinds are rejected:
 *
 *  - **Loopback** (`localhost`, `127.0.0.0/8`, `::1`) — the name resolves on the
 *    managed host too, to the managed host. It is not that the address is
 *    unlikely to work; it is that it resolves to the wrong machine by
 *    definition. `0.0.0.0` and `::` are a listen address, never a destination.
 *  - **Unqualified single-label hosts** (`polysiem`, `siem`) — these only
 *    resolve through the search domain, mDNS or hosts file of the machine that
 *    typed them. Nothing guarantees the managed host shares any of that, and a
 *    name that silently means a different box is worse than one that fails.
 *
 * Deliberately PURE: no `server-only`, no database, no `ApiError`. The service
 * layer turns an issue into an HTTP error, the settings validator turns it into
 * a field message, and the install dialog turns it into a warning beside the
 * command — all from this one definition, so the three can never disagree.
 */

/** Why a managed host could not reach PolySIEM at a given base URL. */
export type ManagedHostBaseUrlProblem =
  /** Not an absolute `http(s)://…` URL at all. */
  | "malformed"
  /** Resolves to the managed host itself (`localhost`, `127.0.0.0/8`, `::1`). */
  | "loopback"
  /** A listen-anywhere address (`0.0.0.0`, `::`), never a destination. */
  | "unspecified"
  /** A single-label host that only resolves where it was typed. */
  | "unqualified";

/** The operator-facing name of the setting that overrides the derived value. */
export const MANAGED_HOST_BASE_URL_LABEL = "PolySIEM address for managed hosts";

/** Where an operator goes to state the truth when the derived value is wrong. */
const REMEDY = `Set "${MANAGED_HOST_BASE_URL_LABEL}" in Settings → System (or the APP_URL environment variable)`;

/** Why the wrong value was picked in the first place — said once, plainly. */
const DERIVATION =
  "PolySIEM works that address out from APP_URL, or from whatever address you are browsing PolySIEM on.";

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Trim and drop trailing slashes so callers can concatenate a path onto it. */
export function normalizeManagedHostBaseUrl(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

/** The lower-cased host of an `http(s)` URL, IPv6 brackets removed, or null. */
export function managedHostBaseUrlHost(baseUrl: string | null | undefined): string | null {
  let url: URL;
  try {
    url = new URL(normalizeManagedHostBaseUrl(baseUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return host || null;
}

/** The four octets of a dotted-quad, or null when it is not one. */
function ipv4Octets(host: string): number[] | null {
  const match = IPV4_PATTERN.exec(host);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** An address literal rather than a name, so "has no dot" says nothing about it. */
function isIpLiteral(host: string): boolean {
  return ipv4Octets(host) !== null || host.includes(":");
}

/**
 * Resolves to the machine that resolves it. `*.localhost` is included because
 * RFC 6761 reserves the whole subtree for exactly that meaning.
 *
 * The IPv4-mapped forms are matched in BOTH spellings: `URL` rewrites
 * `::ffff:127.0.0.1` to the hex `::ffff:7f00:1`, so checking only the readable
 * one would let the readable one through.
 */
function isLoopbackHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::1" || /^::ffff:(7f[0-9a-f]{2}:|127\.)/.test(host)) return true;
  return ipv4Octets(host)?.[0] === 127;
}

/** `0.0.0.0` / `::` — a bind address that no client can connect to. */
function isUnspecifiedHost(host: string): boolean {
  if (host === "::" || host === "::0") return true;
  return ipv4Octets(host)?.every((octet) => octet === 0) === true;
}

/**
 * The reason a managed host could not reach PolySIEM here, or null when the
 * address is at least plausible.
 *
 * "Plausible" is the whole claim: this cannot prove an address IS reachable —
 * only the far end can — so it refuses exactly the cases that are unreachable by
 * construction and passes everything else through.
 */
export function managedHostBaseUrlProblem(
  baseUrl: string | null | undefined,
): ManagedHostBaseUrlProblem | null {
  const host = managedHostBaseUrlHost(baseUrl);
  if (!host) return "malformed";
  if (isLoopbackHost(host)) return "loopback";
  if (isUnspecifiedHost(host)) return "unspecified";
  if (!isIpLiteral(host) && !host.includes(".")) return "unqualified";
  return null;
}

/** Prose for one problem. Split out so the switch stays flat and readable. */
function problemProse(
  problem: ManagedHostBaseUrlProblem,
  shown: string,
  host: string,
  subject: string,
): string {
  switch (problem) {
    case "malformed":
      return `PolySIEM resolved its own address as ${shown}, which is not a usable http(s) URL.`;
    case "loopback":
      return `PolySIEM resolved its own address as ${shown}. On the ${subject}, ${host} means the ${subject} itself — `
        + `so it would be asking itself for PolySIEM and can never reach this instance there.`;
    case "unspecified":
      return `PolySIEM resolved its own address as ${shown}. ${host} is an address to listen on, not one anything `
        + `can connect to.`;
    case "unqualified":
      return `PolySIEM resolved its own address as ${shown}. ${host} is a single-label hostname, which only resolves `
        + `through the search domain or hosts file of the machine you are browsing from — the ${subject} has no way `
        + `to look it up.`;
  }
}

/**
 * One complete, actionable sentence for an unreachable base URL, or null when
 * there is nothing wrong with it.
 *
 * `subject` names the far end in the operator's own vocabulary ("privacy
 * router", "connector host"), because "the managed host cannot reach this" is
 * only useful once they know WHICH host is being talked about.
 */
export function managedHostBaseUrlIssue(
  baseUrl: string | null | undefined,
  subject = "managed host",
): string | null {
  const problem = managedHostBaseUrlProblem(baseUrl);
  if (!problem) return null;
  const shown = normalizeManagedHostBaseUrl(baseUrl) || "(empty)";
  const host = managedHostBaseUrlHost(baseUrl) ?? shown;
  return `${problemProse(problem, shown, host, subject)} ${DERIVATION} ${REMEDY} to an address the ${subject} `
    + `can reach — a LAN IP address, or a DNS name that resolves off this machine — and try again.`;
}
