import {
  CONNECTOR_AGENT_PATH,
  CONNECTOR_AGENT_SCRIPT,
  CONNECTOR_AGENT_VERSION,
  CONNECTOR_CONFIG_DIR,
  CONNECTOR_SERVICE_NAME,
  CONNECTOR_SSH_USERNAME,
  CONNECTOR_SUDOERS_PATH,
} from "./agent";

/**
 * Options for {@link buildConnectorInstallScript}.
 *
 * Everything here is baked into the generated script, so every field is validated
 * against a tight allow-list before it is interpolated: the script is served over
 * HTTP and piped straight into `sh` by an operator.
 */
export interface ConnectorInstallOptions {
  /** PolySIEM base URL the connector will poll, e.g. `https://polysiem.lan:3000`. */
  baseUrl: string;
  /** One-time `pscx_…` install token minted at connector creation (or rotation). */
  token: string;
  /** Optional pre-seeded connector id; the agent also learns it from the enroll response. */
  connectorId?: string;
  /** WireGuard interface the agent creates and owns. Defaults to `wg0`. */
  interfaceName?: string;
  /** Skip TLS verification (PolySIEM commonly serves a self-signed certificate). */
  insecure?: boolean;
  /**
   * Phase 2 — SSH management. The complete `authorized_keys` line, normally built
   * with {@link connectorRestrictedAuthorizedKey}: `restrict,command="sudo -n
   * <agent>" <pubkey>`. When supplied, the installer additionally creates the
   * {@link CONNECTOR_SSH_USERNAME} system account, installs this line at 0600, and
   * writes a visudo-validated sudoers drop-in granting NOPASSWD on the agent path
   * only.
   *
   * When it is absent the generated script is byte-for-byte the phase-1 installer:
   * no account, no authorized_keys, no sudoers. Token/poll management alone.
   */
  authorizedKey?: string;
  /** Account the restricted key belongs to. Defaults to {@link CONNECTOR_SSH_USERNAME}. */
  sshUsername?: string;
}

/** Absolute path of the systemd unit written by the installer. */
export const CONNECTOR_SERVICE_PATH = `/etc/systemd/system/${CONNECTOR_SERVICE_NAME}`;

const BASE_URL_PATTERN = /^https?:\/\/[A-Za-z0-9._~-]+(:[0-9]{1,5})?(\/[A-Za-z0-9._~/-]*)?$/;
const TOKEN_PATTERN = /^pscx_[A-Za-z0-9_-]{24,96}$/;
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const INTERFACE_PATTERN = /^[A-Za-z0-9_.:-]{1,15}$/;
const USERNAME_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;
/**
 * An authorized_keys line is embedded in a quoted heredoc, so the shell never
 * expands it — but it still must be a single line of printable ASCII that cannot
 * contain the heredoc terminator, and it must actually look like a key.
 */
const AUTHORIZED_KEY_SHAPE = /^[\x20-\x7E]{1,4096}$/;
const AUTHORIZED_KEY_BODY =
  /(?:^|\s)(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp(?:256|384|521)|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com)\s+[A-Za-z0-9+/]+={0,3}(?:\s|$)/;

/** Markers around every line the SSH-management option adds. Purely additive. */
const SSH_BLOCK_OPEN = "# >>> polysiem-connector ssh management";
const SSH_BLOCK_CLOSE = "# <<< polysiem-connector ssh management";

/** Trims and drops trailing slashes so the agent can concatenate `$BASE_URL$path`. */
export function normalizeConnectorBaseUrl(baseUrl: string): string {
  const trimmed = String(baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!BASE_URL_PATTERN.test(trimmed)) {
    throw new Error("Connector base URL must be a plain http(s) URL without credentials, query, or shell metacharacters");
  }
  return trimmed;
}

function assertToken(token: string): string {
  const trimmed = String(token ?? "").trim();
  if (!TOKEN_PATTERN.test(trimmed)) throw new Error("Invalid connector install token");
  return trimmed;
}

function assertConnectorId(connectorId: string): string {
  const trimmed = String(connectorId ?? "").trim();
  if (!CONNECTOR_ID_PATTERN.test(trimmed)) throw new Error("Invalid connector id");
  return trimmed;
}

function assertInterfaceName(interfaceName: string): string {
  const trimmed = String(interfaceName ?? "").trim();
  if (!INTERFACE_PATTERN.test(trimmed)) throw new Error("Invalid WireGuard interface name");
  return trimmed;
}

function assertSshUsername(username: string): string {
  const trimmed = String(username ?? "").trim();
  if (!USERNAME_PATTERN.test(trimmed) || trimmed === "root") throw new Error("Invalid connector SSH username");
  return trimmed;
}

