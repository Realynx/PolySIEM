import { createHash } from "node:crypto";

/**
 * PolySIEM connector — the reverse-tunnel "last hop" agent.
 *
 * A connector is modelled on a Cloudflare Tunnel connector: it is installed on
 * an internal machine with a one-time token, dials OUT to the PolySIEM edge over
 * WireGuard, and pulls its desired configuration from the control plane. Nothing
 * inbound is required at the connector site.
 *
 * This module is pure generation (no DB, no network). It produces:
 *  - {@link CONNECTOR_AGENT_SCRIPT}: the POSIX `sh` agent installed on the host.
 *  - {@link canonicalConnectorRuleset} / {@link connectorRulesetHash}: the shared,
 *    deterministic canonicalisation used by BOTH the control plane (to publish
 *    `configHash`) and the on-host agent (to verify what it parsed before applying).
 *
 * NOTE on WireGuard bring-up: the agent creates and configures the interface with
 * `ip link add ... type wireguard` + `wg set` + `ip address replace` + `ip link set up`.
 * The `wg-quick` wrapper is deliberately never invoked — it segfaults on the target
 * Ubuntu 26.04 pre-release LXC image, while kernel netdev creation works fine.
 * Boot persistence is handled by a plain systemd service that runs this agent.
 */

/** Bumped whenever the on-host agent behaviour changes. Reported to the control plane. */
export const CONNECTOR_AGENT_VERSION = "1";

/**
 * Version tag embedded in the canonical ruleset. Bumping it changes every hash,
 * which is exactly what you want when the canonical line format changes.
 */
export const CONNECTOR_RULESET_VERSION = "1";

/** Fixed install path of the agent. The systemd unit and the installer both use it. */
export const CONNECTOR_AGENT_PATH = "/usr/local/libexec/polysiem-connector-agent";

/** Root-owned, 0700 state directory. */
export const CONNECTOR_CONFIG_DIR = "/etc/polysiem-connector";
/** `KEY=value` installer-written settings (BASE_URL / CONNECTOR_ID / IFACE / POLYSIEM_INSECURE). */
export const CONNECTOR_CONFIG_FILE = `${CONNECTOR_CONFIG_DIR}/config`;
/** 0600 file holding the currently valid `pscx_…` token (install token, then agent token). */
export const CONNECTOR_TOKEN_FILE = `${CONNECTOR_CONFIG_DIR}/token`;
/** 0600 WireGuard private key. Generated on the host; never leaves it, never printed. */
export const CONNECTOR_PRIVATE_KEY_FILE = `${CONNECTOR_CONFIG_DIR}/private.key`;
/** 0644 derived WireGuard public key, kept for operator inspection. */
export const CONNECTOR_PUBLIC_KEY_FILE = `${CONNECTOR_CONFIG_DIR}/public.key`;
/** Tab-separated enrolment/tunnel parameters learned from the control plane. */
export const CONNECTOR_TUNNEL_FILE = `${CONNECTOR_CONFIG_DIR}/tunnel`;
/** Tab-separated applied-ruleset state (REVISION / HASH / COUNT / IPTABLES_HASH). */
export const CONNECTOR_STATE_FILE = `${CONNECTOR_CONFIG_DIR}/state`;

/** systemd unit installed by {@link buildConnectorInstallScript}. */
export const CONNECTOR_SERVICE_NAME = "polysiem-connector.service";

/** Stable dispatcher chains. Everything PolySIEM owns hangs off exactly these three. */
export const CONNECTOR_DNAT_CHAIN = "PS_CX_DNAT";
export const CONNECTOR_SNAT_CHAIN = "PS_CX_SNAT";
export const CONNECTOR_FORWARD_CHAIN = "PS_CX_FORWARD";
/** Immutable per-generation chain prefixes (suffixed with the local revision number). */
export const CONNECTOR_DNAT_GENERATION_PREFIX = "PS_CX_D_";
export const CONNECTOR_SNAT_GENERATION_PREFIX = "PS_CX_S_";
export const CONNECTOR_FORWARD_GENERATION_PREFIX = "PS_CX_F_";

/**
 * One published last-hop route, exactly as it appears in `routes[]` of
 * `POST /api/network/connectors/config` (§3 of the connector contract).
 *
 * `listenPort` is the PUBLIC port, preserved across the tunnel: the edge DNATs
 * `public:listenPort` to `connectorTunnelIp:listenPort`, and the connector DNATs
 * `wg0 dport listenPort` to `targetAddress:targetPort`.
 * `targetAddress:targetPort` is the internal service AS SEEN FROM THE CONNECTOR.
 */
export interface ConnectorRoute {
  protocol: "tcp" | "udp";
  listenPort: number;
  targetAddress: string;
  targetPort: number;
}

/** WireGuard parameters for the edge side of the tunnel (§3 `edge`). */
export interface ConnectorEdgeParams {
  /** `host:port` the connector dials out to. */
  endpoint: string;
  /** Edge WireGuard public key (44-char base64). */
  publicKey: string;
  /** CIDRs routed down the tunnel, e.g. `["10.9.9.0/24"]`. */
  allowedIps: string[];
  persistentKeepalive: number;
}

/** Body of the 200 response from `POST /api/network/connectors/config` (§3). */
export interface ConnectorConfigPayload {
  configHash: string;
  interfaceName: string;
  tunnelAddress: string;
  edge: ConnectorEdgeParams;
  routes: ConnectorRoute[];
  pollIntervalSeconds: number;
}

function isIpv4Address(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => /^(0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
}

function isValidPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65535;
}

/**
 * Renders one route as its canonical line (without the trailing newline).
 * Throws on anything the on-host agent would refuse, so a malformed row can
 * never be silently folded into a hash the agent will not be able to reproduce.
 */
