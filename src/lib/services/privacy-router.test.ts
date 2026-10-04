import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { encryptSecret } from "@/lib/crypto";
import { PRIVACY_ROUTER_AGENT_VERSION } from "@/lib/integrations/privacy-router/agent";
import { privacyProxyExpectedSha256 } from "@/lib/integrations/privacy-router/proxy";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

/**
 * The privacy router service.
 *
 * Two things here are worth more than the rest put together:
 *
 *  - the reorder tests run against a fake table that ENFORCES
 *    `@@unique([routerId, seq])` per statement, so an implementation that
 *    happens to pass a happy-path assertion but collides on real data fails
 *    here instead of in production;
 *  - the leak assertions pin that no response, DTO or audit detail can carry a
 *    WireGuard private key or PolySIEM's own SSH private key.
 */

const PEER_KEY = "d8azxthJIMMdDPQzKqVtzLncf1LAYWb36wbvHvT59Vc=";
const EXIT_PRIVATE_KEY = `${"A".repeat(43)}=`;
const FINGERPRINT = "SHA256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

const mocks = vi.hoisted(() => {
  const model = () => ({
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  });
  const privacyRouter = model();
  const vpnExit = model();
  const privacyRoutingRule = model();
  const managedHost = model();
  const tx = { privacyRouter, vpnExit, privacyRoutingRule, managedHost, $queryRaw: vi.fn() };
  // The recorded proxy build round-trips through AppSetting, so this one table is
  // a real (if tiny) store rather than an assertion on call arguments: what the
  // apply path reads has to be what a STATUS read actually wrote.
  const settings = new Map<string, unknown>();
  const appSetting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
      (settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null)),
    upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
      settings.set(where.key, create.value);
      return { key: where.key, value: create.value };
    }),
  };
  return {
    privacyRouter,
    vpnExit,
    privacyRoutingRule,
    managedHost,
    settings,
    appSetting,
    tx,
    audit: vi.fn(),
    runManagedSsh: vi.fn(),
    scanSshHostKeys: vi.fn(),
    connectorTlsSelfSigned: vi.fn(),
    resolveManagedHostBaseUrl: vi.fn(),
    assertManagedHostCanReach: vi.fn(),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    privacyRouter: mocks.privacyRouter,
    vpnExit: mocks.vpnExit,
    privacyRoutingRule: mocks.privacyRoutingRule,
    managedHost: mocks.managedHost,
    appSetting: mocks.appSetting,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(mocks.tx),
  },
}));
vi.mock("@/lib/audit", () => ({ audit: mocks.audit }));
vi.mock("./connectors", () => ({
  connectorTlsSelfSigned: mocks.connectorTlsSelfSigned,
  resolveManagedHostBaseUrl: mocks.resolveManagedHostBaseUrl,
  assertManagedHostCanReach: mocks.assertManagedHostCanReach,
}));
// Everything except the two functions that would open a socket stays real, so
// the pinned-session mechanics are exercised by their own suite, not stubbed here.
vi.mock("@/lib/ssh/managed-host", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ssh/managed-host")>();
  return { ...actual, runManagedSsh: mocks.runManagedSsh, scanSshHostKeys: mocks.scanSshHostKeys };
});

import {
  applyPrivacyRouter,
  authorizePrivacyProxyDownload,
  createVpnExit,
  defaultVpnExitIfName,
  deletePrivacyRouter,
  deleteVpnExit,
  ensurePrivacyRouterSshKey,
  fetchPrivacyRouterStatusReport,
  getVpnExitDeletionImpact,
  listPrivacyRouters,
  listPrivacyRoutingRules,
  parsePrivacyRouterProxyToken,
  provisionPrivacyRouter,
  readPrivacyRouterStatus,
  reorderPrivacyRoutingRules,
  servePrivacyProxyBinary,
  privacyRouterProxyAuthorization,
} from "./privacy-router";

const actor = { type: "user" as const, userId: "admin-one" };

/* ------------------------------------------------------------------ */
/* Row factories                                                       */
/* ------------------------------------------------------------------ */

const NOW = new Date("2026-08-21T12:00:00.000Z");

function managedHostRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "host-one",
    kind: "privacy-router",
    host: "10.0.3.70",
    port: 22,
    username: "polysiem-vpn",
    publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAAA polysiem-privacy-router",
    authorizedKey: 'restrict,command="sudo -n /usr/local/libexec/polysiem-privacy-router-agent" ssh-ed25519 AAAA',
    hostKeyFingerprint: FINGERPRINT,
    provisionedAt: NOW,
    encryptedCredentials: encryptSecret(
      JSON.stringify({ username: "polysiem-vpn", privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n-----END OPENSSH PRIVATE KEY-----\n" }),
    ),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function routerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "router-one",
    name: "House router",
    enabled: true,
    managedHostId: "host-one",
    managedHost: managedHostRow(),
    lanCidr: "10.0.3.0/24",
    lanInterface: "eth0",
    wanInterface: "eth0",
    // A second VLAN on purpose: the router's own subnet and the networks it
    // serves are different questions, and a fixture where they coincide would
    // pass even if the datapath went back to scoping on `lanCidr`.
    clientNetworks: ["10.0.3.0/24", "10.0.4.0/24"],
    proxyHttpPort: 3128,
    proxyHttpsPort: 3129,
    blockQuic: true,
    defaultAction: "direct",
    defaultExitId: null,
    appliedRevision: 2,
    appliedHash: "a".repeat(64),
    lastStatusAt: NOW,
    exitsConcurrent: null,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { exits: 1, rules: 2 },
    ...overrides,
  };
}

function exitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "exit-us",
    routerId: "router-one",
    key: "us",
    name: "Proton US",
    ifName: "psvpn-us",
    addressCidr: "10.2.0.2/32",
    endpoint: "185.159.157.1:51820",
    peerPublicKey: PEER_KEY,
    keepalive: 25,
    mtu: 1420,
    encryptedPrivateKey: encryptSecret(EXIT_PRIVATE_KEY),
    privateKeySha256: "b".repeat(64),
    enabled: true,
    lastHandshakeAt: null,
    lastRxBytes: null,
    lastTxBytes: null,
    createdAt: NOW,
    updatedAt: NOW,
    _count: { rules: 3 },
    ...overrides,
  };
}

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-one",
    routerId: "router-one",
    seq: 1,
    enabled: true,
    name: "Everything else",
    action: "direct",
    exitId: null,
    exit: null,
    srcCidr: null,
    dstCidr: null,
    proto: null,
    dportSpec: null,
    hostname: null,
    rateKbps: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const STATUS_RESPONSE = [
  "POLYSIEM_PRIVACY_ROUTER_STATUS_V1",
  "HOSTNAME\tprivacy-router",
  "KERNEL\t6.8.12-18-pve",
  // The agent this PolySIEM builds. A fixture reporting an older one would be a
  // fixture of a router that cannot be applied to — see the outdated-agent
  // suite, which asks for that state explicitly.
  `AGENT_VERSION\t${PRIVACY_ROUTER_AGENT_VERSION}`,
  "ARCH\tx86_64",
  "APPLIED_REVISION\t3",
  `APPLIED_HASH\t${"c".repeat(64)}`,
  "EXITS_CONCURRENT\t1",
  // The reference hardware: one NIC carrying both the LAN and the underlay.
  "IFACE\teth0\t10.0.3.70/24\t1\t1",
  "IFACE\teth1\t-\t0\t0",
  "EXIT_STATE\tus\tpsvpn-us\tup\t12\t4096\t2048",
  "PROXY_STATE\tup\t3\t1750000000",
  "",
].join("\n");

/** The STATUS fixture plus whatever extra lines a test needs. */
function statusWith(...lines: string[]): string {
  return `${STATUS_RESPONSE}${lines.join("\n")}\n`;
}

/** The same box, still carrying an agent from before the last PolySIEM upgrade. */
const OUTDATED_STATUS_RESPONSE = STATUS_RESPONSE.replace(
  `AGENT_VERSION\t${PRIVACY_ROUTER_AGENT_VERSION}`,
  "AGENT_VERSION\t1",
);

/** The AppSetting the recorded proxy build lives in. */
const PROXY_BUILD_KEY = "privacy_router_proxy_build";

/** The AppSetting the recorded agent version lives in. */
const AGENT_VERSION_KEY = "privacy_router_agent_version";

/** A proxy artefact laid out the way the image lays it out, under a temp cwd. */
async function proxyCwd(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "polysiem-privacy-proxy-test-"));
  await mkdir(join(dir, "assets", "privacy-proxy"), { recursive: true });
  await writeFile(join(dir, "assets", "privacy-proxy", "polysiem-privacy-proxy-x86_64"), "stub-binary\n");
  return dir;
}

/** The digest the ruleset must carry: read from the artefact, never a constant. */
function proxySha(cwd: string): Promise<string> {
  return privacyProxyExpectedSha256(cwd);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.clear();
  mocks.resolveManagedHostBaseUrl.mockResolvedValue("https://polysiem.lan:3000");
  mocks.connectorTlsSelfSigned.mockResolvedValue(true);
  // `vi.clearAllMocks()` clears CALLS, not implementations, so a test that made
  // the download address unreachable would otherwise leave it unreachable for
  // every test after it. Each of those tests sets the throw itself; the default
  // is reachable, and stating it here is what keeps this file order-independent.
  mocks.assertManagedHostCanReach.mockImplementation(() => {});
  mocks.privacyRouter.findUnique.mockResolvedValue(routerRow());
  mocks.privacyRouter.count.mockResolvedValue(0);
  mocks.privacyRouter.update.mockResolvedValue(routerRow());
  mocks.vpnExit.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.privacyRouter.findUnique.mockResolvedValue(routerRow());
  mocks.tx.privacyRouter.count.mockResolvedValue(0);
});

/* ------------------------------------------------------------------ */

describe("privacy router reads", () => {
  it("never returns key material with a router", async () => {
    mocks.privacyRouter.findMany.mockResolvedValue([routerRow()]);

    const routers = await listPrivacyRouters();

    expect(routers[0].ssh.host).toBe("10.0.3.70");
    expect(routers[0].ssh.hostKeyFingerprint).toBe(FINGERPRINT);
    expect(JSON.stringify(routers)).not.toContain("PRIVATE KEY");
    expect(JSON.stringify(routers)).not.toContain("encryptedCredentials");
  });

  it("derives the Kernel / Inspected tier from the whole ordered list", async () => {
    mocks.privacyRoutingRule.findMany.mockResolvedValue([
      ruleRow({ id: "r1", seq: 1, name: "LAN printer", dstCidr: "10.0.3.50/32" }),
      ruleRow({ id: "r2", seq: 2, name: "Netflix", action: "exit", exitId: "exit-us", hostname: "*.netflix.com", exit: { key: "us", name: "Proton US", enabled: true } }),
      ruleRow({ id: "r3", seq: 3, name: "Everything else" }),
    ]);

    const rules = await listPrivacyRoutingRules("router-one");

    // Above the first hostname rule nothing below can override it, so nftables
    // may decide the flow outright — even on 443.
    expect(rules.map((rule) => rule.tier)).toEqual(["kernel", "inspected", "inspected"]);
    expect(rules[1].exitKey).toBe("us");
  });
});