function assertAuthorizedKey(line: string): string {
  const trimmed = String(line ?? "").trim();
  if (!AUTHORIZED_KEY_SHAPE.test(trimmed) || !AUTHORIZED_KEY_BODY.test(trimmed)) {
    throw new Error("Invalid connector authorized_keys line");
  }
  return trimmed;
}

/**
 * The copy-paste one-liner shown in the install dialog. The token is carried in
 * the URL because the served script has it baked in; it is single-use.
 */
export function buildConnectorInstallCommand(options: {
  baseUrl: string;
  token: string;
  insecure?: boolean;
}): string {
  const baseUrl = normalizeConnectorBaseUrl(options.baseUrl);
  const token = assertToken(options.token);
  const insecure = options.insecure === true ? " -k" : "";
  return `curl -fsSL${insecure} "${baseUrl}/api/network/connectors/install.sh?token=${token}" | sudo sh`;
}

/**
 * Body served by `GET /api/network/connectors/install.sh` when the token is not
 * valid. Deliberately generic: it must not reveal whether the token ever existed.
 */
export function buildConnectorInstallErrorScript(message = "invalid or expired install token"): string {
  const safe = String(message).replace(/[^A-Za-z0-9 .,:;()/_-]/g, " ").slice(0, 200);
  return `#!/bin/sh
printf 'PolySIEM connector installer: %s\\n' '${safe}' >&2
printf 'Create a new connector (or rotate its token) in PolySIEM and paste the fresh command.\\n' >&2
exit 1
`;
}

/**
 * The account + authorized_keys + sudoers half of the installer. Returns "" when
 * no key was supplied, which is what keeps the phase-1 output byte-identical.
 *
 * Mirrors `buildEdgeAgentInstallScript`: same existing-account safety check, same
 * 0600 authorized_keys, same visudo-validated NOPASSWD drop-in scoped to exactly
 * one command path.
 */
function buildSshProvisioning(authorizedKey: string, sshUsername: string): string {
  return `${SSH_BLOCK_OPEN}
# PolySIEM manages this connector over SSH as well as by polling. The key below
# is pinned to a forced command, so it can only run the agent (STATUS / APPLY) —
# never a shell, a pty, or a forwarded port. The connector's WireGuard private
# key never leaves this machine: PolySIEM only ever reads the derived public key
# out of the agent's STATUS output.
SSH_USER='${sshUsername}'
for binary in useradd getent chown cut sudo visudo; do
  command -v "$binary" >/dev/null 2>&1 || {
    printf 'Missing required command for SSH management: %s\\nInstall shadow-utils/passwd and sudo, then re-run.\\n' "$binary" >&2
    exit 1
  }
done
if id "$SSH_USER" >/dev/null 2>&1; then
  existing_home="$(getent passwd "$SSH_USER" | cut -d: -f6)"
  [ "$existing_home" = "/home/$SSH_USER" ] || {
    printf 'Existing %s account has an unexpected home directory; refusing to reuse it.\\n' "$SSH_USER" >&2
    exit 1
  }
else
  useradd --create-home --user-group --shell /bin/sh "$SSH_USER"
fi
install -d -m 0700 -o "$SSH_USER" -g "$SSH_USER" "/home/$SSH_USER/.ssh"
cat > "/home/$SSH_USER/.ssh/authorized_keys.new" <<'POLYSIEM_CONNECTOR_KEY'
${authorizedKey}
POLYSIEM_CONNECTOR_KEY
chown "$SSH_USER:$SSH_USER" "/home/$SSH_USER/.ssh/authorized_keys.new"
chmod 0600 "/home/$SSH_USER/.ssh/authorized_keys.new"
mv "/home/$SSH_USER/.ssh/authorized_keys.new" "/home/$SSH_USER/.ssh/authorized_keys"
printf '%s ALL=(root) NOPASSWD: ${CONNECTOR_AGENT_PATH} ""\\n' "$SSH_USER" > ${CONNECTOR_SUDOERS_PATH}.new
chmod 0440 ${CONNECTOR_SUDOERS_PATH}.new
visudo -cf ${CONNECTOR_SUDOERS_PATH}.new >/dev/null
mv ${CONNECTOR_SUDOERS_PATH}.new ${CONNECTOR_SUDOERS_PATH}
${SSH_BLOCK_CLOSE}
`;
}

