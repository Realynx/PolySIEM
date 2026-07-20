import { createHash } from "node:crypto";

/** Fixed forced-command path installed by the enrollment bundle. */
export const EDGE_AGENT_PATH = "/usr/local/libexec/polysiem-edge-agent";

/**
 * Root-owned helper installed on the edge host. It accepts only STATUS/APPLY,
 * validates the wire protocol again, and touches only PolySIEM-owned chains.
 *
 * Each apply builds immutable generation chains, validates both tables with
 * iptables-restore --test, and then swaps the three small dispatcher chains.
 * The previous dispatchers remain available for rollback until the new state
 * file has been committed.
 */
export const EDGE_AGENT_SCRIPT = `#!/bin/sh
set -eu
DNAT=PS_EDGE_DNAT
SNAT=PS_EDGE_SNAT
FWD=PS_EDGE_FORWARD
STATE_DIR=/etc/polysiem-edge
STATE_FILE=$STATE_DIR/state
RULES_FILE=$STATE_DIR/rules
TAB="$(printf '\\t')"

valid_if() { [ -n "$1" ] && [ "\${1#????????????????}" = "$1" ] && ! printf %s "$1" | grep -q '[^A-Za-z0-9_.:-]'; }
valid_port() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 65535 ]; }
valid_revision() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 1 ] && [ "$1" -le 999999999 ]; }
valid_count() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "$1" -ge 0 ] && [ "$1" -le 200 ]; }
valid_hash() { [ "\${#1}" -eq 64 ] && ! printf %s "$1" | grep -q '[^0-9a-f]'; }
valid_ip() { printf '%s\\n' "$1" | awk -F. 'NF==4 { for(i=1;i<=4;i++) if($i !~ /^[0-9]+$/ || $i>255) exit 1; exit 0 } { exit 1 }'; }
valid_cidr() { printf '%s\\n' "$1" | awk -F/ 'NF<=2 { split($1,a,"."); if(length(a)!=4) exit 1; for(i=1;i<=4;i++) if(a[i] !~ /^[0-9]+$/ || a[i]>255) exit 1; if(NF==2 && ($2 !~ /^[0-9]+$/ || $2>32)) exit 1; exit 0 } { exit 1 }'; }

state_value() {
  [ -f "$STATE_FILE" ] || return 0
  awk -F '\\t' -v wanted="$1" '$1 == wanted { print $2; exit }' "$STATE_FILE" 2>/dev/null || true
}

managed_iptables_hash() {
  wanted_revision="$1"
  d="PS_ED_D_$wanted_revision"; s="PS_ED_S_$wanted_revision"; f="PS_ED_F_$wanted_revision"
  {
    iptables -t nat -S "$DNAT"
    iptables -t nat -S "$SNAT"
    iptables -S "$FWD"
    iptables -t nat -S "$d"
    iptables -t nat -S "$s"
    iptables -S "$f"
  } 2>/dev/null | sha256sum | awk '{print $1}'
}

IFS= read -r action || exit 2
case "$action" in
  STATUS)
    printf 'POLYSIEM_EDGE_STATUS_V1\\n'
    printf 'HOSTNAME\\t%s\\n' "$(hostname 2>/dev/null | tr '\\t\\r\\n' '   ' | cut -c1-253)"
    printf 'KERNEL\\t%s\\n' "$(uname -srmo 2>/dev/null | tr '\\t\\r\\n' '   ' | cut -c1-512)"
    ip -o -4 addr show 2>/dev/null | sed 's/^/ADDRESS\\t/' | cut -c1-1024 || true
    ip -4 route show 2>/dev/null | sed 's/^/ROUTE\\t/' | cut -c1-1024 || true
    printf 'IP_FORWARD\\t%s\\n' "$(sysctl -n net.ipv4.ip_forward 2>/dev/null || printf 0)"
    revision="$(state_value REVISION)"; hash="$(state_value HASH)"; count="$(state_value COUNT)"
    stored_iptables_hash="$(state_value IPTABLES_HASH)"; actual_iptables_hash=-; drift=0
    valid_revision "$revision" || revision=0
    valid_hash "$hash" || hash=-
    valid_count "$count" || count=0
    if [ "$revision" -gt 0 ]; then
      d="PS_ED_D_$revision"; s="PS_ED_S_$revision"; f="PS_ED_F_$revision"
      if ! iptables -t nat -C "$DNAT" -j "$d" 2>/dev/null || \
         ! iptables -t nat -C "$SNAT" -j "$s" 2>/dev/null || \
         ! iptables -C "$FWD" -j "$f" 2>/dev/null; then
        revision=0; hash=-; count=0; drift=1
      else
        actual_iptables_hash="$(managed_iptables_hash "$revision")"
        if ! valid_hash "$stored_iptables_hash" || [ "$actual_iptables_hash" != "$stored_iptables_hash" ]; then
          hash=-; drift=1
        fi
      fi
    fi
    printf 'MANAGED_RULES\\t%s\\n' "$count"
    printf 'APPLIED_REVISION\\t%s\\n' "$revision"
    printf 'APPLIED_HASH\\t%s\\n' "$hash"
    printf 'IPTABLES_HASH\\t%s\\n' "$actual_iptables_hash"
    printf 'RULESET_DRIFT\\t%s\\n' "$drift"
    ;;
  APPLY)
    for binary in iptables iptables-restore ip awk grep sed cut mktemp sysctl flock sha256sum install chmod mv rm wc tr; do
      command -v "$binary" >/dev/null 2>&1 || { printf 'missing dependency: %s\\n' "$binary" >&2; exit 3; }
    done
    install -d -m 0700 "$STATE_DIR"
    exec 9>"$STATE_DIR/apply.lock"
    flock -n 9 || { printf 'another Edge NAT apply is in progress\\n' >&2; exit 4; }

    IFS="$TAB" read -r meta revision wanted_hash meta_extra || exit 2
    [ "$meta" = META ] && [ -z "\${meta_extra:-}" ] && valid_revision "$revision" && valid_hash "$wanted_hash" || exit 2
    IFS="$TAB" read -r config public_if outbound_if enable_forward config_extra || exit 2
    [ "$config" = CONFIG ] && [ -z "\${config_extra:-}" ] || exit 2
    valid_if "$public_if" && valid_if "$outbound_if" || exit 2
    [ "$enable_forward" = 0 ] || [ "$enable_forward" = 1 ] || exit 2
    [ -d "/sys/class/net/$public_if" ] && [ -d "/sys/class/net/$outbound_if" ] || exit 3

    rules="$(mktemp)"; canonical="$(mktemp)"; generation="$(mktemp)"; swap="$(mktemp)"; rollback="$(mktemp)"; request="$(mktemp)"; state="$(mktemp)"
    committed=0; swap_started=0
    cleanup() {
      rc=$?
      if [ "$committed" -ne 1 ] && [ "$swap_started" -eq 1 ]; then
        iptables-restore --noflush < "$rollback" >/dev/null 2>&1 || true
      fi
      rm -f "$rules" "$canonical" "$generation" "$swap" "$rollback" "$request" "$state"
      exit "$rc"
    }
    trap cleanup EXIT HUP INT TERM

    printf 'CONFIG\\t%s\\t%s\\t%s\\n' "$public_if" "$outbound_if" "$enable_forward" > "$canonical"
    printf 'APPLY\\nMETA\\t%s\\t%s\\nCONFIG\\t%s\\t%s\\t%s\\n' "$revision" "$wanted_hash" "$public_if" "$outbound_if" "$enable_forward" > "$request"
    saw_end=0
    while IFS="$TAB" read -r kind protocol public_port target target_port source extra; do
      if [ "$kind" = END ]; then
        [ -z "\${protocol:-}\${public_port:-}\${target:-}\${target_port:-}\${source:-}\${extra:-}" ] || exit 2
        saw_end=1
        break
      fi
      [ "$kind" = RULE ] && [ -z "\${extra:-}" ] || exit 2
      case "$protocol" in tcp|udp) ;; *) exit 2;; esac
      valid_port "$public_port" && valid_ip "$target" && valid_port "$target_port" || exit 2
      [ "$source" = - ] || valid_cidr "$source" || exit 2
      printf '%s\\t%s\\t%s\\t%s\\t%s\\n' "$protocol" "$public_port" "$target" "$target_port" "$source" >> "$rules"
      printf 'RULE\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$protocol" "$public_port" "$target" "$target_port" "$source" >> "$canonical"
      printf 'RULE\\t%s\\t%s\\t%s\\t%s\\t%s\\n' "$protocol" "$public_port" "$target" "$target_port" "$source" >> "$request"
    done
    [ "$saw_end" -eq 1 ] || { printf 'truncated ruleset: END missing\\n' >&2; exit 2; }
    IFS= read -r trailing && { printf 'unexpected data after END\\n' >&2; exit 2; } || true
    printf 'END\\n' >> "$request"

    actual_hash="$(sha256sum "$canonical" | awk '{print $1}')"
    [ "$actual_hash" = "$wanted_hash" ] || { printf 'ruleset hash mismatch\\n' >&2; exit 2; }
    old_revision="$(state_value REVISION)"; old_hash="$(state_value HASH)"
    valid_revision "$old_revision" || old_revision=0
    valid_hash "$old_hash" || old_hash=-
    if [ "$revision" -lt "$old_revision" ] || { [ "$revision" -eq "$old_revision" ] && [ "$wanted_hash" != "$old_hash" ]; }; then
      printf 'stale or conflicting ruleset revision\\n' >&2; exit 5
    fi

    new_d="PS_ED_D_$revision"; new_s="PS_ED_S_$revision"; new_f="PS_ED_F_$revision"
    old_d="PS_ED_D_$old_revision"; old_s="PS_ED_S_$old_revision"; old_f="PS_ED_F_$old_revision"
    active=0; links_present=0
    stored_iptables_hash="$(state_value IPTABLES_HASH)"
    if iptables -t nat -C "$DNAT" -j "$new_d" 2>/dev/null && \
       iptables -t nat -C "$SNAT" -j "$new_s" 2>/dev/null && \
       iptables -C "$FWD" -j "$new_f" 2>/dev/null; then links_present=1; fi
    if [ "$revision" -eq "$old_revision" ] && [ "$wanted_hash" = "$old_hash" ] && \
       [ "$links_present" -eq 1 ] && \
       valid_hash "$stored_iptables_hash" && \
       [ "$(managed_iptables_hash "$revision")" = "$stored_iptables_hash" ]; then active=1; fi
    if [ "$active" -eq 1 ]; then
      printf 'APPLIED\\t%s\\t%s\\t%s\\n' "$(wc -l < "$rules" | tr -d ' ')" "$revision" "$wanted_hash"
      committed=1
      exit 0
    fi
    if [ "$revision" -eq "$old_revision" ] && [ "$links_present" -eq 1 ]; then
      printf 'managed rules drifted; submit a newer revision to repair them\\n' >&2
      exit 6
    fi

    # A previously interrupted attempt may have left unreferenced chains for
    # this never-committed revision. Remove only those exact PolySIEM names.
    if iptables -t nat -S "$new_d" >/dev/null 2>&1; then
      iptables -t nat -C "$DNAT" -j "$new_d" >/dev/null 2>&1 && exit 6
      iptables -w -t nat -F "$new_d" && iptables -w -t nat -X "$new_d"
    fi
    if iptables -t nat -S "$new_s" >/dev/null 2>&1; then
      iptables -t nat -C "$SNAT" -j "$new_s" >/dev/null 2>&1 && exit 6
      iptables -w -t nat -F "$new_s" && iptables -w -t nat -X "$new_s"
    fi
    if iptables -S "$new_f" >/dev/null 2>&1; then
      iptables -C "$FWD" -j "$new_f" >/dev/null 2>&1 && exit 6
      iptables -w -F "$new_f" && iptables -w -X "$new_f"
    fi

    {
      printf '*nat\\n:%s - [0:0]\\n:%s - [0:0]\\n' "$new_d" "$new_s"
      while IFS="$TAB" read -r protocol public_port target target_port source; do
        source_arg=""; [ "$source" = - ] || source_arg="-s $source"
        printf -- '-A %s -i %s -p %s %s --dport %s -j DNAT --to-destination %s:%s\\n' "$new_d" "$public_if" "$protocol" "$source_arg" "$public_port" "$target" "$target_port"
        printf -- '-A %s -o %s -p %s %s -d %s --dport %s -m conntrack --ctstate DNAT -j MASQUERADE\\n' "$new_s" "$outbound_if" "$protocol" "$source_arg" "$target" "$target_port"
      done < "$rules"
      printf 'COMMIT\\n*filter\\n:%s - [0:0]\\n' "$new_f"
      while IFS="$TAB" read -r protocol public_port target target_port source; do
        source_arg=""; [ "$source" = - ] || source_arg="-s $source"
        printf -- '-A %s -i %s -o %s -p %s %s -d %s --dport %s -m conntrack --ctstate NEW,ESTABLISHED -j ACCEPT\\n' "$new_f" "$public_if" "$outbound_if" "$protocol" "$source_arg" "$target" "$target_port"
        printf -- '-A %s -i %s -o %s -p %s -s %s --sport %s -m conntrack --ctstate ESTABLISHED -j ACCEPT\\n' "$new_f" "$outbound_if" "$public_if" "$protocol" "$target" "$target_port"
      done < "$rules"
      printf 'COMMIT\\n'
    } > "$generation"

    iptables-restore --test --noflush < "$generation"
    iptables-restore --noflush < "$generation"

    # Stable dispatchers are the only global hooks. Non-matching traffic returns
    # immediately to the operator-owned ruleset. They are created only after
    # the complete generation has passed iptables-restore's parser.
    iptables -w -t nat -N "$DNAT" 2>/dev/null || iptables -w -t nat -S "$DNAT" >/dev/null
    iptables -w -t nat -N "$SNAT" 2>/dev/null || iptables -w -t nat -S "$SNAT" >/dev/null
    iptables -w -N "$FWD" 2>/dev/null || iptables -w -S "$FWD" >/dev/null
    iptables -w -t nat -C PREROUTING -j "$DNAT" 2>/dev/null || iptables -w -t nat -I PREROUTING 1 -j "$DNAT"
    iptables -w -t nat -C POSTROUTING -j "$SNAT" 2>/dev/null || iptables -w -t nat -I POSTROUTING 1 -j "$SNAT"
    iptables -w -C FORWARD -j "$FWD" 2>/dev/null || iptables -w -I FORWARD 1 -j "$FWD"

    {
      # With --noflush, declaring a user chain flushes/rebuilds only that chain;
      # all operator-owned and built-in chains remain untouched.
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

    [ "$enable_forward" = 0 ] || sysctl -w net.ipv4.ip_forward=1 >/dev/null
    swap_started=1
    iptables-restore --noflush < "$swap"
    iptables_hash="$(managed_iptables_hash "$revision")"
    valid_hash "$iptables_hash" || { printf 'could not verify applied generation\\n' >&2; exit 6; }
    printf 'REVISION\\t%s\\nHASH\\t%s\\nCOUNT\\t%s\\nIPTABLES_HASH\\t%s\\n' "$revision" "$wanted_hash" "$(wc -l < "$rules" | tr -d ' ')" "$iptables_hash" > "$state"
    chmod 0600 "$state" "$request"
    mv "$state" "$STATE_FILE"
    mv "$request" "$RULES_FILE"
    committed=1
    # Only names derived from the previously committed PolySIEM revision are
    # removed, and only after the new dispatchers and state are durable.
    if [ "$old_revision" -gt 0 ] && [ "$old_revision" -ne "$revision" ]; then
      iptables -w -t nat -F "$old_d" 2>/dev/null && iptables -w -t nat -X "$old_d" 2>/dev/null || true
      iptables -w -t nat -F "$old_s" 2>/dev/null && iptables -w -t nat -X "$old_s" 2>/dev/null || true
      iptables -w -F "$old_f" 2>/dev/null && iptables -w -X "$old_f" 2>/dev/null || true
    fi
    printf 'APPLIED\\t%s\\t%s\\t%s\\n' "$(wc -l < "$rules" | tr -d ' ')" "$revision" "$wanted_hash"
    ;;
  *) exit 2 ;;
esac
`;