describe("routing rule reorder", () => {
  /**
   * A fake table that enforces `@@unique([routerId, seq])` the way Postgres
   * does: per statement. The naive "write every row to its new seq" reorder
   * throws here on the very first swap, which is the whole point.
   */
  function fakeRuleTable(seqs: number[]) {
    const rows = seqs.map((seq, index) => ({ id: `r${index + 1}`, seq, routerId: "router-one" }));
    mocks.tx.privacyRoutingRule.findMany.mockImplementation(async ({ select }: { select?: unknown }) => {
      const ordered = [...rows].sort((left, right) => left.seq - right.seq);
      return select ? ordered.map((row) => ({ id: row.id, seq: row.seq })) : ordered;
    });
    mocks.tx.privacyRoutingRule.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: { seq: number } }) => {
      const row = rows.find((candidate) => candidate.id === where.id);
      if (!row) throw new Error(`no such rule ${where.id}`);
      if (rows.some((other) => other.id !== row.id && other.seq === data.seq)) {
        throw new Error(`Unique constraint failed on the fields: (routerId, seq) — seq ${data.seq} is taken`);
      }
      row.seq = data.seq;
      return row;
    });
    mocks.privacyRoutingRule.findMany.mockImplementation(async () =>
      [...rows].sort((left, right) => left.seq - right.seq).map((row) => ruleRow({ id: row.id, seq: row.seq })),
    );
    return rows;
  }

  it("reverses a list without ever violating the per-statement unique", async () => {
    const rows = fakeRuleTable([1, 2, 3, 4]);

    const result = await reorderPrivacyRoutingRules(actor, "router-one", ["r4", "r3", "r2", "r1"]);

    expect(rows.map((row) => `${row.id}:${row.seq}`).sort()).toEqual(["r1:4", "r2:3", "r3:2", "r4:1"]);
    expect(result.map((rule) => rule.id)).toEqual(["r4", "r3", "r2", "r1"]);
  });

  it("swaps two adjacent rules, which is where a naive implementation collides", async () => {
    const rows = fakeRuleTable([1, 2, 3]);

    await reorderPrivacyRoutingRules(actor, "router-one", ["r2", "r1", "r3"]);

    expect(rows.map((row) => `${row.id}:${row.seq}`)).toEqual(["r1:2", "r2:1", "r3:3"]);
  });

  it("parks every moving row out of range before writing any target position", async () => {
    fakeRuleTable([1, 2, 3]);

    await reorderPrivacyRoutingRules(actor, "router-one", ["r3", "r1", "r2"]);

    const seqs = mocks.tx.privacyRoutingRule.update.mock.calls.map((call) => (call[0] as { data: { seq: number } }).data.seq);
    const firstPositive = seqs.findIndex((seq) => seq > 0);
    expect(seqs.slice(0, firstPositive).every((seq) => seq < 0)).toBe(true);
    expect(seqs.slice(firstPositive).every((seq) => seq > 0)).toBe(true);
  });

  it("writes nothing when the order is unchanged", async () => {
    fakeRuleTable([1, 2, 3]);

    await reorderPrivacyRoutingRules(actor, "router-one", ["r1", "r2", "r3"]);

    expect(mocks.tx.privacyRoutingRule.update).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      actor,
      "privacy_router.rule.reorder",
      { type: "privacy_router", id: "router-one" },
      { ruleCount: 3, movedCount: 0 },
    );
  });

  it("refuses a partial order rather than leaving holes in seq", async () => {
    fakeRuleTable([1, 2, 3]);

    await expect(reorderPrivacyRoutingRules(actor, "router-one", ["r2", "r1"])).rejects.toMatchObject({
      status: 400,
      code: "vpn_rule_order_invalid",
    });
    expect(mocks.tx.privacyRoutingRule.update).not.toHaveBeenCalled();
  });

  it("refuses a repeated rule and a rule from another router", async () => {
    fakeRuleTable([1, 2, 3]);

    await expect(reorderPrivacyRoutingRules(actor, "router-one", ["r1", "r1", "r3"])).rejects.toMatchObject({
      code: "vpn_rule_order_invalid",
    });
    await expect(reorderPrivacyRoutingRules(actor, "router-one", ["r1", "r2", "someone-elses"])).rejects.toMatchObject({
      code: "vpn_rule_order_invalid",
    });
  });
});

describe("exits", () => {
  it("stores a private key encrypted and returns only its digest", async () => {
    mocks.tx.vpnExit.count.mockResolvedValue(0);
    mocks.tx.vpnExit.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      exitRow({ ...data, id: "exit-new", _count: { rules: 0 } }),
    );

    const exit = await createVpnExit(actor, "router-one", {
      key: "us",
      name: "Proton US",
      addressCidr: "10.2.0.2/32",
      endpoint: "185.159.157.1:51820",
      peerPublicKey: PEER_KEY,
      privateKey: EXIT_PRIVATE_KEY,
      keepalive: 25,
      mtu: 1420,
      enabled: true,
    });

    const written = mocks.tx.vpnExit.create.mock.calls[0][0] as { data: Record<string, string> };
    expect(written.data.encryptedPrivateKey).not.toContain(EXIT_PRIVATE_KEY);
    expect(written.data.privateKeySha256).toMatch(/^[0-9a-f]{64}$/);
    // The netdev name is derived so an 8-character key can never produce an
    // interface name Linux refuses.
    expect(written.data.ifName).toBe(defaultVpnExitIfName("us"));
    expect(exit.hasPrivateKey).toBe(true);
    expect(JSON.stringify(exit)).not.toContain(EXIT_PRIVATE_KEY);
  });

  it("reports how many rules a deletion would take with it", async () => {
    mocks.vpnExit.findFirst.mockResolvedValue(exitRow());
    mocks.privacyRoutingRule.findMany.mockResolvedValue([{ name: "Netflix" }, { name: "Torrents" }]);
    mocks.privacyRouter.count.mockResolvedValue(0);

    const impact = await getVpnExitDeletionImpact("router-one", "exit-us");

    expect(impact).toMatchObject({ ruleCount: 3, ruleNames: ["Netflix", "Torrents"], isDefault: false });
  });

  it("deletes the exit and reports the cascaded rule count", async () => {
    mocks.tx.vpnExit.findFirst.mockResolvedValue(exitRow());
    mocks.tx.privacyRouter.count.mockResolvedValue(0);
    mocks.tx.vpnExit.delete.mockResolvedValue(exitRow());
    mocks.tx.privacyRoutingRule.findMany.mockResolvedValue([]);

    const result = await deleteVpnExit(actor, "router-one", "exit-us");

    expect(result).toEqual({ deleted: true, exitId: "exit-us", deletedRuleCount: 3 });
    expect(mocks.audit).toHaveBeenCalledWith(
      actor,
      "privacy_router.exit.delete",
      { type: "privacy_router", id: "router-one" },
      { exitId: "exit-us", deletedRuleCount: 3 },
    );
  });

  it("refuses to delete an exit that is a router's default", async () => {
    mocks.tx.vpnExit.findFirst.mockResolvedValue(exitRow());
    mocks.tx.privacyRouter.count.mockResolvedValue(1);

    await expect(deleteVpnExit(actor, "router-one", "exit-us")).rejects.toMatchObject({
      status: 409,
      code: "vpn_exit_is_default",
    });
    expect(mocks.tx.vpnExit.delete).not.toHaveBeenCalled();
  });
});