/** The two extra summary lines that belong with {@link buildSshProvisioning}. */
function buildSshSummary(): string {
  return `${SSH_BLOCK_OPEN}
printf '  ssh user  %s (restricted key; it can only run the agent)\\n' "$SSH_USER"
printf '  sudoers   ${CONNECTOR_SUDOERS_PATH} (NOPASSWD on the agent path only)\\n'
${SSH_BLOCK_CLOSE}
`;
}

/**
 * Idempotent, root-run installer for the PolySIEM connector.
 *
 * It installs the dependencies it actually needs (`wireguard-tools`, `iproute2`,
 * `iptables`, `curl` and friends) through apt/dnf/yum, writes
 * `/etc/polysiem-connector/{config,token}` (0600 inside a 0700 directory), drops
 * the agent at {@link CONNECTOR_AGENT_PATH} (0755), and installs a plain
 * `Type=simple` systemd unit that runs the agent's poll loop with
 * `Restart=always`. The agent — not any interface wrapper — creates and
 * configures the WireGuard link, so boot persistence is just the unit starting.
 *
 * With `authorizedKey` it also provisions the SSH side: the
 * {@link CONNECTOR_SSH_USERNAME} account, a 0600 `authorized_keys` holding the
 * forced-command line, and a visudo-validated `/etc/sudoers.d/polysiem-connector`.
 * Without it, the output is exactly the phase-1 script.
 *
 * Re-running is safe: every file is written to a `.new` sibling and moved into
 * place, the service is enabled and restarted rather than only started, and the
 * supplied token replaces whatever token was stored before (which is exactly
 * what makes "rotate token, re-run the command" work).
 */
