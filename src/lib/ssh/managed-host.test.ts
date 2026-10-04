import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { userInfo } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateEd25519Keypair } from "@/lib/ssh/keys";
import {
  currentWindowsTrustee,
  ManagedSshError,
  ManagedSshHostKeyScanError,
  ManagedSshLocalKeyError,
  isSshPort,
  managedSshErrorStatus,
  parseSshUrl,
  restrictedAuthorizedKey,
  runManagedSsh,
  scanSshHostKeys,
  sshBaseUrlSchema,
  sshEndpointMoved,
  sshHostKeyFingerprintSchema,
  sshHostSchema,
  sshPortSchema,
  sshUsernameSchema,
  SSH_DEFAULT_PORT,
  type CommandResult,
  type CommandRunner,
  type IdentityFileGuard,
  type ManagedSshTarget,
} from "./managed-host";

const hostPair = generateEd25519Keypair("managed-host");
const clientPair = generateEd25519Keypair("polysiem");
const hostLine = `[box.lan]:2222 ${hostPair.publicKeyLine}`;

function target(overrides: Partial<ManagedSshTarget> = {}): ManagedSshTarget {
  return {
    host: "box.lan",
    port: 2222,
    username: "polysiem-agent",
    hostKeyFingerprint: hostPair.fingerprint,
    privateKey: clientPair.privateKeyPem,
    ...overrides,
  };
}

/** A runner that answers the scan, then hands the ssh invocation to `onSsh`. */
function scanThen(
  onSsh: (args: string[], input: string | undefined, timeoutMs: number | undefined) => Promise<void> | void,
): CommandRunner {
  return async (command, args, input, timeoutMs) => {
    if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
    await onSsh(args, input, timeoutMs);
    return { stdout: "OK\n", stderr: "", code: 0 };
  };
}