describe("provisioning", () => {
  it("refuses to bootstrap through the restricted service account", async () => {
    await expect(provisionPrivacyRouter(actor, "router-one", "polysiem-vpn", FINGERPRINT)).rejects.toMatchObject({
      status: 400,
    });
    expect(mocks.scanSshHostKeys).not.toHaveBeenCalled();
  });

  it("pins the fingerprint, installs through the bootstrap session, then verifies STATUS", async () => {
    mocks.scanSshHostKeys.mockResolvedValue([{ algorithm: "ssh-ed25519", fingerprint: FINGERPRINT, knownHostsLine: "line" }]);
    mocks.runManagedSsh
      .mockResolvedValueOnce({ code: 0, stdout: "PolySIEM privacy router agent installed.\n", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    const result = await provisionPrivacyRouter(actor, "router-one", "ubuntu", FINGERPRINT);

    const [target, request] = mocks.runManagedSsh.mock.calls[0];
    expect(target).toMatchObject({ host: "10.0.3.70", port: 22, username: "ubuntu", hostKeyFingerprint: FINGERPRINT });
    expect(request.stdin).toContain("polysiem-privacy-router-agent");
    expect(request.timeoutMs).toBe(300_000);
    expect(mocks.managedHost.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ provisionedAt: expect.any(Date) }) }),
    );
    expect(result.installed).toBe(true);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });

  /**
   * A reinstall is the ONLY remedy offered for an out-of-date agent, so the
   * install has to update the recorded version from the STATUS that just proved
   * it. Waiting for the next poll would leave the setup gap and the apply
   * refusal standing after the operator had done exactly the right thing.
   */
  it("records the agent version the fresh install just proved", async () => {
    mocks.settings.set(AGENT_VERSION_KEY, { "router-one": { version: "1", seenAt: "2026-08-01T00:00:00.000Z" } });
    mocks.scanSshHostKeys.mockResolvedValue([{ algorithm: "ssh-ed25519", fingerprint: FINGERPRINT, knownHostsLine: "line" }]);
    mocks.runManagedSsh
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    await provisionPrivacyRouter(actor, "router-one", "ubuntu", FINGERPRINT);

    expect(mocks.settings.get(AGENT_VERSION_KEY)).toEqual({
      "router-one": { version: PRIVACY_ROUTER_AGENT_VERSION, seenAt: expect.any(String) },
    });
  });

  /**
   * The admin account is not just who PolySIEM logs in AS — it is whose
   * `authorized_keys` holds the temporary bootstrap line, so the installer needs
   * the name to revoke it. Passing only the first two arguments is what left a
   * root-equivalent shell on every provisioned router.
   */
  it("tells the installer whose temporary authorization to revoke", async () => {
    mocks.scanSshHostKeys.mockResolvedValue([{ algorithm: "ssh-ed25519", fingerprint: FINGERPRINT, knownHostsLine: "line" }]);
    mocks.runManagedSsh
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    await provisionPrivacyRouter(actor, "router-one", "ubuntu", FINGERPRINT);

    const { stdin } = mocks.runManagedSsh.mock.calls[0][1] as { stdin: string };
    expect(stdin).toContain("ADMIN_NAME='ubuntu'");
    expect(stdin).toContain('grep -Fvx -- "$BOOTSTRAP_KEY"');
    expect(stdin.indexOf('mv "$ADMIN_KEYS.polysiem-new"')).toBeLessThan(
      stdin.indexOf("PolySIEM privacy router agent installed"),
    );
  });

  /**
   * The operator's complaint about the first cut was that they had no idea what
   * to type for LAN or WAN interface. Provisioning answers it: the box lists its
   * own NICs and PolySIEM says which one it believes is which.
   */
  it("hands back the box's interfaces and a topology suggestion to confirm", async () => {
    mocks.scanSshHostKeys.mockResolvedValue([{ algorithm: "ssh-ed25519", fingerprint: FINGERPRINT, knownHostsLine: "line" }]);
    mocks.runManagedSsh
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    const result = await provisionPrivacyRouter(actor, "router-one", "ubuntu", FINGERPRINT);

    expect(result.interfaces).toEqual([
      { name: "eth0", addrCidr: "10.0.3.70/24", defaultRoute: true, up: true },
      { name: "eth1", addrCidr: null, defaultRoute: false, up: false },
    ]);
    // One-armed, because 10.0.3.70 is the address PolySIEM connected on AND the
    // interface holding the default route. Normal for a router VM, not an error.
    expect(result.topology).toEqual({
      wanInterface: "eth0",
      lanInterface: "eth0",
      lanCidr: "10.0.3.0/24",
      oneArmed: true,
    });
    // A SUGGESTION, not a decision: nothing is written until a human confirms it.
    expect(mocks.privacyRouter.update).not.toHaveBeenCalled();
  });

  it("says the installer finished but the agent never answered", async () => {
    mocks.scanSshHostKeys.mockResolvedValue([{ algorithm: "ssh-ed25519", fingerprint: FINGERPRINT, knownHostsLine: "line" }]);
    mocks.runManagedSsh
      .mockResolvedValueOnce({ code: 0, stdout: "installed", stderr: "" })
      .mockResolvedValueOnce({ code: 1, stdout: "", stderr: "sudo: a password is required" });

    await expect(provisionPrivacyRouter(actor, "router-one", "ubuntu", FINGERPRINT)).rejects.toMatchObject({
      status: 502,
      code: "privacy_router_provision_unverified",
    });
  });

  it("mints the SSH identity once and hands back a pasteable bootstrap line", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({
      managedHost: managedHostRow({ publicKey: null, authorizedKey: null, encryptedCredentials: null }),
    }));

    const instructions = await ensurePrivacyRouterSshKey(actor, "router-one");

    expect(instructions.publicKey).toMatch(/^ssh-ed25519 /);
    expect(instructions.authorizedKey).toContain('restrict,command="sudo -n /usr/local/libexec/polysiem-privacy-router-agent"');
    expect(instructions.bootstrapCommand).toContain("authorized_keys");
    expect(JSON.stringify(instructions)).not.toContain("PRIVATE KEY");
    const written = mocks.managedHost.update.mock.calls[0][0] as { data: { encryptedCredentials: string } };
    expect(written.data.encryptedCredentials).not.toContain("PRIVATE KEY");
  });
});

