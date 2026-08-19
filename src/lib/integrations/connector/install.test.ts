import { describe, expect, it } from "vitest";
import {
  CONNECTOR_AGENT_SCRIPT,
  CONNECTOR_AGENT_VERSION,
  CONNECTOR_SSH_USERNAME,
  CONNECTOR_SUDOERS_PATH,
  connectorRestrictedAuthorizedKey,
} from "./agent";
import {
  CONNECTOR_SERVICE_PATH,
  buildConnectorInstallCommand,
  buildConnectorInstallErrorScript,
  buildConnectorInstallScript,
  normalizeConnectorBaseUrl,
  stripConnectorSshBlocks,
} from "./install";

const TOKEN = "pscx_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const BASE = "https://polysiem.lan:3000";
const SSH_PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ8k1nSDwqTGkPZm5OaXvXwB3tX9k7hcnU9y3kCTuXNL polysiem-connector";
const AUTHORIZED_KEY = connectorRestrictedAuthorizedKey(SSH_PUBKEY);

function build(overrides: Partial<Parameters<typeof buildConnectorInstallScript>[0]> = {}) {
  return buildConnectorInstallScript({ baseUrl: BASE, token: TOKEN, ...overrides });
}

describe("buildConnectorInstallScript input validation", () => {
  it("rejects anything that could escape the generated shell", () => {
    expect(() => build({ baseUrl: "https://polysiem.lan/$(reboot)" })).toThrow(/base URL/);
    expect(() => build({ baseUrl: "ftp://polysiem.lan" })).toThrow(/base URL/);
    expect(() => build({ baseUrl: "https://polysiem.lan'; reboot #" })).toThrow(/base URL/);
    expect(() => build({ token: "nope" })).toThrow(/install token/);
    expect(() => build({ token: "pscx_short" })).toThrow(/install token/);
    expect(() => build({ connectorId: "cx_1; reboot" })).toThrow(/connector id/);
    expect(() => build({ interfaceName: "wg0; reboot" })).toThrow(/interface name/);
    expect(() => build({ interfaceName: "averyveryverylonginterface" })).toThrow(/interface name/);
  });

  it("normalises the base URL so the agent can concatenate paths onto it", () => {
    expect(normalizeConnectorBaseUrl("https://polysiem.lan:3000/")).toBe(BASE);
    expect(normalizeConnectorBaseUrl("  https://polysiem.lan:3000///  ")).toBe(BASE);
    expect(build({ baseUrl: `${BASE}/` })).toContain(`BASE_URL='${BASE}'`);
  });
});