export function restrictedAuthorizedKey(publicKey: string): string {
  return `restrict,command="sudo -n ${EDGE_AGENT_PATH}" ${publicKey}`;
}

export function buildEdgeAgentInstallScript(publicKey: string, username = "polysiem-edge"): string {
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(username) || username === "root") throw new Error("Invalid service username");
  const authorizedKey = restrictedAuthorizedKey(publicKey);
  return `#!/bin/sh
set -eu
[ "$(id -u)" -eq 0 ] || { printf 'Run this installer as root.\\n' >&2; exit 1; }
for binary in useradd getent install sudo visudo iptables iptables-restore ip awk grep sed cut mktemp sysctl flock sha256sum chmod mv rm wc tr; do
  command -v "$binary" >/dev/null 2>&1 || { printf 'Missing required command: %s\\nInstall sudo, iproute2, iptables, util-linux, and coreutils first.\\n' "$binary" >&2; exit 1; }
done
USER_NAME='${username}'
if id "$USER_NAME" >/dev/null 2>&1; then
  existing_home="$(getent passwd "$USER_NAME" | cut -d: -f6)"
  [ "$existing_home" = "/home/$USER_NAME" ] || { printf 'Existing %s account has an unexpected home directory; refusing to reuse it.\\n' "$USER_NAME" >&2; exit 1; }
else
  useradd --create-home --user-group --shell /bin/sh "$USER_NAME"
fi
install -d -m 0755 /usr/local/libexec
cat > ${EDGE_AGENT_PATH}.new <<'POLYSIEM_AGENT'
${EDGE_AGENT_SCRIPT}POLYSIEM_AGENT
chown root:root ${EDGE_AGENT_PATH}.new
chmod 0755 ${EDGE_AGENT_PATH}.new
mv ${EDGE_AGENT_PATH}.new ${EDGE_AGENT_PATH}
install -d -m 0700 -o "$USER_NAME" -g "$USER_NAME" "/home/$USER_NAME/.ssh"
cat > "/home/$USER_NAME/.ssh/authorized_keys.new" <<'POLYSIEM_KEY'
${authorizedKey}
POLYSIEM_KEY
chown "$USER_NAME:$USER_NAME" "/home/$USER_NAME/.ssh/authorized_keys.new"
chmod 0600 "/home/$USER_NAME/.ssh/authorized_keys.new"
mv "/home/$USER_NAME/.ssh/authorized_keys.new" "/home/$USER_NAME/.ssh/authorized_keys"
printf '%s ALL=(root) NOPASSWD: ${EDGE_AGENT_PATH} ""\\n' "$USER_NAME" > /etc/sudoers.d/polysiem-edge.new
chmod 0440 /etc/sudoers.d/polysiem-edge.new
visudo -cf /etc/sudoers.d/polysiem-edge.new >/dev/null
mv /etc/sudoers.d/polysiem-edge.new /etc/sudoers.d/polysiem-edge
install -d -m 0700 /etc/polysiem-edge
if command -v systemctl >/dev/null 2>&1; then
  cat > /etc/systemd/system/polysiem-edge-nat.service <<'POLYSIEM_UNIT'
[Unit]
Description=Restore PolySIEM Edge NAT rules
After=network-online.target tailscaled.service
Wants=network-online.target
ConditionPathExists=/etc/polysiem-edge/rules
StartLimitIntervalSec=0

[Service]
Type=oneshot
ExecStart=/bin/sh -c '/usr/local/libexec/polysiem-edge-agent < /etc/polysiem-edge/rules'
RemainAfterExit=yes
Restart=on-failure
RestartSec=5s
TimeoutStartSec=180

[Install]
WantedBy=multi-user.target
POLYSIEM_UNIT
  systemctl daemon-reload
  systemctl enable polysiem-edge-nat.service >/dev/null
fi
printf 'PolySIEM Edge NAT helper installed.\\n'
`;
}