describe("apply", () => {
  /** Echo the agent's acknowledgement for whatever revision and hash arrived. */
  function agentAcknowledges() {
    mocks.runManagedSsh.mockImplementation(async (_target: unknown, request: { stdin: string }) => {
      const meta = /^META\t(\d+)\t([0-9a-f]{64})$/m.exec(request.stdin);
      if (!meta) return { code: 0, stdout: STATUS_RESPONSE, stderr: "" };
      return { code: 0, stdout: `APPLIED\t2\t${meta[1]}\t${meta[2]}\n`, stderr: "" };
    });
  }

  function routerWith(exits: Record<string, unknown>[], rules: Record<string, unknown>[]) {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits, rules }));
  }

  it("pushes the canonical ruleset and persists what the box confirmed", async () => {
    routerWith([exitRow()], [ruleRow({ id: "r1", seq: 1, action: "exit", exitId: "exit-us", hostname: "*.netflix.com" })]);
    agentAcknowledges();
    const cwd = await proxyCwd();

    const result = await applyPrivacyRouter(actor, "router-one", { cwd });

    expect(result.applied).toBe(true);
    expect(result.revision).toBe(3); // appliedRevision 2 + 1, monotonic
    const payload = (mocks.runManagedSsh.mock.calls[0][1] as { stdin: string }).stdin;
    // The key travels on an unhashed KEY line; the canonical text carries only
    // its digest, which is what makes the hash safe to log.
    expect(payload).toContain(`KEY\tus\t${EXIT_PRIVATE_KEY}`);
    // The URL in the canonical ruleset is the URL the route actually serves;
    // there is exactly one download path and both sides derive it from the same
    // constants. A disagreement here fails every apply at the download step.
    expect(payload).toContain(
      `PROXYBIN\t${await proxySha(cwd)}\thttps://polysiem.lan:3000/api/network/privacy-router/proxy-binary/polysiem-privacy-proxy-x86_64\t1`,
    );
    expect(payload).toContain("PROXYAUTH\tBearer psvr_router-one.");
    // The networks the router SERVES cross the wire as their own line, apart
    // from the LAN line that says where the box sits. This fixture serves a VLAN
    // the box is not on, which is the case that used to be silently unhandled.
    expect(payload).toContain("LAN\t10.0.3.0/24\teth0\n");
    expect(payload).toContain("CLIENTS\t10.0.3.0/24,10.0.4.0/24\n");
    expect(mocks.privacyRouter.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ exitsConcurrent: true, appliedHash: "c".repeat(64) }),
    }));
    expect(mocks.audit).toHaveBeenCalledWith(
      actor,
      "privacy_router.apply",
      { type: "privacy_router", id: "router-one" },
      expect.objectContaining({ revision: 3, exitsConcurrent: true }),
    );
    expect(JSON.stringify(result)).not.toContain(EXIT_PRIVATE_KEY);
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
  });

  it("refuses rather than silently routing a rule out of the WAN when its exit is disabled", async () => {
    routerWith(
      [exitRow({ enabled: false })],
      [ruleRow({ id: "r1", seq: 1, name: "Netflix", action: "exit", exitId: "exit-us" })],
    );

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "vpn_rule_exit_unavailable",
    });
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  it("refuses when an enabled exit has no private key to stage", async () => {
    routerWith([exitRow({ encryptedPrivateKey: null })], []);

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "vpn_exit_key_missing",
    });
  });

  it("maps the agent's 'another apply is running' exit onto a retryable 409", async () => {
    routerWith([exitRow()], []);
    mocks.runManagedSsh.mockResolvedValue({ code: 4, stdout: "", stderr: "" });

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "privacy_router_apply_failed",
      message: expect.stringContaining("Another apply is already running"),
    });
    expect(mocks.audit).toHaveBeenCalledWith(
      actor,
      "privacy_router.apply_failed",
      { type: "privacy_router", id: "router-one" },
      expect.objectContaining({ revision: 3 }),
    );
  });

  /**
   * The same principle as refusing a rule that names a disabled exit: an
   * interface name decides where every forwarded packet goes, so a guess here
   * does not fail loudly — it routes the whole LAN into nothing.
   */
  it("refuses, actionably, while the topology is still unconfirmed", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({
      lanCidr: null, lanInterface: null, wanInterface: null, exits: [], rules: [],
    }));

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "privacy_router_topology_unconfirmed",
    });
    // The message names what is missing, which router, and what to do about it —
    // not a validation-shaped complaint with no cause.
    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(
      /the LAN network, the LAN interface and the WAN interface for "House router"/,
    );
    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/confirm the interfaces/);
    // Nothing was pushed: the refusal happens before the box is contacted.
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  /**
   * EMPTY IS NOT "EVERYTHING", and this refusal is the only thing standing
   * between those two readings.
   *
   * Every client-scoped rule on the box is built from this list, so an empty one
   * would not narrow the datapath — it would widen it to every source address on
   * the wire and masquerade them all out of the WAN. The message therefore has
   * to correct the mental model that caused the bug in the first place: that the
   * router's own subnet already answers this question.
   */
  it("refuses to apply a router that has not been told whose traffic it serves", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ clientNetworks: [], exits: [], rules: [] }));

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "privacy_router_client_networks_unset",
    });
    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/will not read that as "every network"/);
    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/need not include the router's own subnet/);
    // Refused before the box is contacted, like every other apply precondition.
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  it("names only the part of the topology that is actually missing", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ wanInterface: null, exits: [], rules: [] }));

    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(
      /does not know the WAN interface for "House router"/,
    );
  });

  /**
   * The field bug. The proxy download URL is baked into the canonical ruleset
   * from the address PolySIEM resolves for ITSELF, and an admin browsing a dev
   * server on localhost:3000 told the router to download its proxy from the
   * router. The apply died on the box with a message naming a dependency, an
   * architecture and an install, none of which was the problem.
   */
  it("checks the download address the ROUTER will use before contacting the box", async () => {
    routerWith([exitRow()], []);
    mocks.resolveManagedHostBaseUrl.mockResolvedValue("http://localhost:3000");
    mocks.assertManagedHostCanReach.mockImplementation(() => {
      throw new ApiError(409, "managed_host_base_url_unreachable", "http://localhost:3000 is the privacy router itself");
    });

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "managed_host_base_url_unreachable",
    });
    // Named with the far end in the operator's own vocabulary, and checked
    // before a single byte reaches the router.
    expect(mocks.assertManagedHostCanReach).toHaveBeenCalledWith("http://localhost:3000", "privacy router");
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  /** Say the address is unreachable, the way `assertManagedHostCanReach` does. */
  function unreachableFrom(baseUrl: string) {
    mocks.resolveManagedHostBaseUrl.mockResolvedValue(baseUrl);
    mocks.assertManagedHostCanReach.mockImplementation(() => {
      throw new ApiError(409, "managed_host_base_url_unreachable", `${baseUrl} is the privacy router itself`);
    });
  }

  /** What this router's last STATUS said about the proxy it has installed. */
  function routerRunsProxyBuild(sha256: string) {
    mocks.settings.set(PROXY_BUILD_KEY, { "router-one": { sha256, seenAt: NOW.toISOString() } });
  }

  /**
   * The refinement. The guard exists to stop an apply that tells the router to
   * download from an address only the admin's browser can reach — but a router
   * already running this exact build never downloads, so the address is never
   * dereferenced and refusing the apply blocks a working configuration. That is
   * the local-development case: PolySIEM on `localhost:3000`, a router that was
   * provisioned when it was reachable, nothing left to fetch.
   */
  it("applies from an unreachable address when the router already runs this exact proxy build", async () => {
    routerWith([exitRow()], []);
    agentAcknowledges();
    const cwd = await proxyCwd();
    const sha = await proxySha(cwd);
    routerRunsProxyBuild(sha);
    unreachableFrom("http://localhost:3000");
    const logged = vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await applyPrivacyRouter(actor, "router-one", { cwd });

    expect(result.applied).toBe(true);
    // Said in the result and on the console, so "why did this one work?" has an
    // answer without reading this file.
    expect(result.proxyAlreadyInstalled).toBe(sha);
    expect(logged.mock.calls[0][0]).toContain(sha);
    expect(mocks.assertManagedHostCanReach).not.toHaveBeenCalled();
    // The URL the operator's instance actually resolved still goes into the
    // canonical ruleset: a wrong address nothing dereferences is harmless, a
    // placeholder standing in for a real one would be a lie on the box.
    const payload = (mocks.runManagedSsh.mock.calls[0][1] as { stdin: string }).stdin;
    expect(payload).toContain(
      `PROXYBIN\t${sha}\thttp://localhost:3000/api/network/privacy-router/proxy-binary/polysiem-privacy-proxy-x86_64\t1`,
    );
    logged.mockRestore();
  });

  /**
   * A PolySIEM upgrade ships a new proxy, so the next apply DOES download and
   * the guard has to come back on its own. Nothing caches the exemption: the
   * expected digest is read from the artefact every time.
   */
  it("refuses again once the build PolySIEM serves is not the build the router has", async () => {
    routerWith([exitRow()], []);
    routerRunsProxyBuild("d".repeat(64));
    unreachableFrom("http://localhost:3000");

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
      status: 409,
      code: "managed_host_base_url_unreachable",
      // The original message, plus the sentence that explains why the previous
      // apply from this same address went through.
      message: expect.stringContaining("is the privacy router itself"),
    });
    await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toThrow(
      /needs no download and applies without this check/,
    );
    expect(mocks.assertManagedHostCanReach).toHaveBeenCalledWith("http://localhost:3000", "privacy router");
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  /**
   * An unknown state is not an installed one. A router PolySIEM has never had a
   * STATUS from is refused exactly as before — and refused for the ADDRESS,
   * ahead of anything to do with the artefact, so the message names the problem
   * the operator can act on even on a build where the proxy was never compiled.
   */
  it("treats a router it has never heard from as one that would download", async () => {
    routerWith([exitRow()], []);
    unreachableFrom("http://localhost:3000");
    const noArtefact = await mkdtemp(join(tmpdir(), "polysiem-privacy-proxy-empty-"));

    await expect(applyPrivacyRouter(actor, "router-one", { cwd: noArtefact })).rejects.toMatchObject({
      status: 409,
      code: "managed_host_base_url_unreachable",
    });
    expect(mocks.assertManagedHostCanReach).toHaveBeenCalledWith("http://localhost:3000", "privacy router");
    expect(mocks.runManagedSsh).not.toHaveBeenCalled();
  });

  it("refuses to apply a disabled router", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ enabled: false, exits: [], rules: [] }));

    await expect(applyPrivacyRouter(actor, "router-one")).rejects.toMatchObject({
      status: 409,
      code: "privacy_router_disabled",
    });
  });

  /**
   * The afternoon this whole check exists for.
   *
   * The ruleset format went to v2 and the agent constant went 1 → 2. A router
   * still carrying the v1 agent refused the new payload — correctly, it cannot
   * read it — but all it could say was `exit 2`, which PolySIEM rendered as "the
   * agent rejected the APPLY payload as malformed". That sentence accuses
   * PolySIEM of generating garbage and offers no remedy; the operator had to SSH
   * to the box and grep `AGENT_VERSION=1` out of the installed script to find
   * out what was actually wrong. PolySIEM had the answer the entire time: STATUS
   * reports the version and it was being read, audited, and then dropped.
   */
  describe("against an agent older than this PolySIEM", () => {
    /** Record what a v1 box reports, the same way a real STATUS read would. */
    async function boxIsRunningV1() {
      mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [], rules: [] }));
      mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: OUTDATED_STATUS_RESPONSE, stderr: "" });
      await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });
      vi.clearAllMocks();
      mocks.resolveManagedHostBaseUrl.mockResolvedValue("https://polysiem.lan:3000");
      mocks.connectorTlsSelfSigned.mockResolvedValue(true);
      mocks.privacyRouter.update.mockResolvedValue(routerRow());
    }

    it("refuses before the payload is built, naming both versions and the remedy", async () => {
      await boxIsRunningV1();
      routerWith([exitRow()], []);

      await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toMatchObject({
        status: 409,
        code: "privacy_router_agent_outdated",
      });
      // The three things the exit-2 message could not say: which version is on
      // the box, which one PolySIEM needs, and what to press.
      await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/agent version 1/);
      await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(
        new RegExp(`for version ${PRIVACY_ROUTER_AGENT_VERSION}`),
      );
      await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/Reinstall the agent/);
      // And the part no operator could deduce: the bootstrap grant is gone.
      await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/bootstrap command/);
      // Nothing was pushed. The box is not contacted at all.
      expect(mocks.runManagedSsh).not.toHaveBeenCalled();
    });

    it("does not blame the operator's configuration", async () => {
      await boxIsRunningV1();
      routerWith([exitRow()], []);

      await expect(applyPrivacyRouter(actor, "router-one")).rejects.toThrow(/Nothing is wrong with the router/);
      await expect(applyPrivacyRouter(actor, "router-one")).rejects.not.toThrow(/malformed/);
    });

    it("does NOT downgrade the payload to the format the old agent could read", async () => {
      // Rendering v1 rulesets for old agents would double the format surface for
      // as long as the feature exists, and every future bump would double it
      // again. Refusing is the correct answer.
      await boxIsRunningV1();
      routerWith([exitRow()], []);
      agentAcknowledges();

      await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toThrow();
      expect(mocks.runManagedSsh).not.toHaveBeenCalled();
    });

    it("lets an apply through when PolySIEM has never observed a version", async () => {
      // An unknown state must not become a hard stop: a router enrolled but
      // never read, and a box whose agent predates the AGENT_VERSION line, both
      // land here. Let the apply proceed and let the box speak for itself.
      expect(mocks.settings.get(AGENT_VERSION_KEY)).toBeUndefined();
      routerWith([exitRow()], []);
      agentAcknowledges();

      const result = await applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() });

      expect(result.applied).toBe(true);
    });

    /**
     * The pre-flight is an ADDITION. A payload that really is malformed still
     * comes back as exit 2, from a box whose agent version is current.
     */
    it("leaves the exit-2 path exactly where it was", async () => {
      routerWith([exitRow()], []);
      mocks.runManagedSsh.mockResolvedValue({ code: 2, stdout: "", stderr: "" });

      await expect(applyPrivacyRouter(actor, "router-one", { cwd: await proxyCwd() })).rejects.toThrow(
        /rejected the APPLY payload as malformed/,
      );
    });
  });
});

