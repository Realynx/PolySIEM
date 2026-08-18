import { describe, expect, it } from "vitest";
import { CONNECTOR_AGENT_SCRIPT, CONNECTOR_AGENT_VERSION } from "./agent";
import {
  CONNECTOR_SERVICE_PATH,
  buildConnectorInstallCommand,
  buildConnectorInstallErrorScript,
  buildConnectorInstallScript,
  normalizeConnectorBaseUrl,
} from "./install";

const TOKEN = "pscx_0123456789abcdefghijklmnopqrstuvwxyzABCDEF";
const BASE = "https://polysiem.lan:3000";

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