export interface EdgeApplyRule {
  protocol: "tcp" | "udp";
  publicPort: number;
  targetAddress: string;
  targetPort: number;
  sourceCidr: string | null;
}

export interface EdgeApplyConfig {
  publicInterface: string;
  outboundInterface: string;
  enableIpForwarding: boolean;
  rules: EdgeApplyRule[];
}

export function canonicalEdgeRuleset(config: EdgeApplyConfig): string {
  const lines = [
    `CONFIG\t${config.publicInterface}\t${config.outboundInterface}\t${config.enableIpForwarding ? 1 : 0}`,
    ...config.rules.map(
      (rule) => `RULE\t${rule.protocol}\t${rule.publicPort}\t${rule.targetAddress}\t${rule.targetPort}\t${rule.sourceCidr ?? "-"}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export function desiredEdgeRulesetHash(config: EdgeApplyConfig): string {
  return createHash("sha256").update(canonicalEdgeRuleset(config), "utf8").digest("hex");
}

export function buildApplyProtocol(
  publicInterface: string,
  outboundInterface: string,
  enableIpForwarding: boolean,
  rules: EdgeApplyRule[],
  revision = 1,
): string {
  if (!Number.isInteger(revision) || revision < 1 || revision > 999_999_999) {
    throw new Error("Edge ruleset revision must be an integer between 1 and 999999999");
  }
  const config = { publicInterface, outboundInterface, enableIpForwarding, rules };
  const hash = desiredEdgeRulesetHash(config);
  const lines = ["APPLY", `META\t${revision}\t${hash}`, canonicalEdgeRuleset(config).trimEnd(), "END"];
  return `${lines.join("\n")}\n`;
}