describe("status", () => {
  it("folds the report onto the rows without ingesting service traffic", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [exitRow()], rules: [] }));
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    const report = await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(report.status.exits[0]).toMatchObject({ key: "us", state: "up" });
    expect(mocks.vpnExit.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { routerId: "router-one", key: "us" },
      data: expect.objectContaining({ lastRxBytes: BigInt(4096), lastTxBytes: BigInt(2048) }),
    }));
    expect(report.desired.pendingChanges).toBe(true);
  });

  it("carries the box's interfaces and the topology it suggests on every read", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [exitRow()], rules: [] }));
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    const report = await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(report.status.interfaces.map((entry) => entry.name)).toEqual(["eth0", "eth1"]);
    expect(report.topology).toEqual({
      wanInterface: "eth0",
      lanInterface: "eth0",
      lanCidr: "10.0.3.0/24",
      oneArmed: true,
    });
  });

  /**
   * The apply path's download guard is decided from this: what the box last said
   * it has installed, recorded from its own STATUS and from nowhere else.
   *
   * The clearing half matters as much as the recording half. The agent prints
   * `PROXY_BUILD\t-` when the marker beside the binary is missing, which is what
   * a router that no longer has the proxy looks like; keeping the previous digest
   * would leave PolySIEM believing an install that is gone, and skipping the
   * guard for a download that would then really happen.
   */
  it("records the proxy build the box reports, and forgets it when the box stops reporting one", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [], rules: [] }));
    const sha = "e".repeat(64);
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: statusWith(`PROXY_BUILD\t${sha}`), stderr: "" });

    await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(mocks.settings.get(PROXY_BUILD_KEY)).toEqual({
      "router-one": { sha256: sha, seenAt: expect.any(String) },
    });

    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: statusWith("PROXY_BUILD\t-"), stderr: "" });
    await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(mocks.settings.get(PROXY_BUILD_KEY)).toEqual({});
  });

  /**
   * The same treatment for the agent version, and for the same reason: the
   * apply-time refusal is decided from what the box last said about ITSELF, so
   * this is the one place that belief is formed.
   *
   * Clearing matters as much as recording. A box that has stopped reporting an
   * `AGENT_VERSION` is UNKNOWN, and unknown does not block an apply — leaving a
   * remembered version standing would keep refusing on the strength of evidence
   * that is no longer there.
   */
  it("records the agent version the box reports, and forgets it when the box stops reporting one", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [], rules: [] }));
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: OUTDATED_STATUS_RESPONSE, stderr: "" });

    await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(mocks.settings.get(AGENT_VERSION_KEY)).toEqual({
      "router-one": { version: "1", seenAt: expect.any(String) },
    });

    mocks.runManagedSsh.mockResolvedValue({
      code: 0,
      stdout: STATUS_RESPONSE.replace(`AGENT_VERSION\t${PRIVACY_ROUTER_AGENT_VERSION}`, "AGENT_VERSION\t"),
      stderr: "",
    });
    await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(mocks.settings.get(AGENT_VERSION_KEY)).toEqual({});
  });

  /**
   * The background traffic poll is the ONLY STATUS read no operator triggers,
   * and it is what makes an agent that has fallen behind a PolySIEM upgrade
   * visible on the card before anybody composes a rule and presses Apply.
   * Without this, the gap would wait for a manual "Read status" — which is the
   * after-the-fact discovery the whole change exists to replace.
   */
  it("records the agent version from the unattended poll as well", async () => {
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: OUTDATED_STATUS_RESPONSE, stderr: "" });

    await readPrivacyRouterStatus("router-one", managedHostRow());

    expect(mocks.settings.get(AGENT_VERSION_KEY)).toEqual({
      "router-one": { version: "1", seenAt: expect.any(String) },
    });
    // And nothing else: folding the report onto the rows belongs to the
    // operator-facing read, and counters belong to the traffic pipeline.
    expect(mocks.privacyRouter.update).not.toHaveBeenCalled();
    expect(mocks.vpnExit.updateMany).not.toHaveBeenCalled();
  });

  /** The DTO carries both halves, so no surface holds its own copy of the constant. */
  it("puts the observed version and the required one on the router itself", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({ exits: [], rules: [] }));
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: OUTDATED_STATUS_RESPONSE, stderr: "" });

    const report = await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(report.router.agentVersion).toBe("1");
    expect(report.router.agentVersionRequired).toBe(PRIVACY_ROUTER_AGENT_VERSION);

    // And on the list read, which is what the router card renders from before
    // anybody has pressed "Read status".
    mocks.privacyRouter.findMany.mockResolvedValue([routerRow()]);
    const [listed] = await listPrivacyRouters();
    expect(listed.agentVersion).toBe("1");
  });

  /**
   * `desired` is best-effort on purpose: an unconfirmed topology is exactly when
   * an operator needs to SEE the box, so a status read must not inherit the
   * apply path's refusal.
   */
  it("still reports status for a router whose topology is unconfirmed", async () => {
    mocks.privacyRouter.findUnique.mockResolvedValue(routerRow({
      lanCidr: null, lanInterface: null, wanInterface: null, exits: [], rules: [],
    }));
    mocks.runManagedSsh.mockResolvedValue({ code: 0, stdout: STATUS_RESPONSE, stderr: "" });

    const report = await fetchPrivacyRouterStatusReport("router-one", { cwd: await proxyCwd() });

    expect(report.router.lanInterface).toBeNull();
    expect(report.topology.lanInterface).toBe("eth0");
    expect(report.desired.pendingChanges).toBe(true);
  });
});