function canonicalRouteLine(route: ConnectorRoute, index: number): string {
  const where = `connector route #${index + 1}`;
  if (route.protocol !== "tcp" && route.protocol !== "udp") {
    throw new Error(`${where}: protocol must be "tcp" or "udp"`);
  }
  if (!isValidPort(route.listenPort)) {
    throw new Error(`${where}: listenPort must be an integer between 1 and 65535`);
  }
  if (!isValidPort(route.targetPort)) {
    throw new Error(`${where}: targetPort must be an integer between 1 and 65535`);
  }
  if (typeof route.targetAddress !== "string" || !isIpv4Address(route.targetAddress)) {
    throw new Error(`${where}: targetAddress must be an IPv4 address`);
  }
  return `ROUTE\t${route.protocol}\t${route.listenPort}\t${route.targetAddress}\t${route.targetPort}`;
}

/**
 * Canonical, byte-exact text form of a connector's desired last-hop ruleset.
 *
 * FORMAT (frozen — the control plane and the on-host agent must agree byte for byte):
 *
 * ```text
 * CXRULESET\t<CONNECTOR_RULESET_VERSION>\n
 * ROUTE\t<protocol>\t<listenPort>\t<targetAddress>\t<targetPort>\n   (zero or more)
 * ```
 *
 * Rules:
 *  1. Exactly one header line, always present, so the empty-route case still has a
 *     stable non-empty canonical form (and so the format can be versioned).
 *  2. One `ROUTE` line per route, fields separated by a single TAB (U+0009).
 *  3. Identical lines are collapsed (duplicate routes hash the same as one route).
 *  4. Route lines are sorted ASCENDING BY BYTE VALUE — plain C-locale ordering.
 *     Every character produced here is ASCII, so JavaScript's default
 *     `Array.prototype.sort()` and `LC_ALL=C sort -u` agree exactly. This is
 *     ordering-independent by construction: the input order never matters.
 *  5. Every line, header included, is terminated by `\n` (so the string always
 *     ends in a newline and never has a trailing blank line).
 *
 * The agent reproduces this with `printf 'CXRULESET\t1\n'` followed by
 * `LC_ALL=C sort -u` over the `ROUTE` lines it parsed out of the JSON, and refuses
 * to apply anything whose sha256 does not match the server-published `configHash`.
 */
export function canonicalConnectorRuleset(routes: readonly ConnectorRoute[]): string {
  const lines = routes.map(canonicalRouteLine);
  const unique = Array.from(new Set(lines)).sort();
  return [`CXRULESET\t${CONNECTOR_RULESET_VERSION}`, ...unique].join("\n") + "\n";
}

/**
 * sha256 (lowercase hex) of {@link canonicalConnectorRuleset} encoded as UTF-8.
 * This IS the `configHash` published by `POST /api/network/connectors/config`.
 */
export function connectorRulesetHash(routes: readonly ConnectorRoute[]): string {
  return createHash("sha256").update(canonicalConnectorRuleset(routes), "utf8").digest("hex");
}

/**
 * The on-host agent. Installed 0755 at {@link CONNECTOR_AGENT_PATH} and driven by
 * the `polysiem-connector.service` systemd unit as `<agent> run`.
 *
 * Subcommands: `run` (poll loop, the default), `once` (a single cycle — the loop
 * re-executes the script for each cycle so `set -e` stays meaningful inside a
 * cycle while a failure never kills the daemon), `status`, `version`.
 *
 * Safety ethos mirrors the edge agent: dedicated PolySIEM-owned chains only,
 * immutable generation chains validated with `iptables-restore --test` before
 * anything is committed, a three-chain dispatcher swap, rollback on failure,
 * `flock` around the apply path, atomic 0600 state files, and no jq dependency
 * (JSON is parsed defensively with sed/awk and every field is re-validated).
 */