export function buildConnectorInstallScript(options: ConnectorInstallOptions): string {
  const baseUrl = normalizeConnectorBaseUrl(options.baseUrl);
  const token = assertToken(options.token);
  const connectorId = options.connectorId === undefined || options.connectorId === null || options.connectorId === ""
    ? ""
    : assertConnectorId(options.connectorId);
  const interfaceName = assertInterfaceName(options.interfaceName ?? "wg0");
  const insecure = options.insecure === true ? "1" : "0";
  const hasSsh = options.authorizedKey !== undefined && options.authorizedKey !== null && options.authorizedKey !== "";
  const authorizedKey = hasSsh ? assertAuthorizedKey(options.authorizedKey as string) : "";
  const sshUsername = hasSsh ? assertSshUsername(options.sshUsername ?? CONNECTOR_SSH_USERNAME) : "";
  const sshProvisioning = hasSsh ? buildSshProvisioning(authorizedKey, sshUsername) : "";
  const sshSummary = hasSsh ? buildSshSummary() : "";

  return `#!/bin/sh
# PolySIEM connector installer (agent version ${CONNECTOR_AGENT_VERSION}).
# Safe to re-run: it repairs an existing install in place.
set -eu
[ "$(id -u)" -eq 0 ] || { printf 'Run this installer as root (pipe it into "sudo sh").\\n' >&2; exit 1; }
umask 077

BASE_URL='${baseUrl}'
INSTALL_TOKEN='${token}'
CONNECTOR_ID='${connectorId}'
IFACE='${interfaceName}'
INSECURE=${insecure}

CONF_DIR=${CONNECTOR_CONFIG_DIR}
AGENT_PATH=${CONNECTOR_AGENT_PATH}
SERVICE_NAME=${CONNECTOR_SERVICE_NAME}
SERVICE_PATH=${CONNECTOR_SERVICE_PATH}
REQUIRED='wg ip iptables iptables-restore curl awk grep sed tr sort mktemp sha256sum flock install chmod mv rm sysctl date sleep uname'

missing=''
for binary in $REQUIRED; do
  command -v "$binary" >/dev/null 2>&1 || missing="$missing $binary"
done

if [ -n "$missing" ]; then
  printf 'Installing missing dependencies:%s\\n' "$missing"
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get update -qq
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq wireguard-tools iproute2 iptables curl coreutils util-linux procps sed gawk grep
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q wireguard-tools iproute iptables curl coreutils util-linux procps-ng sed gawk grep
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q wireguard-tools iproute iptables curl coreutils util-linux procps-ng sed gawk grep
  else
    printf 'No supported package manager (apt-get/dnf/yum) was found.\\nInstall these first:%s\\n' "$missing" >&2
    exit 1
  fi
fi

for binary in $REQUIRED; do
  command -v "$binary" >/dev/null 2>&1 || {
    printf 'Missing required command after dependency install: %s\\nInstall wireguard-tools, iproute2, iptables, curl, util-linux and coreutils, then re-run.\\n' "$binary" >&2
    exit 1
  }
done

if ! ip link add dev polysiemwgchk type wireguard >/dev/null 2>&1; then
  printf 'This kernel cannot create WireGuard interfaces. Load the wireguard module (or use a kernel that has it) and re-run.\\n' >&2
  exit 1
fi
ip link del dev polysiemwgchk >/dev/null 2>&1 || true

install -d -m 0700 "$CONF_DIR"

cat > "$CONF_DIR/config.new" <<POLYSIEM_CONNECTOR_CONFIG
# PolySIEM connector settings. Managed by the installer; parsed, never sourced.
BASE_URL=$BASE_URL
CONNECTOR_ID=$CONNECTOR_ID
IFACE=$IFACE
POLYSIEM_INSECURE=$INSECURE
POLYSIEM_CONNECTOR_CONFIG
chmod 0600 "$CONF_DIR/config.new"
mv "$CONF_DIR/config.new" "$CONF_DIR/config"

# The token is the connector's only credential. It is written 0600 and is never
# echoed by the installer or by the agent. Enrolling rotates it in place.
printf '%s\\n' "$INSTALL_TOKEN" > "$CONF_DIR/token.new"
chmod 0600 "$CONF_DIR/token.new"
mv "$CONF_DIR/token.new" "$CONF_DIR/token"

install -d -m 0755 /usr/local/libexec
cat > "$AGENT_PATH.new" <<'POLYSIEM_CONNECTOR_AGENT'
${CONNECTOR_AGENT_SCRIPT}POLYSIEM_CONNECTOR_AGENT
chown root:root "$AGENT_PATH.new" 2>/dev/null || true
chmod 0755 "$AGENT_PATH.new"
mv "$AGENT_PATH.new" "$AGENT_PATH"

${sshProvisioning}if command -v systemctl >/dev/null 2>&1; then
  cat > "$SERVICE_PATH.new" <<'POLYSIEM_CONNECTOR_UNIT'
[Unit]
Description=PolySIEM connector (reverse tunnel and last-hop NAT)
Documentation=https://github.com/Realynx/PolySIEM
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
# The agent brings the WireGuard interface up itself with ip(8) + wg(8) and then
# polls PolySIEM forever. No interface-wrapper helper is involved: it segfaults on
# this container image, so this unit is the only thing that has to survive a boot.
Type=simple
ExecStart=${CONNECTOR_AGENT_PATH} run
Restart=always
RestartSec=10s
TimeoutStartSec=0
KillMode=mixed

[Install]
WantedBy=multi-user.target
POLYSIEM_CONNECTOR_UNIT
  chmod 0644 "$SERVICE_PATH.new"
  mv "$SERVICE_PATH.new" "$SERVICE_PATH"
  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null
  if systemctl restart "$SERVICE_NAME"; then :; else
    printf 'The %s unit failed to start. Inspect it with: journalctl -u %s -n 50\\n' "$SERVICE_NAME" "$SERVICE_NAME" >&2
    exit 1
  fi
else
  printf 'systemd was not found; running a single connector cycle now.\\n' >&2
  printf 'Arrange for "%s run" to start at boot yourself.\\n' "$AGENT_PATH" >&2
  "$AGENT_PATH" once
fi

printf '\\n'
printf 'PolySIEM connector installed.\\n'
printf '  agent     %s (version ${CONNECTOR_AGENT_VERSION})\\n' "$AGENT_PATH"
printf '  service   %s (enabled, restart=always)\\n' "$SERVICE_NAME"
printf '  config    %s/config\\n' "$CONF_DIR"
printf '  token     %s/token (0600, replaces any previously stored token)\\n' "$CONF_DIR"
printf '  tunnel    %s (created by the agent; no reboot needed)\\n' "$IFACE"
${sshSummary}printf '\\n'
printf 'It enrolls itself on the next poll and should show as connected in PolySIEM within a minute.\\n'
printf 'Watch it:  journalctl -u %s -f\\n' "$SERVICE_NAME"
printf 'Inspect:   %s status\\n' "$AGENT_PATH"
`;
}

/**
 * Removes every SSH-management region from a generated installer. Exported for
 * tests (and useful for diffing): stripping them from an SSH-enabled script must
 * yield the phase-1 script byte for byte.
 */
export function stripConnectorSshBlocks(script: string): string {
  let out = "";
  let cursor = 0;
  for (;;) {
    const open = script.indexOf(SSH_BLOCK_OPEN, cursor);
    if (open === -1) break;
    const close = script.indexOf(SSH_BLOCK_CLOSE, open);
    if (close === -1) break;
    out += script.slice(cursor, open);
    cursor = close + SSH_BLOCK_CLOSE.length + 1; // include the marker's newline
  }
  return out + script.slice(cursor);
}