describe("runManagedSsh", () => {
  it("puts the exact OpenSSH flag list on the command line", async () => {
    let received: string[] = [];
    await runManagedSsh(target(), { remoteCommand: "polysiem-edge-agent", stdin: "STATUS\n", timeoutMs: 30_000 },
      scanThen((args) => { received = args; }));

    const identity = received[received.indexOf("-i") + 1];
    const knownHosts = received
      .find((arg) => arg.startsWith("UserKnownHostsFile="))!
      .slice("UserKnownHostsFile=".length);
    expect(received).toEqual([
      "-T", "-p", "2222", "-i", identity,
      "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=yes",
      "-o", `UserKnownHostsFile=${knownHosts}`, "-o", "GlobalKnownHostsFile=none",
      "-o", "ConnectTimeout=10", "polysiem-agent@box.lan", "polysiem-edge-agent",
    ]);
    // `accept-new` would defeat the whole pinning model.
    expect(received).not.toContain("StrictHostKeyChecking=accept-new");
  });

  it("pins known_hosts to exactly the one matched line and removes the directory afterwards", async () => {
    let identity = "";
    let pinned = "";
    await runManagedSsh(target(), { remoteCommand: "agent", stdin: "STATUS\n", timeoutMs: 30_000 },
      scanThen(async (args) => {
        identity = args[args.indexOf("-i") + 1];
        expect(existsSync(identity)).toBe(true);
        const knownHostsPath = args.find((arg) => arg.startsWith("UserKnownHostsFile="))!
          .slice("UserKnownHostsFile=".length);
        pinned = await readFile(knownHostsPath, "utf8");
      }));

    expect(pinned).toBe(`${hostLine}\n`);
    expect(existsSync(identity)).toBe(false);
  });

  it("removes the temp directory even when the session throws", async () => {
    let identity = "";
    const runner: CommandRunner = async (command, args) => {
      if (command === "ssh-keyscan") return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
      identity = args[args.indexOf("-i") + 1];
      throw new Error("ssh exploded");
    };
    await expect(runManagedSsh(target(), { remoteCommand: "agent", timeoutMs: 30_000 }, runner))
      .rejects.toThrow("ssh exploded");
    expect(identity).not.toBe("");
    expect(existsSync(identity)).toBe(false);
  });

  it("rescans and matches the pinned fingerprint BEFORE any credential reaches disk", async () => {
    const commands: string[] = [];
    const runner: CommandRunner = async (command) => {
      commands.push(command);
      return { stdout: `${hostLine}\n`, stderr: "", code: 0 };
    };
    await expect(runManagedSsh(
      target({ hostKeyFingerprint: "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }),
      { remoteCommand: "agent", timeoutMs: 30_000 },
      runner,
    )).rejects.toMatchObject({ code: "ssh_host_key_mismatch", status: 409 });
    // ssh was never invoked, so no identity file was ever written.
    expect(commands).toEqual(["ssh-keyscan"]);
  });

  it("lets the caller word the mismatch for its own operator surface", async () => {
    class Refused extends Error {}
    await expect(runManagedSsh(
      target({ hostKeyFingerprint: "SHA256:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" }),
      { remoteCommand: "agent", timeoutMs: 30_000, hostKeyMismatchError: () => new Refused("installation refused") },
      async () => ({ stdout: `${hostLine}\n`, stderr: "", code: 0 }),
    )).rejects.toBeInstanceOf(Refused);
  });

  it("carries the two custody modes as arguments, not as two functions", async () => {
    const seen: Array<{ remote: string; timeout: number | undefined; stdin: string | undefined }> = [];
    const record = scanThen((args, input, timeoutMs) => {
      seen.push({ remote: args.at(-1)!, timeout: timeoutMs, stdin: input });
    });

    // Operational: the restricted key, the agent's forced command, 30s.
    await runManagedSsh(target(), { remoteCommand: "polysiem-connector-agent", stdin: "STATUS\n", timeoutMs: 30_000 }, record);
    // Bootstrap: the operator's temporary admin account, the installer, 300s.
    await runManagedSsh(target({ username: "ubuntu" }),
      { remoteCommand: "polysiem-edge-bootstrap", stdin: "#!/bin/sh\n", timeoutMs: 300_000 }, record);

    expect(seen).toEqual([
      { remote: "polysiem-connector-agent", timeout: 30_000, stdin: "STATUS\n" },
      { remote: "polysiem-edge-bootstrap", timeout: 300_000, stdin: "#!/bin/sh\n" },
    ]);
  });

  it("takes the runner as its last parameter so no test needs a real sshd", async () => {
    // The default is the real spawner; every caller keeps the same seam.
    expect(runManagedSsh.length).toBe(2);
  });
});

/**
 * The transient identity file.
 *
 * Windows does not implement POSIX modes, so the 0600 the write asks for is
 * silently nothing there: the file inherits `%TEMP%`'s ACL, OpenSSH refuses to
 * offer a private key any other principal can reach, and the session falls
 * through to "Permission denied (publickey,password)" — a remote rejection's
 * words for a failure that never left this machine.
 *
 * The guard seam is the local counterpart of the runner seam: it is what lets
 * Linux CI cover the Windows path, and either platform cover the failure path
 * without breaking a real ACL.
 */
describe("transient identity file permissions", () => {
  const SID = "*S-1-5-21-1417340086-685909767-2827404582-1001";
  const ICACLS_OK: CommandResult = { stdout: "Successfully processed 1 files; Failed processing 0 files", stderr: "", code: 0 };

  /** ssh-keyscan answers; ssh replies with whatever this session should see. */
  function sshReplies(reply: Partial<CommandResult>): CommandRunner {
    return async (command) => command === "ssh-keyscan"
      ? { stdout: `${hostLine}\n`, stderr: "", code: 0 }
      : { stdout: "", stderr: "", code: 0, ...reply };
  }

  /** The Windows OpenSSH client refusing the key file PolySIEM just wrote. */
  const REFUSED_BY_LOCAL_CLIENT = [
    "Bad permissions. Try removing permissions for user: DESKTOP-K7IOM78\\CodexSandboxUsers (S-1-5-21-1-2-3-1003)"
    + " on file C:/Users/poofi/AppData/Local/Temp/polysiem-vpn-provision-6jvWt6/identity",
    "WARNING: UNPROTECTED PRIVATE KEY FILE!",
    "Permissions for 'C:\\Users\\poofi\\AppData\\Local\\Temp\\polysiem-vpn-provision-6jvWt6\\identity' are too open.",
    'Load key "C:\\Users\\poofi\\AppData\\Local\\Temp\\polysiem-vpn-provision-6jvWt6\\identity": bad permissions',
    "root@10.0.3.70: Permission denied (publickey,password).",
  ].join("\n");

  it("tightens the directory's ACL BEFORE the key lands, then the key's own", async () => {
    const calls: Array<{ command: string; args: string[]; keyOnDisk: boolean }> = [];
    let identity = "";
    const guard: Partial<IdentityFileGuard> = {
      platform: "win32",
      trustee: async () => SID,
      run: async (command, args) => {
        const dir = args[0].endsWith("identity") ? dirname(args[0]) : args[0];
        calls.push({ command, args, keyOnDisk: existsSync(join(dir, "identity")) });
        return ICACLS_OK;
      },
    };

    await runManagedSsh(target(), { remoteCommand: "agent", timeoutMs: 30_000, identityFileGuard: guard },
      scanThen((args) => { identity = args[args.indexOf("-i") + 1]; }));

    expect(calls).toHaveLength(2);
    // Absolute System32 path: a POSIX `whoami`/`icacls` earlier on PATH, or a
    // writable PATH entry, must not get to choose what secures a private key.
    expect(calls.every((call) => /[\\/]System32[\\/]icacls\.exe$/.test(call.command))).toBe(true);
    // The directory is locked down while the key is still unwritten, so the key
    // never exists on disk under the temp directory's inherited ACL.
    expect(calls[0].keyOnDisk).toBe(false);
    expect(calls[0].args).toEqual([dirname(identity), "/inheritance:r", "/grant:r", `${SID}:(OI)(CI)F`]);
    expect(calls[1].keyOnDisk).toBe(true);
    expect(calls[1].args).toEqual([identity, "/inheritance:r", "/grant:r", `${SID}:F`]);
  });

  it("fails loudly, before ssh runs, when the ACL cannot be tightened", async () => {
    const failures: CommandResult[] = [
      { stdout: "", stderr: "identity: Access is denied.", code: 5 },
      // icacls reports a per-path failure in stdout and can still exit 0.
      { stdout: "Successfully processed 0 files; Failed processing 1 files", stderr: "", code: 0 },
    ];
    for (const failure of failures) {
      const sshRuns: string[] = [];
      let dir = "";
      const attempt = runManagedSsh(target(), {
        remoteCommand: "agent",
        timeoutMs: 30_000,
        identityFileGuard: {
          platform: "win32",
          trustee: async () => SID,
          run: async (_command, args) => { dir = args[0]; return failure; },
        },
      }, scanThen((args) => { sshRuns.push(args.join(" ")); }));

      await expect(attempt).rejects.toMatchObject({ code: "ssh_identity_file_unsecured", status: 500 });
      await expect(attempt).rejects.toThrow(/could not restrict the permissions of the temporary SSH key file/);
      // Nothing was offered to anybody, and nothing was left behind.
      expect(sshRuns).toEqual([]);
      expect(dir).not.toBe("");
      expect(existsSync(dir)).toBe(false);
    }
  });

  it("fails loudly when the account to grant cannot be identified", async () => {
    await expect(runManagedSsh(target(), {
      remoteCommand: "agent",
      timeoutMs: 30_000,
      identityFileGuard: {
        platform: "win32",
        trustee: async () => { throw new ManagedSshError("ssh_identity_file_unsecured", "no token", 500); },
        run: async () => ICACLS_OK,
      },
    }, scanThen(() => { throw new Error("ssh must not run"); })))
      .rejects.toMatchObject({ code: "ssh_identity_file_unsecured" });
  });

  it("runs no ACL tool at all off Windows", async () => {
    let shelled = 0;
    let identity = "";
    await runManagedSsh(target(), {
      remoteCommand: "agent",
      timeoutMs: 30_000,
      identityFileGuard: {
        platform: "linux",
        run: async () => { shelled += 1; return ICACLS_OK; },
        trustee: async () => { throw new Error("no trustee is needed off Windows"); },
      },
    }, scanThen((args) => { identity = args[args.indexOf("-i") + 1]; }));

    expect(shelled).toBe(0);
    expect(identity).not.toBe("");
  });

  it.skipIf(process.platform === "win32")("still writes the identity 0600 on POSIX", async () => {
    let mode = 0;
    await runManagedSsh(target(), { remoteCommand: "agent", timeoutMs: 30_000 },
      scanThen((args) => { mode = statSync(args[args.indexOf("-i") + 1]).mode & 0o777; }));
    expect(mode).toBe(0o600);
  });

  it("blames PolySIEM's own key file, not the remote host, when the local client refuses it", async () => {
    const failed = await runManagedSsh(
      target(),
      { remoteCommand: "agent", timeoutMs: 30_000 },
      sshReplies({ stderr: REFUSED_BY_LOCAL_CLIENT, code: 255 }),
    ).catch((error: unknown) => error);

    expect(failed).toMatchObject({ code: "ssh_identity_file_rejected", status: 500 });
    const message = (failed as Error).message;
    expect(message).toContain("The SSH client on the PolySIEM server");
    expect(message).toContain("never offered it to box.lan:2222");
    // The whole point: this must not send anyone to the remote box.
    expect(message).toContain("not a remote authorization problem");
    expect(message).toContain("authorized_keys is not involved");
  });

  it("leaves a genuine remote rejection saying exactly what it said", async () => {
    const remote = "polysiem-agent@box.lan: Permission denied (publickey,password).";
    const result = await runManagedSsh(target(), { remoteCommand: "agent", timeoutMs: 30_000 },
      sshReplies({ stderr: remote, code: 255 }));
    expect(result).toMatchObject({ code: 255, stderr: remote });
  });

  it("does not reclassify a session that succeeded", async () => {
    const result = await runManagedSsh(target(), { remoteCommand: "agent", timeoutMs: 30_000 },
      sshReplies({ stdout: "OK\n", stderr: "the agent mentioned bad permissions on /etc/wireguard", code: 0 }));
    expect(result.stdout).toBe("OK\n");
  });
});

describe("currentWindowsTrustee", () => {
  it("asks the access token for its SID instead of trusting %USERNAME%", async () => {
    const asked: Array<{ command: string; args: string[] }> = [];
    const trustee = await currentWindowsTrustee(async (command, args) => {
      asked.push({ command, args });
      return { stdout: '"DESKTOP-K7IOM78\\poofi","S-1-5-21-1417340086-685909767-2827404582-1001"\r\n', stderr: "", code: 0 };
    });

    expect(trustee).toBe("*S-1-5-21-1417340086-685909767-2827404582-1001");
    expect(/[\\/]System32[\\/]whoami\.exe$/.test(asked[0].command)).toBe(true);
    expect(asked[0].args).toEqual(["/user", "/fo", "csv", "/nh"]);
  });

  it("falls back to this account's name when the token cannot be read", async () => {
    for (const unreadable of [
      async () => { throw new Error("whoami.exe is missing"); },
      async () => ({ stdout: "", stderr: "denied", code: 1 }),
      // Anything that is not a SID is not granted anything.
      async () => ({ stdout: '"host\\user","Everyone"\r\n', stderr: "", code: 0 }),
    ] satisfies CommandRunner[]) {
      await expect(currentWindowsTrustee(unreadable)).resolves.toBe(userInfo().username);
    }
  });
});

describe("managed SSH errors", () => {
  it("maps a scan failure to 502 and a not-ready row to whatever the subclass fixes", () => {
    expect(managedSshErrorStatus(new ManagedSshHostKeyScanError("ssh_host_unreachable", "nope"))).toBe(502);
    expect(managedSshErrorStatus(new ManagedSshHostKeyScanError("ssh_host_no_response", "nope"))).toBe(502);
    expect(managedSshErrorStatus(new ManagedSshError("custom", "nope", 409))).toBe(409);
    expect(managedSshErrorStatus(new Error("unrelated"))).toBeNull();
  });

  it("maps our own key file's failures to 500, because nothing upstream is broken", () => {
    // 502 would say "the host is at fault" about a file on this machine.
    expect(managedSshErrorStatus(new ManagedSshLocalKeyError("ssh_identity_file_unsecured", "nope"))).toBe(500);
    expect(managedSshErrorStatus(new ManagedSshLocalKeyError("ssh_identity_file_rejected", "nope"))).toBe(500);
    expect(new ManagedSshLocalKeyError("ssh_identity_file_rejected", "nope")).toBeInstanceOf(ManagedSshError);
  });
});

/**
 * A runner whose ssh-keyscan and ssh replies are both scripted. The silent
 * variants are the real behaviour against a firewalled box: OpenSSH's scanner
 * exits non-zero having written nothing to either stream.
 */
function scanner(keyscan: Partial<CommandResult>, ssh: Partial<CommandResult> | Error): CommandRunner {
  const filled = (result: Partial<CommandResult>): CommandResult =>
    ({ stdout: "", stderr: "", code: 1, ...result });
  return async (command) => {
    if (command === "ssh-keyscan") return filled(keyscan);
    if (ssh instanceof Error) throw ssh;
    return filled(ssh);
  };
}

describe("scanSshHostKeys diagnosis", () => {
  const scan = (runner: CommandRunner) => scanSshHostKeys("box.lan", 2222, runner);

  it("reports nothing-answered when the scanner AND the handshake are both silent", async () => {
    // The failure that started this: ssh-keyscan exits non-zero with empty
    // stdout AND empty stderr, so there is no substring to classify at all.
    await expect(scan(scanner({}, {}))).rejects.toMatchObject({
      code: "ssh_host_no_response",
      status: 502,
      message: "Nothing answered at box.lan:2222 within 7 seconds — no SSH banner, and no connection error either."
        + " SSH from your own machine does not verify access from the PolySIEM container or service account;"
        + " check that the address and SSH port are right and that the host is reachable from wherever PolySIEM runs.",
    });
  });

  it("still reports nothing-answered when the handshake dies without a word", async () => {
    await expect(scan(scanner({}, new Error("ssh timed out")))).rejects.toMatchObject({
      code: "ssh_host_no_response",
    });
  });

  it("keeps the sshd-configuration message for a host that DID answer", async () => {
    // A banner, an unsupported algorithm, anything: something is listening, so
    // sshd's configuration is a sensible next place to look.
    await expect(scan(scanner({ stdout: "# box.lan:2222 SSH-2.0-OpenSSH_9.6\n", code: 0 }, {})))
      .rejects.toMatchObject({
        code: "ssh_host_key_unavailable",
        message: "No supported SSH host key was returned by box.lan:2222. Check the address, SSH port, firewall, and sshd configuration.",
      });
  });

  it("reads the connect failure off the handshake when the scanner says nothing", async () => {
    for (const [stderr, code] of [
      ["ssh: connect to host box.lan port 2222: Connection refused", "ssh_host_unreachable"],
      ["ssh: connect to host box.lan port 2222: No route to host", "ssh_host_unreachable"],
      ["ssh: Could not resolve hostname box.lan: Name or service not known", "ssh_host_unreachable"],
      ["ssh: connect to host box.lan port 2222: Connection timed out", "ssh_host_no_response"],
      ["ssh: connect to host box.lan port 2222: Permission denied", "ssh_runtime_network_denied"],
    ] as const) {
      await expect(scan(scanner({}, { stderr }))).rejects.toMatchObject({ code });
    }
  });

  it("does not mistake the handshake's own authentication denial for a blocked socket", async () => {
    // The handshake offers no credentials on purpose, so "Permission denied
    // (publickey)" is the EXPECTED reply from a host that answered fine.
    await expect(scan(scanner({}, { stderr: "polysiem-host-key-scan@box.lan: Permission denied (publickey).", code: 255 })))
      .rejects.toMatchObject({ code: "ssh_host_key_unavailable" });
  });

  it("lets the scanner's own diagnostic win over the handshake's", async () => {
    await expect(scan(scanner({ stderr: "connect (`box.lan'): Connection refused" }, { stderr: "kex_exchange_identification: read: Connection reset" })))
      .rejects.toMatchObject({
        code: "ssh_host_unreachable",
        message: "The SSH service at box.lan:2222 refused the connection. Check the SSH port and that sshd is running.",
      });
  });

  it("keeps the runner as its last parameter so no test needs a real sshd", () => {
    expect(scanSshHostKeys.length).toBe(2);
  });
});

describe("restrictedAuthorizedKey", () => {
  const key = clientPair.publicKeyLine;

  it("renders one forced command with no channel features", () => {
    expect(restrictedAuthorizedKey({ publicKeyLine: key, agentPath: "/usr/local/libexec/polysiem-edge-agent" }))
      .toBe(`restrict,command="sudo -n /usr/local/libexec/polysiem-edge-agent" ${key}`);
  });

  it("refuses anything that could break out of the authorized_keys line", () => {
    expect(() => restrictedAuthorizedKey({ publicKeyLine: "not-a-key", agentPath: "/opt/agent" }))
      .toThrow(/public key/);
    expect(() => restrictedAuthorizedKey({ publicKeyLine: `${key}"\ncommand="sh"`, agentPath: "/opt/agent" }))
      .toThrow(/public key/);
    expect(() => restrictedAuthorizedKey({ publicKeyLine: "-----BEGIN OPENSSH PRIVATE KEY-----", agentPath: "/opt/agent" }))
      .toThrow(/public key/);
    expect(() => restrictedAuthorizedKey({ publicKeyLine: key, agentPath: "relative/path" }))
      .toThrow(/agent path/);
    expect(() => restrictedAuthorizedKey({ publicKeyLine: key, agentPath: '/bin/sh" ; reboot #' }))
      .toThrow(/agent path/);
  });
});

describe("managed host schemas", () => {
  it("has one port range", () => {
    expect(SSH_DEFAULT_PORT).toBe(22);
    expect(sshPortSchema.safeParse(22).success).toBe(true);
    expect(sshPortSchema.safeParse(65535).success).toBe(true);
    for (const bad of [0, -1, 65536, 22.5]) expect(sshPortSchema.safeParse(bad).success).toBe(false);
    expect(isSshPort(22)).toBe(true);
    expect(isSshPort("22")).toBe(false);
    expect(isSshPort(0)).toBe(false);
  });

  it("accepts a hostname or an IP literal and nothing else", () => {
    for (const good of ["connector.lan", "10.0.3.42", "2001:db8::10", "edge.example.test"]) {
      expect(sshHostSchema.safeParse(good).success).toBe(true);
    }
    for (const bad of ["", "  ", "not a host", "-leading.dash"]) {
      expect(sshHostSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("accepts a Linux service account name and a SHA256 fingerprint", () => {
    expect(sshUsernameSchema.safeParse("polysiem-connector").success).toBe(true);
    expect(sshUsernameSchema.safeParse("Root Account").success).toBe(false);
    expect(sshHostKeyFingerprintSchema.safeParse("SHA256:abc").success).toBe(true);
    expect(sshHostKeyFingerprintSchema.safeParse("MD5:abc").success).toBe(false);
  });

  it.each([
    ["ssh://edge.example.test", "edge.example.test", 22],
    ["ssh://192.0.2.10:2200", "192.0.2.10", 2200],
    // WHATWG keeps the brackets; OpenSSH would try to resolve them as a name.
    ["ssh://[2001:db8::10]:2200", "2001:db8::10", 2200],
  ])("parses %s into OpenSSH argv", (url, host, port) => {
    expect(parseSshUrl(url)).toEqual({ host, port });
  });

  it("refuses an address carrying anything but scheme, host and port", () => {
    expect(sshBaseUrlSchema.safeParse("ssh://edge.example.test:22").success).toBe(true);
    for (const bad of [
      "https://edge.example.test",
      "ssh://user@edge.example.test",
      "ssh://edge.example.test/path",
      "ssh://edge.example.test?a=1",
      "ssh://edge.example.test#frag",
      "ssh://edge.example.test:0",
      "not a url",
    ]) {
      expect(sshBaseUrlSchema.safeParse(bad).success).toBe(false);
    }
  });

  it("treats any change of host or port as a move", () => {
    expect(sshEndpointMoved({ host: "a", port: 22 }, { host: "a", port: 22 })).toBe(false);
    expect(sshEndpointMoved({ host: "a", port: 22 }, { host: "b", port: 22 })).toBe(true);
    expect(sshEndpointMoved({ host: "a", port: 22 }, { host: "a", port: 2222 })).toBe(true);
    expect(sshEndpointMoved({ host: undefined, port: 22 }, { host: "a", port: 22 })).toBe(true);
  });
});