export const CONNECTOR_AGENT_SCRIPT = `#!/bin/sh
# PolySIEM connector agent (version ${CONNECTOR_AGENT_VERSION}).
#
# Polls the PolySIEM control plane, keeps the WireGuard tunnel to the edge up,
# and renders the published last-hop rules into PolySIEM-owned iptables chains.
#
# The tunnel interface is created and configured with ip(8) + wg(8) directly.
# The distribution's quick-setup wrapper for WireGuard is deliberately never
# invoked: it segfaults on the target container image, while kernel netdev
# creation works fine. Boot persistence comes from the systemd unit that runs
# this script, not from any wrapper-managed interface.
set -eu

AGENT_VERSION=${CONNECTOR_AGENT_VERSION}
RULESET_VERSION=${CONNECTOR_RULESET_VERSION}
CONF_DIR=${CONNECTOR_CONFIG_DIR}
CONF_FILE=${CONNECTOR_CONFIG_FILE}
TOKEN_FILE=${CONNECTOR_TOKEN_FILE}
KEY_FILE=${CONNECTOR_PRIVATE_KEY_FILE}
PUB_FILE=${CONNECTOR_PUBLIC_KEY_FILE}
TUNNEL_FILE=${CONNECTOR_TUNNEL_FILE}
STATE_FILE=${CONNECTOR_STATE_FILE}
LOCK_FILE=$CONF_DIR/apply.lock
DNAT=${CONNECTOR_DNAT_CHAIN}
SNAT=${CONNECTOR_SNAT_CHAIN}
FWD=${CONNECTOR_FORWARD_CHAIN}
GEN_D=${CONNECTOR_DNAT_GENERATION_PREFIX}
GEN_S=${CONNECTOR_SNAT_GENERATION_PREFIX}
GEN_F=${CONNECTOR_FORWARD_GENERATION_PREFIX}
MAX_ROUTES=200
MIN_POLL=5
MAX_POLL=3600
DEFAULT_POLL=30
TAB="$(printf '\\t')"

log() { printf 'polysiem-connector: %s\\n' "$1" >&2; }

# ---------------------------------------------------------------- validators
valid_if() { [ -n "$1" ] && [ "\${1#????????????????}" = "$1" ] && ! printf %s "$1" | grep -q '[^A-Za-z0-9_.:-]'; }
valid_port() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
valid_uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 0 ] && [ "$1" -le 999999999 ]; }
valid_hash() { [ "\${#1}" -eq 64 ] && ! printf %s "$1" | grep -q '[^0-9a-f]'; }
valid_proto() { case "$1" in tcp|udp) return 0;; *) return 1;; esac; }
valid_ip() { printf '%s\\n' "$1" | awk -F. 'NF==4 { for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i>255) exit 1; exit 0 } { exit 1 }'; }
valid_cidr() { printf '%s\\n' "$1" | awk -F/ 'NF==2 { split($1,a,"."); if(length(a)!=4) exit 1; for(i=1;i<=4;i++) if(a[i] !~ /^[0-9]+$/ || a[i]>255) exit 1; if($2 !~ /^[0-9]+$/ || $2>32) exit 1; exit 0 } { exit 1 }'; }
valid_prefix() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 8 ] && [ "$1" -le 32 ]; }
valid_wgkey() { [ "\${#1}" -eq 44 ] || return 1; wgk="\${1%=}"; [ "\${#wgk}" -eq 43 ] || return 1; ! printf %s "$wgk" | grep -q '[^A-Za-z0-9+/]'; }
valid_endpoint() { printf %s "$1" | grep -qE '^[A-Za-z0-9._-]+:[0-9]{1,5}$'; }
valid_allowed() { printf %s "$1" | grep -qE '^[0-9./,]{1,200}$'; }
valid_token() { printf %s "$1" | grep -qE '^pscx_[A-Za-z0-9_-]{24,96}$'; }
valid_connector_id() { printf %s "$1" | grep -qE '^[A-Za-z0-9_-]{1,128}$'; }
valid_base_url() { printf %s "$1" | grep -qE '^https?://[A-Za-z0-9._~-]+(:[0-9]{1,5})?(/[A-Za-z0-9._~/-]*)?$'; }

# ------------------------------------------------------------- tiny key/value
# Tab-separated "KEY<TAB>VALUE" files written atomically at 0600.
kv_value() {
  [ -f "$1" ] || return 0
  awk -F '\\t' -v wanted="$2" '$1 == wanted { print $2; exit }' "$1" 2>/dev/null || true
}

# "KEY=value" installer-written config. Parsed, never sourced.
conf_value() {
  [ -f "$CONF_FILE" ] || return 0
  awk -v k="$1" 'index($0, k "=") == 1 { print substr($0, length(k) + 2); exit }' "$CONF_FILE" 2>/dev/null || true
}

# ------------------------- JSON, parsed with sed/awk (no external JSON tool)
# The payloads come from PolySIEM itself and are small and flat. They are read
# from a file (never passed through argv, so tokens never reach ps output) after
# newlines/tabs are stripped, and every extracted field is re-validated below.
json_str() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$1"; }
json_num() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p' "$1"; }
json_arr1() { sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\\[[[:space:]]*"\\([^"]*\\)".*/\\1/p' "$1"; }
frag_str() { printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p'; }
frag_num() { printf '%s' "$1" | sed -n 's/.*"'"$2"'"[[:space:]]*:[[:space:]]*\\([0-9][0-9]*\\).*/\\1/p'; }

flatten_json() { tr -d '\\n\\r\\t' < "$1" > "$2"; }

# One line per JSON object, so each route object can be parsed in isolation.
split_objects() { sed 's/{/\\n{/g; s/}/}\\n/g' "$1"; }

check_deps() {
  for binary in ip wg iptables iptables-restore curl awk grep sed tr sort mktemp sha256sum flock install chmod mv rm sysctl date sleep uname; do
    command -v "$binary" >/dev/null 2>&1 || { log "missing dependency: $binary"; exit 3; }
  done
}

setup_tmp() {
  install -d -m 0700 "$CONF_DIR"
  if [ -d /run ]; then
    install -d -m 0700 /run/polysiem-connector
    TMPDIR=/run/polysiem-connector
  else
    TMPDIR="$CONF_DIR"
  fi
  export TMPDIR
}

# ------------------------------------------------------------------- config
load_config() {
  [ -f "$CONF_FILE" ] || { log "missing $CONF_FILE"; exit 3; }
  BASE_URL="$(conf_value BASE_URL)"
  BASE_URL="\${BASE_URL%/}"
  valid_base_url "$BASE_URL" || { log 'BASE_URL in the config file is missing or malformed'; exit 3; }

  CONNECTOR_ID="$(conf_value CONNECTOR_ID)"
  [ -n "$CONNECTOR_ID" ] || CONNECTOR_ID="$(kv_value "$TUNNEL_FILE" CONNECTOR_ID)"
  [ -z "$CONNECTOR_ID" ] || valid_connector_id "$CONNECTOR_ID" || { log 'CONNECTOR_ID is malformed'; exit 3; }

  IFACE="$(conf_value IFACE)"
  [ -n "$IFACE" ] || IFACE="$(kv_value "$TUNNEL_FILE" IFACE)"
  [ -n "$IFACE" ] || IFACE=wg0
  valid_if "$IFACE" || { log 'IFACE is malformed'; exit 3; }

  INSECURE="$(conf_value POLYSIEM_INSECURE)"
  [ -z "\${POLYSIEM_INSECURE:-}" ] || INSECURE="$POLYSIEM_INSECURE"
  [ "$INSECURE" = 1 ] || INSECURE=0
  CURL_INSECURE=""
  [ "$INSECURE" = 0 ] || CURL_INSECURE="-k"
}

load_token() {
  [ -f "$TOKEN_FILE" ] || { log "missing $TOKEN_FILE"; exit 3; }
  TOKEN="$(tr -d ' \\t\\r\\n' < "$TOKEN_FILE")"
  valid_token "$TOKEN" || { log 'the stored connector token is malformed'; exit 3; }
}

# The token lives in the request body file (0600), never in argv, and --fail keeps
# error bodies out of the log. -k is added ONLY when the operator asked for it.
http_post() {
  # shellcheck disable=SC2086
  curl --fail --silent --show-error $CURL_INSECURE \\
    --connect-timeout 10 --max-time 45 \\
    -H 'Content-Type: application/json' \\
    -X POST --data-binary "@$2" -o "$3" "$BASE_URL$1"
}

# ---------------------------------------------------------------- enrolment
ensure_keypair() {
  if [ ! -s "$KEY_FILE" ]; then
    ( umask 077; wg genkey > "$KEY_FILE.new" )
    [ -s "$KEY_FILE.new" ] || { rm -f "$KEY_FILE.new"; log 'wg genkey produced no key'; exit 3; }
    chmod 0600 "$KEY_FILE.new"
    mv "$KEY_FILE.new" "$KEY_FILE"
  fi
  chmod 0600 "$KEY_FILE"
  PUBLIC_KEY="$(wg pubkey < "$KEY_FILE")"
  valid_wgkey "$PUBLIC_KEY" || { log 'could not derive a WireGuard public key from the stored private key'; exit 3; }
  printf '%s\\n' "$PUBLIC_KEY" > "$PUB_FILE.new"
  chmod 0644 "$PUB_FILE.new"
  mv "$PUB_FILE.new" "$PUB_FILE"
}

write_tunnel_file() {
  tf="$(mktemp)"; chmod 0600 "$tf"
  printf 'ENROLLED\\t1\\nCONNECTOR_ID\\t%s\\nIFACE\\t%s\\nTUNNEL_ADDRESS\\t%s\\nTUNNEL_PREFIX\\t%s\\nEDGE_ENDPOINT\\t%s\\nEDGE_PUBKEY\\t%s\\nEDGE_ALLOWED\\t%s\\nEDGE_KEEPALIVE\\t%s\\nPOLL_INTERVAL\\t%s\\n' \\
    "$CONNECTOR_ID" "$IFACE" "$TUNNEL_ADDRESS" "$TUNNEL_PREFIX" "$EDGE_ENDPOINT" "$EDGE_PUBKEY" "$EDGE_ALLOWED" "$EDGE_KEEPALIVE" "$POLL_INTERVAL" > "$tf"
  mv "$tf" "$TUNNEL_FILE"
}

load_tunnel_file() {
  TUNNEL_ADDRESS="$(kv_value "$TUNNEL_FILE" TUNNEL_ADDRESS)"
  TUNNEL_PREFIX="$(kv_value "$TUNNEL_FILE" TUNNEL_PREFIX)"
  EDGE_ENDPOINT="$(kv_value "$TUNNEL_FILE" EDGE_ENDPOINT)"
  EDGE_PUBKEY="$(kv_value "$TUNNEL_FILE" EDGE_PUBKEY)"
  EDGE_ALLOWED="$(kv_value "$TUNNEL_FILE" EDGE_ALLOWED)"
  EDGE_KEEPALIVE="$(kv_value "$TUNNEL_FILE" EDGE_KEEPALIVE)"
  POLL_INTERVAL="$(kv_value "$TUNNEL_FILE" POLL_INTERVAL)"
  valid_uint "$POLL_INTERVAL" || POLL_INTERVAL=$DEFAULT_POLL
  valid_uint "$EDGE_KEEPALIVE" || EDGE_KEEPALIVE=25
}

tunnel_params_valid() {
  valid_ip "\${TUNNEL_ADDRESS:-}" || return 1
  valid_prefix "\${TUNNEL_PREFIX:-}" || return 1
  valid_wgkey "\${EDGE_PUBKEY:-}" || return 1
  valid_endpoint "\${EDGE_ENDPOINT:-}" || return 1
  valid_allowed "\${EDGE_ALLOWED:-}" || return 1
  return 0
}

# Parses the shared tunnel block returned by both /enroll and /config.
parse_tunnel_block() {
  flat="$1"
  t_iface="$(json_str "$flat" interfaceName)"
  t_addr="$(json_str "$flat" tunnelAddress)"
  t_cidr="$(json_str "$flat" tunnelCidr)"
  t_end="$(json_str "$flat" endpoint)"
  t_pub="$(json_str "$flat" publicKey)"
  t_allow="$(json_arr1 "$flat" allowedIps)"
  t_keep="$(json_num "$flat" persistentKeepalive)"
  t_poll="$(json_num "$flat" pollIntervalSeconds)"

  [ -z "$t_iface" ] || { valid_if "$t_iface" || { log 'control plane sent a malformed interface name'; return 2; }; IFACE="$t_iface"; }
  valid_ip "$t_addr" || { log 'control plane sent a malformed tunnel address'; return 2; }
  TUNNEL_ADDRESS="$t_addr"

  # The prefix comes from tunnelCidr when present, otherwise from allowedIps.
  t_prefix=""
  if valid_cidr "$t_cidr"; then t_prefix="\${t_cidr#*/}"; fi
  if [ -z "$t_prefix" ] && valid_cidr "$t_allow"; then t_prefix="\${t_allow#*/}"; fi
  [ -n "$t_prefix" ] || t_prefix="$(kv_value "$TUNNEL_FILE" TUNNEL_PREFIX)"
  valid_prefix "$t_prefix" || { log 'control plane sent a malformed tunnel CIDR'; return 2; }
  TUNNEL_PREFIX="$t_prefix"

  valid_endpoint "$t_end" || { log 'control plane sent a malformed edge endpoint'; return 2; }
  EDGE_ENDPOINT="$t_end"
  valid_wgkey "$t_pub" || { log 'control plane sent a malformed edge public key'; return 2; }
  EDGE_PUBKEY="$t_pub"
  valid_allowed "$t_allow" || { log 'control plane sent malformed allowed IPs'; return 2; }
  EDGE_ALLOWED="$t_allow"
  valid_uint "$t_keep" && [ "$t_keep" -le 65535 ] || t_keep=25
  EDGE_KEEPALIVE="$t_keep"
  valid_uint "$t_poll" || t_poll=$DEFAULT_POLL
  [ "$t_poll" -ge "$MIN_POLL" ] || t_poll=$MIN_POLL
  [ "$t_poll" -le "$MAX_POLL" ] || t_poll=$MAX_POLL
  POLL_INTERVAL="$t_poll"
  return 0
}

ensure_enrolled() {
  if [ "$(kv_value "$TUNNEL_FILE" ENROLLED)" = 1 ] && [ -s "$KEY_FILE" ]; then
    return 0
  fi
  ensure_keypair
  osinfo="$(uname -srmo 2>/dev/null | tr -c 'A-Za-z0-9._ /+-' ' ' | awk '{ print substr($0, 1, 200) }')"
  hostinfo="$(uname -n 2>/dev/null | tr -c 'A-Za-z0-9.-' ' ' | awk '{ print substr($0, 1, 200) }')"

  body="$(mktemp)"; chmod 0600 "$body"
  resp="$(mktemp)"; chmod 0600 "$resp"
  flat="$(mktemp)"; chmod 0600 "$flat"
  printf '{"token":"%s","publicKey":"%s","agentVersion":"%s","osInfo":"%s","hostname":"%s"}' \\
    "$TOKEN" "$PUBLIC_KEY" "$AGENT_VERSION" "$osinfo" "$hostinfo" > "$body"
  if ! http_post /api/network/connectors/enroll "$body" "$resp"; then
    rm -f "$body" "$resp" "$flat"
    log 'enrollment request failed (check BASE_URL, the install token, and TLS trust)'
    exit 5
  fi
  rm -f "$body"
  flatten_json "$resp" "$flat"
  rm -f "$resp"

  new_id="$(json_str "$flat" connectorId)"
  new_token="$(json_str "$flat" agentToken)"
  if ! valid_connector_id "$new_id"; then rm -f "$flat"; log 'enrollment response had no usable connector id'; exit 5; fi
  if ! valid_token "$new_token"; then rm -f "$flat"; log 'enrollment response had no usable agent token'; exit 5; fi
  CONNECTOR_ID="$new_id"
  if ! parse_tunnel_block "$flat"; then rm -f "$flat"; exit 5; fi
  rm -f "$flat"

  # The rotated agent token replaces the one-time install token. Written 0600,
  # atomically, and never echoed.
  ( umask 077; printf '%s\\n' "$new_token" > "$TOKEN_FILE.new" )
  chmod 0600 "$TOKEN_FILE.new"
  mv "$TOKEN_FILE.new" "$TOKEN_FILE"
  TOKEN="$new_token"
  write_tunnel_file
  log "enrolled as $CONNECTOR_ID"
}

# ------------------------------------------------------------------- tunnel
# Manual, idempotent WireGuard bring-up. No wrapper script is involved.
ensure_tunnel() {
  tunnel_params_valid || return 0
  [ -s "$KEY_FILE" ] || return 0
  if ip link show dev "$IFACE" >/dev/null 2>&1; then
    ip -d link show dev "$IFACE" 2>/dev/null | grep -qw wireguard || {
      log "refusing to manage $IFACE: it exists and is not a WireGuard interface"
      exit 3
    }
  else
    ip link add dev "$IFACE" type wireguard
  fi
  wg set "$IFACE" private-key "$KEY_FILE"
  wg set "$IFACE" peer "$EDGE_PUBKEY" endpoint "$EDGE_ENDPOINT" allowed-ips "$EDGE_ALLOWED" persistent-keepalive "$EDGE_KEEPALIVE"
  for peer in $(wg show "$IFACE" peers 2>/dev/null || true); do
    [ "$peer" = "$EDGE_PUBKEY" ] || wg set "$IFACE" peer "$peer" remove
  done
  ip address replace "$TUNNEL_ADDRESS/$TUNNEL_PREFIX" dev "$IFACE"
  ip link set "$IFACE" up
}

handshake_age() {
  ip link show dev "$IFACE" >/dev/null 2>&1 || return 0
  hs="$(wg show "$IFACE" latest-handshakes 2>/dev/null | awk '{ if ($2+0 > m) m=$2+0 } END { print m+0 }')"
  valid_uint "$hs" || return 0
  [ "$hs" -gt 0 ] || return 0
  now="$(date +%s 2>/dev/null || printf 0)"
  valid_uint "$now" || return 0
  [ "$now" -gt "$hs" ] || return 0
  printf '%s' "$((now - hs))"
}

# -------------------------------------------------------------------- poll
# Fetches the desired config, re-validates every field, rebuilds the canonical
# ruleset locally and refuses to apply anything whose sha256 does not match the
# server-published configHash.
poll_config() {
  [ -n "$CONNECTOR_ID" ] || { log 'no connector id yet'; exit 3; }
  applied="$(kv_value "$STATE_FILE" HASH)"
  if valid_hash "$applied"; then applied_json="$(printf '"%s"' "$applied")"; else applied_json=null; fi
  hs_json=null
  hs="$(handshake_age)"
  [ -z "$hs" ] || hs_json="$hs"

  body="$(mktemp)"; chmod 0600 "$body"
  resp="$(mktemp)"; chmod 0600 "$resp"
  flat="$(mktemp)"; chmod 0600 "$flat"
  objects="$(mktemp)"; chmod 0600 "$objects"
  printf '{"connectorId":"%s","token":"%s","agentVersion":"%s","handshakeAgeSeconds":%s,"appliedConfigHash":%s}' \\
    "$CONNECTOR_ID" "$TOKEN" "$AGENT_VERSION" "$hs_json" "$applied_json" > "$body"
  if ! http_post /api/network/connectors/config "$body" "$resp"; then
    rm -f "$body" "$resp" "$flat" "$objects"
    log 'config poll failed'
    exit 5
  fi
  rm -f "$body"
  flatten_json "$resp" "$flat"

  CONFIG_HASH="$(json_str "$flat" configHash)"
  if ! valid_hash "$CONFIG_HASH"; then rm -f "$resp" "$flat" "$objects"; log 'config response had no usable configHash'; exit 5; fi
  if ! parse_tunnel_block "$flat"; then rm -f "$resp" "$flat" "$objects"; exit 5; fi
  rm -f "$flat"
  write_tunnel_file

  ROUTES_FILE="$(mktemp)"; chmod 0600 "$ROUTES_FILE"
  raw="$(mktemp)"; chmod 0600 "$raw"
  : > "$raw"
  split_objects "$resp" | grep '"protocol"' > "$objects" || true
  rm -f "$resp"

  count=0
  refusal=""
  # The loop reads from a file (not a pipe) so $count and $refusal survive it.
  while IFS= read -r frag; do
    [ -n "$frag" ] || continue
    r_proto="$(frag_str "$frag" protocol)"
    r_lport="$(frag_num "$frag" listenPort)"
    r_target="$(frag_str "$frag" targetAddress)"
    r_tport="$(frag_num "$frag" targetPort)"
    if ! valid_proto "$r_proto" || ! valid_port "$r_lport" || ! valid_ip "$r_target" || ! valid_port "$r_tport"; then
      refusal='refusing a malformed route from the control plane'
      break
    fi
    count=$((count + 1))
    if [ "$count" -gt "$MAX_ROUTES" ]; then
      refusal='refusing a ruleset with too many routes'
      break
    fi
    printf 'ROUTE\\t%s\\t%s\\t%s\\t%s\\n' "$r_proto" "$r_lport" "$r_target" "$r_tport" >> "$raw"
  done < "$objects"
  rm -f "$objects"
  if [ -n "$refusal" ]; then
    rm -f "$raw" "$ROUTES_FILE"
    log "$refusal"
    exit 5
  fi

  # Canonical form (must match canonicalConnectorRuleset byte for byte):
  #   header line, then C-locale sorted, de-duplicated ROUTE lines.
  { printf 'CXRULESET\\t%s\\n' "$RULESET_VERSION"; LC_ALL=C sort -u "$raw"; } > "$ROUTES_FILE"
  rm -f "$raw"
  local_hash="$(sha256sum "$ROUTES_FILE" | awk '{print $1}')"
  if [ "$local_hash" != "$CONFIG_HASH" ]; then
    rm -f "$ROUTES_FILE"
    log 'published configHash does not match the parsed ruleset; not applying'
    exit 5
  fi
}

# ------------------------------------------------------------------- apply
managed_iptables_hash() {
  r="$1"
  {
    iptables -t nat -S "$DNAT"
    iptables -t nat -S "$SNAT"
    iptables -S "$FWD"
    iptables -t nat -S "$GEN_D$r"
    iptables -t nat -S "$GEN_S$r"
    iptables -S "$GEN_F$r"
  } 2>/dev/null | sha256sum | awk '{print $1}'
}

dispatchers_linked() {
  r="$1"
  [ "$r" -gt 0 ] || return 1
  iptables -t nat -C "$DNAT" -j "$GEN_D$r" 2>/dev/null || return 1
  iptables -t nat -C "$SNAT" -j "$GEN_S$r" 2>/dev/null || return 1
  iptables -C "$FWD" -j "$GEN_F$r" 2>/dev/null || return 1
  return 0
}

apply_ruleset() {
  ruleset="$1"; wanted_hash="$2"
  exec 9>"$LOCK_FILE"
  flock -n 9 || { log 'another connector apply is already in progress'; exit 4; }

  old_revision="$(kv_value "$STATE_FILE" REVISION)"
  valid_uint "$old_revision" || old_revision=0
  old_d="$GEN_D$old_revision"; old_s="$GEN_S$old_revision"; old_f="$GEN_F$old_revision"
  revision=$old_revision
  new_d=""; new_s=""; new_f=""

  generation="$(mktemp)"; swap="$(mktemp)"; rollback="$(mktemp)"; state="$(mktemp)"
  committed=0; swap_started=0
  cleanup() {
    rc=$?
    if [ "$committed" -ne 1 ] && [ "$swap_started" -eq 1 ]; then
      iptables-restore --noflush < "$rollback" >/dev/null 2>&1 || true
    fi
    rm -f "$generation" "$swap" "$rollback" "$state" "$ruleset"
    exit "$rc"
  }
  trap cleanup EXIT HUP INT TERM

  count="$(grep -c '^ROUTE' "$ruleset" || true)"
  valid_uint "$count" || count=0

  # Pick a free generation number. Normally that is old+1, but a hard kill in the
  # middle of an earlier swap can leave chains behind under that exact name. An
  # unreferenced leftover is reclaimed and a still-referenced one is skipped, so
  # the agent heals itself instead of wedging forever on a name collision. Only
  # PolySIEM-owned names are ever touched.
  attempts=0
  while : ; do
    revision=$((revision + 1))
    [ "$revision" -le 999999999 ] || revision=1
    attempts=$((attempts + 1))
    [ "$attempts" -le 64 ] || { log 'could not find a free generation chain name'; exit 6; }
    new_d="$GEN_D$revision"; new_s="$GEN_S$revision"; new_f="$GEN_F$revision"
    present=0
    iptables -t nat -S "$new_d" >/dev/null 2>&1 && present=1
    iptables -t nat -S "$new_s" >/dev/null 2>&1 && present=1
    iptables -S "$new_f" >/dev/null 2>&1 && present=1
    [ "$present" -eq 1 ] || break
    linked=0
    iptables -t nat -C "$DNAT" -j "$new_d" >/dev/null 2>&1 && linked=1
    iptables -t nat -C "$SNAT" -j "$new_s" >/dev/null 2>&1 && linked=1
    iptables -C "$FWD" -j "$new_f" >/dev/null 2>&1 && linked=1
    [ "$linked" -eq 0 ] || continue
    iptables -w -t nat -F "$new_d" 2>/dev/null && iptables -w -t nat -X "$new_d" 2>/dev/null || true
    iptables -w -t nat -F "$new_s" 2>/dev/null && iptables -w -t nat -X "$new_s" 2>/dev/null || true
    iptables -w -F "$new_f" 2>/dev/null && iptables -w -X "$new_f" 2>/dev/null || true
    break
  done

  {
    printf '*nat\\n:%s - [0:0]\\n:%s - [0:0]\\n' "$new_d" "$new_s"
    while IFS="$TAB" read -r kind proto lport target tport; do
      [ "$kind" = ROUTE ] || continue
      printf -- '-A %s -i %s -p %s --dport %s -j DNAT --to-destination %s:%s\\n' "$new_d" "$IFACE" "$proto" "$lport" "$target" "$tport"
      printf -- '-A %s -p %s -d %s --dport %s -m conntrack --ctstate DNAT -j MASQUERADE\\n' "$new_s" "$proto" "$target" "$tport"
    done < "$ruleset"
    printf 'COMMIT\\n*filter\\n:%s - [0:0]\\n' "$new_f"
    while IFS="$TAB" read -r kind proto lport target tport; do
      [ "$kind" = ROUTE ] || continue
      printf -- '-A %s -i %s -p %s -d %s --dport %s -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT\\n' "$new_f" "$IFACE" "$proto" "$target" "$tport"
      printf -- '-A %s -o %s -p %s -s %s --sport %s -m conntrack --ctstate ESTABLISHED -j ACCEPT\\n' "$new_f" "$IFACE" "$proto" "$target" "$tport"
    done < "$ruleset"
    printf 'COMMIT\\n'
  } > "$generation"

  iptables-restore --test --noflush < "$generation"
  iptables-restore --noflush < "$generation"

  # The three stable dispatchers are the only global hooks; non-matching traffic
  # returns immediately to the operator-owned ruleset.
  iptables -w -t nat -N "$DNAT" 2>/dev/null || iptables -w -t nat -S "$DNAT" >/dev/null
  iptables -w -t nat -N "$SNAT" 2>/dev/null || iptables -w -t nat -S "$SNAT" >/dev/null
  iptables -w -N "$FWD" 2>/dev/null || iptables -w -S "$FWD" >/dev/null
  iptables -w -t nat -C PREROUTING -j "$DNAT" 2>/dev/null || iptables -w -t nat -I PREROUTING 1 -j "$DNAT"
  iptables -w -t nat -C POSTROUTING -j "$SNAT" 2>/dev/null || iptables -w -t nat -I POSTROUTING 1 -j "$SNAT"
  iptables -w -C FORWARD -j "$FWD" 2>/dev/null || iptables -w -I FORWARD 1 -j "$FWD"

  {
    printf '*nat\\n:%s - [0:0]\\n:%s - [0:0]\\n-A %s -j %s\\n-A %s -j %s\\nCOMMIT\\n' "$DNAT" "$SNAT" "$DNAT" "$new_d" "$SNAT" "$new_s"
    printf '*filter\\n:%s - [0:0]\\n-A %s -j %s\\nCOMMIT\\n' "$FWD" "$FWD" "$new_f"
  } > "$swap"
  {
    printf '*nat\\n:%s - [0:0]\\n:%s - [0:0]\\n' "$DNAT" "$SNAT"
    if [ "$old_revision" -gt 0 ]; then printf -- '-A %s -j %s\\n-A %s -j %s\\n' "$DNAT" "$old_d" "$SNAT" "$old_s"; fi
    printf 'COMMIT\\n*filter\\n:%s - [0:0]\\n' "$FWD"
    if [ "$old_revision" -gt 0 ]; then printf -- '-A %s -j %s\\n' "$FWD" "$old_f"; fi
    printf 'COMMIT\\n'
  } > "$rollback"
  iptables-restore --test --noflush < "$swap"

  [ "$count" -eq 0 ] || sysctl -w net.ipv4.ip_forward=1 >/dev/null
  swap_started=1
  iptables-restore --noflush < "$swap"

  iptables_hash="$(managed_iptables_hash "$revision")"
  valid_hash "$iptables_hash" || { log 'could not verify the applied generation'; exit 6; }
  printf 'REVISION\\t%s\\nHASH\\t%s\\nCOUNT\\t%s\\nIPTABLES_HASH\\t%s\\nIFACE\\t%s\\nAGENT_VERSION\\t%s\\n' \\
    "$revision" "$wanted_hash" "$count" "$iptables_hash" "$IFACE" "$AGENT_VERSION" > "$state"
  chmod 0600 "$state"
  mv "$state" "$STATE_FILE"
  committed=1

  # Retire every PolySIEM generation chain except the one just committed. This
  # runs only after the new dispatchers and the new state file are durable, and
  # the dispatchers now reference nothing else, so each of these is unreferenced.
  # The name pattern cannot match the dispatchers themselves (PS_CX_DNAT / _SNAT /
  # _FORWARD have no numeric generation suffix).
  for stale in $(iptables -t nat -S 2>/dev/null | sed -n 's/^-N \\(PS_CX_[DS]_[0-9][0-9]*\\)$/\\1/p'); do
    [ "$stale" != "$new_d" ] && [ "$stale" != "$new_s" ] || continue
    iptables -w -t nat -F "$stale" 2>/dev/null && iptables -w -t nat -X "$stale" 2>/dev/null || true
  done
  for stale in $(iptables -S 2>/dev/null | sed -n 's/^-N \\(PS_CX_F_[0-9][0-9]*\\)$/\\1/p'); do
    [ "$stale" != "$new_f" ] || continue
    iptables -w -F "$stale" 2>/dev/null && iptables -w -X "$stale" 2>/dev/null || true
  done
  printf 'APPLIED\\t%s\\t%s\\t%s\\n' "$count" "$revision" "$wanted_hash"
}

maybe_apply() {
  stored_hash="$(kv_value "$STATE_FILE" HASH)"
  stored_revision="$(kv_value "$STATE_FILE" REVISION)"
  valid_uint "$stored_revision" || stored_revision=0
  need=0
  [ "$CONFIG_HASH" = "$stored_hash" ] || need=1
  if [ "$need" -eq 0 ] && ! dispatchers_linked "$stored_revision"; then need=1; fi
  if [ "$need" -eq 0 ]; then
    stored_ipt="$(kv_value "$STATE_FILE" IPTABLES_HASH)"
    [ "$(managed_iptables_hash "$stored_revision")" = "$stored_ipt" ] || need=1
  fi
  if [ "$need" -eq 0 ]; then
    rm -f "$ROUTES_FILE"
    return 0
  fi
  apply_ruleset "$ROUTES_FILE" "$CONFIG_HASH"
}

# --------------------------------------------------------------- subcommands
cmd_once() {
  check_deps
  setup_tmp
  load_config
  load_token
  load_tunnel_file
  ensure_enrolled
  ensure_tunnel
  poll_config
  ensure_tunnel
  maybe_apply
}

cmd_run() {
  self="$0"
  case "$self" in /*) ;; *) self=${CONNECTOR_AGENT_PATH};; esac
  check_deps
  setup_tmp
  while : ; do
    rc=0
    "$self" once || rc=$?
    [ "$rc" -eq 0 ] || log "poll cycle failed (exit $rc); retrying"
    interval="$(kv_value "$TUNNEL_FILE" POLL_INTERVAL)"
    valid_uint "$interval" || interval=$DEFAULT_POLL
    [ "$interval" -ge "$MIN_POLL" ] || interval=$MIN_POLL
    [ "$interval" -le "$MAX_POLL" ] || interval=$MAX_POLL
    sleep "$interval"
  done
}

# Prints only non-secret facts. The token and the private key are never shown.
cmd_status() {
  setup_tmp
  load_config
  load_tunnel_file
  printf 'POLYSIEM_CONNECTOR_STATUS_V1\\n'
  printf 'AGENT_VERSION\\t%s\\n' "$AGENT_VERSION"
  printf 'CONNECTOR_ID\\t%s\\n' "\${CONNECTOR_ID:--}"
  printf 'ENROLLED\\t%s\\n' "$(kv_value "$TUNNEL_FILE" ENROLLED)"
  printf 'IFACE\\t%s\\n' "$IFACE"
  printf 'TUNNEL_ADDRESS\\t%s\\n' "\${TUNNEL_ADDRESS:--}"
  printf 'EDGE_ENDPOINT\\t%s\\n' "\${EDGE_ENDPOINT:--}"
  if [ -s "$PUB_FILE" ]; then printf 'PUBLIC_KEY\\t%s\\n' "$(tr -d ' \\t\\r\\n' < "$PUB_FILE")"; else printf 'PUBLIC_KEY\\t-\\n'; fi
  hs="$(handshake_age)"
  printf 'HANDSHAKE_AGE\\t%s\\n' "\${hs:--}"
  revision="$(kv_value "$STATE_FILE" REVISION)"
  valid_uint "$revision" || revision=0
  printf 'APPLIED_REVISION\\t%s\\n' "$revision"
  applied="$(kv_value "$STATE_FILE" HASH)"
  valid_hash "$applied" || applied=-
  printf 'APPLIED_HASH\\t%s\\n' "$applied"
  printf 'MANAGED_ROUTES\\t%s\\n' "$(kv_value "$STATE_FILE" COUNT)"
  drift=0
  if [ "$revision" -gt 0 ]; then
    dispatchers_linked "$revision" || drift=1
    [ "$drift" -eq 1 ] || [ "$(managed_iptables_hash "$revision")" = "$(kv_value "$STATE_FILE" IPTABLES_HASH)" ] || drift=1
  fi
  printf 'RULESET_DRIFT\\t%s\\n' "$drift"
}

action="\${1:-run}"
case "$action" in
  run) cmd_run ;;
  once) cmd_once ;;
  status) cmd_status ;;
  version) printf '%s\\n' "$AGENT_VERSION" ;;
  *) printf 'usage: polysiem-connector-agent [run|once|status|version]\\n' >&2; exit 2 ;;
esac
`;