describe("the proxy artefact", () => {
  const PUBLIC_KEY = managedHostRow().publicKey as string;

  /**
   * The recorded build is keyed by router id, so it has to die with the router.
   * A map nothing ever removes a key from is how an id that no longer exists
   * keeps an entry — and, if an id were ever recycled, hands it to a stranger.
   */
  it("forgets a deleted router's recorded proxy build and agent version", async () => {
    mocks.settings.set(PROXY_BUILD_KEY, {
      "router-one": { sha256: "f".repeat(64), seenAt: NOW.toISOString() },
      "router-two": { sha256: "a".repeat(64), seenAt: NOW.toISOString() },
    });
    mocks.settings.set(AGENT_VERSION_KEY, {
      "router-one": { version: "1", seenAt: NOW.toISOString() },
      "router-two": { version: "2", seenAt: NOW.toISOString() },
    });

    await deletePrivacyRouter(actor, "router-one");

    expect(mocks.settings.get(PROXY_BUILD_KEY)).toEqual({
      "router-two": { sha256: "a".repeat(64), seenAt: NOW.toISOString() },
    });
    expect(mocks.settings.get(AGENT_VERSION_KEY)).toEqual({
      "router-two": { version: "2", seenAt: NOW.toISOString() },
    });
  });

  it("authenticates a router by its derived bearer token and nothing else", async () => {
    const header = privacyRouterProxyAuthorization("router-one", PUBLIC_KEY);
    mocks.privacyRouter.findUnique.mockResolvedValue({ managedHost: { publicKey: PUBLIC_KEY } });

    await expect(authorizePrivacyProxyDownload(header)).resolves.toBe("router-one");
    await expect(authorizePrivacyProxyDownload(`${header}00`)).resolves.toBeNull();
    await expect(authorizePrivacyProxyDownload("Bearer psvr_router-one.deadbeef")).resolves.toBeNull();
    await expect(authorizePrivacyProxyDownload(null)).resolves.toBeNull();
    expect(parsePrivacyRouterProxyToken(header)).toMatchObject({ routerId: "router-one" });
  });

  it("stops honouring a token once the router has been re-provisioned", async () => {
    // The token is an HMAC over the router id AND its SSH public key, so minting
    // a new identity — the operator's "revoke this box" action — invalidates
    // every token issued for the old one, with no schema and no token table.
    const header = privacyRouterProxyAuthorization("router-one", PUBLIC_KEY);
    mocks.privacyRouter.findUnique.mockResolvedValue({
      managedHost: { publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIZZZ polysiem-privacy-router" },
    });

    await expect(authorizePrivacyProxyDownload(header)).resolves.toBeNull();
  });

  it("refuses a token for a router that has no key, or no row at all", async () => {
    const header = privacyRouterProxyAuthorization("router-one", PUBLIC_KEY);

    mocks.privacyRouter.findUnique.mockResolvedValue(null);
    await expect(authorizePrivacyProxyDownload(header)).resolves.toBeNull();
    mocks.privacyRouter.findUnique.mockResolvedValue({ managedHost: { publicKey: null } });
    await expect(authorizePrivacyProxyDownload(header)).resolves.toBeNull();
  });

  it("serves the built binary with the digest computed from the bytes", async () => {
    const artifact = await servePrivacyProxyBinary(await proxyCwd());

    expect(artifact.bytes.toString("utf8")).toBe("stub-binary\n");
    expect(artifact.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("explains how to build the binary instead of failing with a bare 500", async () => {
    const empty = await mkdtemp(join(tmpdir(), "polysiem-privacy-proxy-empty-"));

    const error = await servePrivacyProxyBinary(empty).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 503, code: "privacy_proxy_binary_missing" });
    expect((error as ApiError).message).toContain("cargo build");
    expect((error as ApiError).message).toContain("native/privacy-proxy");
  });
});