describe("buildConnectorInstallScript", () => {
  const script = build({ connectorId: "cx_h0mel4b" });

  it("is a root-only, strict POSIX sh installer", () => {
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("\nset -eu\n");
    expect(script).toContain('[ "$(id -u)" -eq 0 ]');
    expect(script).toContain("umask 077");
  });

  it("checks dependencies and installs them with apt or dnf", () => {
    expect(script).toContain("REQUIRED='wg ip iptables iptables-restore curl");
    expect(script).toContain("command -v apt-get");
    expect(script).toContain("apt-get install -y -qq wireguard-tools iproute2 iptables curl");
    expect(script).toContain("command -v dnf");
    expect(script).toContain("dnf install -y -q wireguard-tools iproute iptables curl");
    expect(script).toContain("No supported package manager");
    // Re-checked after the package install so a partial install fails loudly.
    expect(script).toContain("Missing required command after dependency install");
  });

  it("creates the 0700 config directory and writes config + token 0600", () => {
    expect(script).toContain("install -d -m 0700 \"$CONF_DIR\"");
    expect(script).toContain("CONF_DIR=/etc/polysiem-connector");
    expect(script).toContain('chmod 0600 "$CONF_DIR/config.new"');
    expect(script).toContain('mv "$CONF_DIR/config.new" "$CONF_DIR/config"');
    expect(script).toContain('chmod 0600 "$CONF_DIR/token.new"');
    expect(script).toContain('mv "$CONF_DIR/token.new" "$CONF_DIR/token"');
    expect(script).toContain("BASE_URL=$BASE_URL");
    expect(script).toContain("CONNECTOR_ID=$CONNECTOR_ID");
    expect(script).toContain("IFACE=$IFACE");
  });

  it("bakes in the caller's connector id and interface", () => {
    expect(script).toContain("CONNECTOR_ID='cx_h0mel4b'");
    expect(script).toContain("IFACE='wg0'");
    expect(build({ interfaceName: "psx0" })).toContain("IFACE='psx0'");
    expect(build()).toContain("CONNECTOR_ID=''");
  });

  it("never prints the token: the literal appears once, as the assignment", () => {
    expect(script.split(TOKEN)).toHaveLength(2);
    expect(script).toContain(`INSTALL_TOKEN='${TOKEN}'`);
    expect(script).toContain('printf \'%s\\n\' "$INSTALL_TOKEN" > "$CONF_DIR/token.new"');
    for (const line of script.split("\n")) {
      if (!line.includes("$INSTALL_TOKEN")) continue;
      expect(line).toContain("$CONF_DIR/token.new");
    }
  });

  it("embeds the agent verbatim and installs it 0755", () => {
    expect(script).toContain(CONNECTOR_AGENT_SCRIPT);
    expect(script).toContain("cat > \"$AGENT_PATH.new\" <<'POLYSIEM_CONNECTOR_AGENT'");
    expect(script).toContain('chmod 0755 "$AGENT_PATH.new"');
    expect(script).toContain('mv "$AGENT_PATH.new" "$AGENT_PATH"');
    expect(script).toContain("AGENT_PATH=/usr/local/libexec/polysiem-connector-agent");
  });

  it("installs a Type=simple, Restart=always unit that brings the tunnel up itself", () => {
    expect(script).not.toContain("wg-quick");
    expect(script).toContain(`SERVICE_PATH=${CONNECTOR_SERVICE_PATH}`);
    expect(CONNECTOR_SERVICE_PATH).toBe("/etc/systemd/system/polysiem-connector.service");
    expect(script).toContain("Type=simple");
    expect(script).toContain("ExecStart=/usr/local/libexec/polysiem-connector-agent run");
    expect(script).toContain("Restart=always");
    expect(script).toContain("WantedBy=multi-user.target");
    expect(script).toContain("After=network-online.target");
    expect(script).toContain("systemctl daemon-reload");
    expect(script).toContain('systemctl enable "$SERVICE_NAME"');
    expect(script).toContain('systemctl restart "$SERVICE_NAME"');
    expect(script).toContain("SERVICE_NAME=polysiem-connector.service");
  });

  it("is re-runnable: every artefact is written to .new and moved into place", () => {
    const moves = script.match(/^mv "?\$[A-Z_]+.*$/gm) ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(3);
    // enable + restart (not just start) so a re-run picks up a new agent build.
    expect(script).toContain("systemctl restart");
  });

  it("prints a clear success summary the operator can act on", () => {
    expect(script).toContain("PolySIEM connector installed.");
    expect(script).toContain(`(version ${CONNECTOR_AGENT_VERSION})`);
    expect(script).toContain("journalctl -u %s -f");
    expect(script).toContain("%s status");
    expect(script).toContain("show as connected in PolySIEM");
  });

  it("turns off TLS verification only when the operator asked for it", () => {
    expect(build({ insecure: true })).toContain("\nINSECURE=1\n");
    expect(script).toContain("\nINSECURE=0\n");
    expect(script).not.toContain("\nINSECURE=1\n");
    // The written config carries the flag; the agent turns it into curl's -k.
    expect(script).toContain("POLYSIEM_INSECURE=$INSECURE");
    expect(script).toContain('[ "$INSECURE" = 0 ] || CURL_INSECURE="-k"');
  });
});

describe("buildConnectorInstallScript SSH management (phase 2)", () => {
  const withKey = build({ connectorId: "cx_h0mel4b", authorizedKey: AUTHORIZED_KEY });
  const withoutKey = build({ connectorId: "cx_h0mel4b" });

  it("is purely additive: stripping the SSH blocks reproduces phase 1 byte for byte", () => {
    expect(stripConnectorSshBlocks(withKey)).toBe(withoutKey);
    expect(withKey.length).toBeGreaterThan(withoutKey.length);
  });

  it("does nothing SSH-related when no authorizedKey is supplied (no regression)", () => {
    for (const absent of ["useradd", "authorized_keys", "sudoers", "visudo", "getent", "SSH_USER"]) {
      expect(withoutKey).not.toContain(absent);
    }
    expect(withoutKey).not.toContain(`SSH_USER='${CONNECTOR_SSH_USERNAME}'`);
    expect(withoutKey).not.toContain(SSH_PUBKEY);
    expect(withoutKey).not.toContain("restrict,command=");
    // Both the empty-string and undefined forms take the phase-1 path.
    expect(build({ connectorId: "cx_h0mel4b", authorizedKey: "" })).toBe(withoutKey);
  });

  it("creates the polysiem-connector account with the edge installer's safety check", () => {
    expect(withKey).toContain(`SSH_USER='${CONNECTOR_SSH_USERNAME}'`);
    expect(withKey).toContain('if id "$SSH_USER" >/dev/null 2>&1; then');
    expect(withKey).toContain('existing_home="$(getent passwd "$SSH_USER" | cut -d: -f6)"');
    expect(withKey).toContain('[ "$existing_home" = "/home/$SSH_USER" ] ||');
    expect(withKey).toContain("refusing to reuse it");
    expect(withKey).toContain('useradd --create-home --user-group --shell /bin/sh "$SSH_USER"');
    expect(withKey).toContain("for binary in useradd getent chown cut sudo visudo; do");
    expect(build({ authorizedKey: AUTHORIZED_KEY, sshUsername: "psx-agent" })).toContain("SSH_USER='psx-agent'");
  });

  it("installs the forced-command authorized_keys line at 0600 in a 0700 .ssh", () => {
    expect(withKey).toContain('install -d -m 0700 -o "$SSH_USER" -g "$SSH_USER" "/home/$SSH_USER/.ssh"');
    expect(withKey).toContain("cat > \"/home/$SSH_USER/.ssh/authorized_keys.new\" <<'POLYSIEM_CONNECTOR_KEY'");
    expect(withKey).toContain(`\n${AUTHORIZED_KEY}\nPOLYSIEM_CONNECTOR_KEY\n`);
    expect(withKey).toContain('chown "$SSH_USER:$SSH_USER" "/home/$SSH_USER/.ssh/authorized_keys.new"');
    expect(withKey).toContain('chmod 0600 "/home/$SSH_USER/.ssh/authorized_keys.new"');
    expect(withKey).toContain(
      'mv "/home/$SSH_USER/.ssh/authorized_keys.new" "/home/$SSH_USER/.ssh/authorized_keys"',
    );
    // The key is pinned to the agent and nothing else.
    expect(AUTHORIZED_KEY).toBe(
      `restrict,command="sudo -n /usr/local/libexec/polysiem-connector-agent" ${SSH_PUBKEY}`,
    );
    // A quoted heredoc, so the shell cannot expand anything inside the key line.
    expect(withKey).not.toContain("<<POLYSIEM_CONNECTOR_KEY");
  });

  it("writes a visudo-validated sudoers drop-in scoped to the agent path only", () => {
    expect(CONNECTOR_SUDOERS_PATH).toBe("/etc/sudoers.d/polysiem-connector");
    expect(withKey).toContain(
      `printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/polysiem-connector-agent ""\\n' "$SSH_USER" > ${CONNECTOR_SUDOERS_PATH}.new`,
    );
    expect(withKey).toContain(`chmod 0440 ${CONNECTOR_SUDOERS_PATH}.new`);
    expect(withKey).toContain(`visudo -cf ${CONNECTOR_SUDOERS_PATH}.new >/dev/null`);
    expect(withKey).toContain(`mv ${CONNECTOR_SUDOERS_PATH}.new ${CONNECTOR_SUDOERS_PATH}`);
    // Validation happens before the file becomes live, never after.
    expect(withKey.indexOf(`visudo -cf ${CONNECTOR_SUDOERS_PATH}.new`)).toBeLessThan(
      withKey.indexOf(`mv ${CONNECTOR_SUDOERS_PATH}.new ${CONNECTOR_SUDOERS_PATH}`),
    );
    expect(withKey).not.toContain("NOPASSWD: ALL");
  });

  it("still does everything phase 1 did, and provisions before the unit starts", () => {
    expect(withKey).toContain(CONNECTOR_AGENT_SCRIPT);
    expect(withKey).toContain('mv "$CONF_DIR/token.new" "$CONF_DIR/token"');
    expect(withKey).toContain("Type=simple");
    expect(withKey).toContain('systemctl enable "$SERVICE_NAME"');
    expect(withKey.indexOf("useradd --create-home")).toBeGreaterThan(withKey.indexOf('mv "$AGENT_PATH.new"'));
    expect(withKey.indexOf("useradd --create-home")).toBeLessThan(withKey.indexOf("systemctl daemon-reload"));
  });

  it("tells the operator what was provisioned and what it can do", () => {
    expect(withKey).toContain("restricted key; it can only run the agent");
    expect(withKey).toContain(`${CONNECTOR_SUDOERS_PATH} (NOPASSWD on the agent path only)`);
    expect(withKey).toContain("PolySIEM connector installed.");
  });

  it("rejects an authorized_keys line or username that could escape the script", () => {
    expect(() => build({ authorizedKey: "definitely not a key" })).toThrow(/authorized_keys/);
    expect(() => build({ authorizedKey: `${AUTHORIZED_KEY}\nPOLYSIEM_CONNECTOR_KEY\nrm -rf /` })).toThrow(
      /authorized_keys/,
    );
    expect(() => build({ authorizedKey: `${AUTHORIZED_KEY}\ncommand="sh" ssh-ed25519 AAAA` })).toThrow(
      /authorized_keys/,
    );
    expect(() => build({ authorizedKey: AUTHORIZED_KEY, sshUsername: "root" })).toThrow(/SSH username/);
    expect(() => build({ authorizedKey: AUTHORIZED_KEY, sshUsername: "bad name; reboot" })).toThrow(/SSH username/);
    expect(() => build({ authorizedKey: AUTHORIZED_KEY, sshUsername: "Capital" })).toThrow(/SSH username/);
  });

  it("never embeds private key material", () => {
    expect(withKey).not.toContain("PRIVATE KEY");
    expect(withKey).not.toContain("BEGIN OPENSSH");
    // Nothing in the installer carries a key value: the SSH half installs only a
    // PUBLIC key, and the WireGuard key is generated by the agent on this host.
    expect(withKey.match(/AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+/g) ?? []).toHaveLength(1);
    expect(withKey).toContain('( umask 077; wg genkey > "$KEY_FILE.new" )');
  });
});

describe("buildConnectorInstallCommand", () => {
  it("produces the copy-paste one-liner with the token in the URL", () => {
    expect(buildConnectorInstallCommand({ baseUrl: `${BASE}/`, token: TOKEN })).toBe(
      `curl -fsSL "${BASE}/api/network/connectors/install.sh?token=${TOKEN}" | sudo sh`,
    );
  });

  it("adds curl -k only when insecure was requested", () => {
    const insecure = buildConnectorInstallCommand({ baseUrl: BASE, token: TOKEN, insecure: true });
    const secure = buildConnectorInstallCommand({ baseUrl: BASE, token: TOKEN });
    expect(insecure).toContain("curl -fsSL -k ");
    expect(secure).not.toContain("-k");
  });

  it("validates its inputs the same way the script builder does", () => {
    expect(() => buildConnectorInstallCommand({ baseUrl: "not a url", token: TOKEN })).toThrow(/base URL/);
    expect(() => buildConnectorInstallCommand({ baseUrl: BASE, token: "bad" })).toThrow(/install token/);
  });
});

describe("buildConnectorInstallErrorScript", () => {
  it("fails loudly without leaking whether the token ever existed", () => {
    const script = buildConnectorInstallErrorScript();
    expect(script.startsWith("#!/bin/sh\n")).toBe(true);
    expect(script).toContain("invalid or expired install token");
    expect(script.trimEnd().endsWith("exit 1")).toBe(true);
    expect(script).toContain(">&2");
  });

  it("strips quotes and shell metacharacters out of the message", () => {
    const script = buildConnectorInstallErrorScript("bad '; reboot; ' $(whoami) `id`");
    expect(script).not.toContain("'; reboot");
    expect(script).not.toContain("$(whoami)");
    expect(script).not.toContain("`id`");
    const messageLine = script.split("\n").find((line) => line.includes("connector installer:"));
    // Exactly two single-quoted arguments: the format string and the message.
    expect(messageLine?.split("'")).toHaveLength(5);
  });
});
