import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

process.env.APP_SECRET = "unit-test-secret-0123456789abcdef0123456789abcdef";

/**
 * A bucket-aligned instant (UTC noon), so day and month rollup keys are obvious
 * by inspection. `now` is injected everywhere rather than faked with timers —
 * the ingest's whole correctness argument is about which instant a row carries.
 */
const T0 = Date.UTC(2026, 7, 17, 12, 0, 0);
const MIN = 60_000;
const DAY_START = new Date(Date.UTC(2026, 7, 17));
const MONTH_START = new Date(Date.UTC(2026, 7, 1));

/** The shapes the ingest hands Prisma. Declared so the call assertions are typed. */
interface SampleRowArgs {
  hostname: string;
  action: string;
  sampledAt: Date;
  windowSeconds: number;
  bytesIn: bigint;
  bytesOut: bigint;
  flows: number;
}
interface RollupUpsertArgs {
  where: {
    routerId_hostname_action_period_periodStart: {
      routerId: string;
      hostname: string;
      action: string;
      period: string;
      periodStart: Date;
    };
  };
  create: Record<string, unknown>;
  update: {
    bytesIn: { increment: bigint };
    bytesOut: { increment: bigint };
    samples: { increment: number };
    observedSeconds: { increment: number };
  };
}

const mocks = vi.hoisted(() => {
  // The cursor round-trips through AppSetting, so this one table is a real (if
  // tiny) store; everything else is asserted on its call arguments.
  const settings = new Map<string, unknown>();
  const appSetting = {
    findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
      settings.has(where.key) ? { key: where.key, value: settings.get(where.key) } : null),
    upsert: vi.fn(async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => {
      settings.set(where.key, create.value);
      return { key: where.key, value: create.value };
    }),
  };
  const serviceTrafficSample = {
    createMany: vi.fn(async (args: { data: SampleRowArgs[] }) => ({ count: args.data.length })),
    deleteMany: vi.fn(async () => ({ count: 0 })),
    findMany: vi.fn(async () => []),
  };
  const serviceTrafficRollup = {
    upsert: vi.fn(async (args: RollupUpsertArgs) => args.where.routerId_hostname_action_period_periodStart),
    deleteMany: vi.fn(async (args: { where: { period?: string } }) => ({ count: 0, period: args.where.period })),
    findMany: vi.fn(async () => []),
  };
  const privacyRouter = { findMany: vi.fn(async () => []), findFirst: vi.fn(async () => null) };
  return { settings, appSetting, serviceTrafficSample, serviceTrafficRollup, privacyRouter };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    appSetting: mocks.appSetting,
    serviceTrafficSample: mocks.serviceTrafficSample,
    serviceTrafficRollup: mocks.serviceTrafficRollup,
    privacyRouter: mocks.privacyRouter,
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({
      appSetting: mocks.appSetting,
      serviceTrafficSample: mocks.serviceTrafficSample,
      serviceTrafficRollup: mocks.serviceTrafficRollup,
    }),
  },
}));

import type { PrivacyRouterStatus, VpnServiceCounter } from "@/lib/integrations/privacy-router/client";
import {
  ingestServiceTraffic,
  pollPrivacyRouterTraffic,
  runPrivacyRouterTrafficPollIfDue,
  privacyRouterTrafficReport,
  type PrivacyRouterTrafficTarget,
} from "./privacy-router-traffic";

const ROUTER_ID = "router-1";

type ServiceInput = Partial<VpnServiceCounter> & { hostname: string };

function status(startedAtEpoch: number | null, services: ServiceInput[]): PrivacyRouterStatus {
  return {
    hostname: "privacy-router",
    kernel: "6.8.12-18-pve",
    agentVersion: "1",
    arch: "x86_64",
    appliedRevision: 3,
    appliedHash: null,
    nftHash: null,
    drift: false,
    ipForward: true,
    rpFilter: 2,
    lanInterface: "eth0",
    interfaces: [{ name: "eth0", addrCidr: "10.0.3.10/24", defaultRoute: true, up: true }],
    exits: [],
    probes: {},
    exitsConcurrent: true,
    proxy: {
      running: startedAtEpoch !== null,
      activeFlows: 0,
      totalFlows: 0,
      startedAtEpoch,
      degradedReason: null,
      buildSha256: null,
    },
    services: services.map((service) => ({ action: "direct", bytesIn: 0, bytesOut: 0, flows: 0, ...service })),
    ruleCounters: [],
    addresses: [],
  };
}

function reading(startedAtEpoch: number | null, services: ServiceInput[]) {
  const parsed = status(startedAtEpoch, services);
  return { startedAtEpoch: parsed.proxy.startedAtEpoch, services: parsed.services };
}

function router(partial: Partial<PrivacyRouterTrafficTarget> = {}): PrivacyRouterTrafficTarget {
  return {
    id: ROUTER_ID,
    name: "lan-privacy-router",
    managedHost: {
      host: "10.0.3.70",
      port: 22,
      username: "polysiem",
      hostKeyFingerprint: "SHA256:AAAABBBBCCCCDDDDEEEEFFFF00001111222233334444",
      encryptedCredentials: "v2:iv:tag:ct",
      ...partial.managedHost,
    },
    ...partial,
  };
}

/** Every sample row the ingest asked to create, across all calls. */
function createdRows(): SampleRowArgs[] {
  return mocks.serviceTrafficSample.createMany.mock.calls.flatMap(([args]) => args.data);
}

/** Every rollup upsert the ingest issued, across all calls. */
function rollupUpserts(): RollupUpsertArgs[] {
  return mocks.serviceTrafficRollup.upsert.mock.calls.map(([args]) => args);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.clear();
});

describe("ingestServiceTraffic — cumulative counters differenced into intervals", () => {
  it("treats the first reading as a baseline and stores nothing", async () => {
    const result = await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "netflix.com", bytesIn: 5_000, bytesOut: 400, flows: 2 },
    ]), new Date(T0));

    expect(result.baseline).toBe(true);
    expect(result.written).toBe(0);
    expect(mocks.serviceTrafficSample.createMany).not.toHaveBeenCalled();
    expect(mocks.serviceTrafficRollup.upsert).not.toHaveBeenCalled();
    // The cursor is still advanced, so the NEXT reading has something to
    // difference against.
    expect(mocks.appSetting.upsert).toHaveBeenCalledTimes(1);
  });

  it("differences the second reading and stores the interval, not the counter", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "netflix.com", bytesIn: 5_000, bytesOut: 400, flows: 2 },
    ]), new Date(T0));
    const result = await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "netflix.com", bytesIn: 12_000, bytesOut: 900, flows: 5 },
    ]), new Date(T0 + 5 * MIN));

    expect(result.baseline).toBe(false);
    expect(result.written).toBe(1);
    expect(result.windowSeconds).toBe(300);
    const [row] = createdRows();
    expect(row.hostname).toBe("netflix.com");
    expect(row.bytesIn).toBe(BigInt(7_000));
    expect(row.bytesOut).toBe(BigInt(500));
    expect(row.flows).toBe(3);
    expect(row.windowSeconds).toBe(300);
  });

  it("stamps every row of one poll with the SAME instant", async () => {
    const hosts = ["a.example", "b.example", "c.example"];
    await ingestServiceTraffic(ROUTER_ID, reading(1000, hosts.map((hostname) => ({ hostname }))), new Date(T0));
    await ingestServiceTraffic(
      ROUTER_ID,
      reading(1000, hosts.map((hostname, i) => ({ hostname, bytesIn: 1_000 * (i + 1) }))),
      new Date(T0 + 5 * MIN),
    );

    const rows = createdRows();
    expect(rows).toHaveLength(3);
    // @@unique([routerId, hostname, action, sampledAt]) is only an idempotency
    // guarantee while this holds. A per-row `new Date()` would give two
    // concurrent polls different keys and the constraint would never fire.
    expect(new Set(rows.map((row) => row.sampledAt.getTime())).size).toBe(1);
    expect(rows[0].sampledAt.getTime()).toBe(T0 + 5 * MIN);
  });

  it("keeps the (hostname, action) pairs one STATUS carries for the same hostname apart", async () => {
    const pairs: ServiceInput[] = [
      { hostname: "github.com", action: "direct", bytesIn: 1_000, bytesOut: 100, flows: 1 },
      { hostname: "github.com", action: "exit:us1", bytesIn: 3_000, bytesOut: 200, flows: 2 },
    ];
    await ingestServiceTraffic(ROUTER_ID, reading(1000, pairs), new Date(T0));
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "github.com", action: "direct", bytesIn: 1_500, bytesOut: 150, flows: 1 },
      { hostname: "github.com", action: "exit:us1", bytesIn: 9_000, bytesOut: 400, flows: 4 },
    ]), new Date(T0 + 5 * MIN));

    // Two rows at the same instant for one hostname: the unique key carries
    // `action`, and folding them would erase which path the bytes took.
    const rows = createdRows();
    expect(rows.map((row) => [row.action, row.bytesIn])).toEqual([
      ["direct", BigInt(500)],
      ["exit:us1", BigInt(6_000)],
    ]);
    expect(rows.every((row) => row.hostname === "github.com")).toBe(true);
    expect(new Set(rows.map((row) => row.sampledAt.getTime())).size).toBe(1);
  });

  it("differences each path against its own counter when a rule moves a service", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "netflix.com", action: "direct", bytesIn: 8_000 },
    ]), new Date(T0));
    // The operator adds a hostname rule. The direct slot freezes at 8000 and a
    // fresh exit slot starts at zero; the exit row must be its own 6000, not
    // 6000 measured against the direct counter.
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "netflix.com", action: "direct", bytesIn: 8_000 },
      { hostname: "netflix.com", action: "exit:us1", bytesIn: 6_000 },
    ]), new Date(T0 + 5 * MIN));

    const rows = createdRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("exit:us1");
    expect(rows[0].bytesIn).toBe(BigInt(6_000));
  });

  it("carries a frozen path forward so its return is not counted twice", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", action: "direct", bytesIn: 4_000 },
      { hostname: "a.example", action: "exit:us1", bytesIn: 100 },
    ]), new Date(T0));
    // The direct slot went idle and dropped out of this reading entirely.
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", action: "exit:us1", bytesIn: 500 },
    ]), new Date(T0 + 5 * MIN));
    mocks.serviceTrafficSample.createMany.mockClear();
    // …and came back. Forgetting it would read 4500 as a brand-new slot.
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", action: "direct", bytesIn: 4_500 },
      { hostname: "a.example", action: "exit:us1", bytesIn: 500 },
    ]), new Date(T0 + 10 * MIN));

    const rows = createdRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].bytesIn).toBe(BigInt(500)); // 4500 - 4000
  });

  it("counts a hostname the proxy had not seen before from zero", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 100 }]), new Date(T0));
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", bytesIn: 100 },
      { hostname: "new.example", bytesIn: 4_000, flows: 1 },
    ]), new Date(T0 + 5 * MIN));

    const rows = createdRows();
    // a.example moved nothing, so it is absent rather than a zero row; the new
    // slot started at zero, so its whole reading accrued inside this window.
    expect(rows.map((row) => row.hostname)).toEqual(["new.example"]);
    expect(rows[0].bytesIn).toBe(BigInt(4_000));
  });

  it("skips a hostname whose counter went backwards without a restart", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", bytesIn: 9_000 },
      { hostname: "b.example", bytesIn: 1_000 },
    ]), new Date(T0));
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [
      { hostname: "a.example", bytesIn: 10 },
      { hostname: "b.example", bytesIn: 3_000 },
    ]), new Date(T0 + 5 * MIN));

    expect(createdRows().map((row) => row.hostname)).toEqual(["b.example"]);
  });
});

describe("ingestServiceTraffic — a proxy restart is a baseline, never a spike", () => {
  it("stores nothing across a changed startedAtEpoch", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 50_000 }]), new Date(T0));
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 80_000 }]), new Date(T0 + 5 * MIN));
    mocks.serviceTrafficSample.createMany.mockClear();
    mocks.serviceTrafficRollup.upsert.mockClear();

    // The proxy restarted: its counters are back near zero. Differencing across
    // that would report a negative interval, or — if the new counter had
    // already passed the old one — an enormous invented one.
    const result = await ingestServiceTraffic(
      ROUTER_ID,
      reading(2000, [{ hostname: "a.example", bytesIn: 120 }]),
      new Date(T0 + 10 * MIN),
    );

    expect(result.baseline).toBe(true);
    expect(result.written).toBe(0);
    expect(result.windowSeconds).toBe(0);
    expect(mocks.serviceTrafficSample.createMany).not.toHaveBeenCalled();
    expect(mocks.serviceTrafficRollup.upsert).not.toHaveBeenCalled();
  });

  it("measures the next interval from the post-restart baseline", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 50_000 }]), new Date(T0));
    await ingestServiceTraffic(ROUTER_ID, reading(2000, [{ hostname: "a.example", bytesIn: 120 }]), new Date(T0 + 5 * MIN));
    mocks.serviceTrafficSample.createMany.mockClear();

    await ingestServiceTraffic(ROUTER_ID, reading(2000, [{ hostname: "a.example", bytesIn: 900 }]), new Date(T0 + 10 * MIN));

    const rows = createdRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].bytesIn).toBe(BigInt(780)); // 900 - 120, not 900 and not 900 - 50000
  });

  it("treats a proxy that is not running as a baseline", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000 }]), new Date(T0));
    const result = await ingestServiceTraffic(ROUTER_ID, reading(null, []), new Date(T0 + 5 * MIN));
    expect(result.baseline).toBe(true);
    expect(mocks.serviceTrafficSample.createMany).not.toHaveBeenCalled();
  });
});

describe("ingestServiceTraffic — a duplicate poll is a no-op, not a double count", () => {
  it("aborts the whole transaction before a single rollup is incremented", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000 }]), new Date(T0));
    // Whoever won the race already stored this instant. `createMany` runs
    // first and WITHOUT skipDuplicates precisely so this happens before the
    // fold-forward touches anything.
    mocks.serviceTrafficSample.createMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }),
    );

    const result = await ingestServiceTraffic(
      ROUTER_ID,
      reading(1000, [{ hostname: "a.example", bytesIn: 4_000 }]),
      new Date(T0 + 5 * MIN),
    );

    expect(result.duplicate).toBe(true);
    expect(result.written).toBe(0);
    expect(mocks.serviceTrafficRollup.upsert).not.toHaveBeenCalled();
  });

  it("re-ingesting the same instant with the same reading writes the same rows once", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000 }]), new Date(T0));
    const second = reading(1000, [{ hostname: "a.example", bytesIn: 4_000 }]);
    await ingestServiceTraffic(ROUTER_ID, second, new Date(T0 + 5 * MIN));
    const firstRows = createdRows();

    // The cursor advanced with the first attempt, so replaying the identical
    // reading at the identical instant now differences to zero and produces no
    // rows at all — idempotent even before the constraint has to fire.
    mocks.serviceTrafficSample.createMany.mockClear();
    const replay = await ingestServiceTraffic(ROUTER_ID, second, new Date(T0 + 5 * MIN));

    expect(firstRows).toHaveLength(1);
    expect(replay.written).toBe(0);
    expect(mocks.serviceTrafficSample.createMany).not.toHaveBeenCalled();
  });

  it("does not advance the cursor when the write was rejected as a duplicate", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000 }]), new Date(T0));
    mocks.appSetting.upsert.mockClear();
    mocks.serviceTrafficSample.createMany.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("duplicate", { code: "P2002", clientVersion: "6" }),
    );
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 4_000 }]), new Date(T0 + 5 * MIN));
    expect(mocks.appSetting.upsert).not.toHaveBeenCalled();
  });

  it("rethrows anything that is not a unique violation", async () => {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000 }]), new Date(T0));
    mocks.serviceTrafficSample.createMany.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 4_000 }]), new Date(T0 + 5 * MIN)),
    ).rejects.toThrow("connection reset");
  });
});

describe("ingestServiceTraffic — fold-forward rollups", () => {
  async function ingestOneInterval(): Promise<void> {
    await ingestServiceTraffic(ROUTER_ID, reading(1000, [{ hostname: "a.example", bytesIn: 1_000, bytesOut: 100 }]), new Date(T0));
    await ingestServiceTraffic(
      ROUTER_ID,
      reading(1000, [{ hostname: "a.example", bytesIn: 8_000, bytesOut: 600, flows: 2 }]),
      new Date(T0 + 5 * MIN),
    );
  }

  it("increments a day row and a month row on the UTC grid, inside the ingest", async () => {
    await ingestOneInterval();
    const periods = rollupUpserts();

    expect(periods).toHaveLength(2);
    expect(periods[0].where.routerId_hostname_action_period_periodStart).toEqual({
      routerId: ROUTER_ID, hostname: "a.example", action: "direct", period: "day", periodStart: DAY_START,
    });
    expect(periods[1].where.routerId_hostname_action_period_periodStart).toEqual({
      routerId: ROUTER_ID, hostname: "a.example", action: "direct", period: "month", periodStart: MONTH_START,
    });
  });

  it("creates with the interval and updates with increments, carrying samples and observed seconds", async () => {
    await ingestOneInterval();
    const [day] = rollupUpserts();

    expect(day.create).toMatchObject({
      bytesIn: BigInt(7_000),
      bytesOut: BigInt(500),
      samples: 1,
      observedSeconds: 300,
    });
    expect(day.update).toEqual({
      bytesIn: { increment: BigInt(7_000) },
      bytesOut: { increment: BigInt(500) },
      samples: { increment: 1 },
      observedSeconds: { increment: 300 },
    });
  });

  it("folds each further interval forward, so the month total is the sum of its intervals", async () => {
    await ingestOneInterval();
    await ingestServiceTraffic(
      ROUTER_ID,
      reading(1000, [{ hostname: "a.example", bytesIn: 20_000, bytesOut: 900, flows: 3 }]),
      new Date(T0 + 10 * MIN),
    );

    const monthIncrements = rollupUpserts()
      .filter((call) => call.where.routerId_hostname_action_period_periodStart.period === "month")
      .map((call) => call.update.bytesIn.increment);

    expect(monthIncrements).toEqual([BigInt(7_000), BigInt(12_000)]);
    const total = monthIncrements.reduce((sum, value) => sum + value, BigInt(0));
    expect(total).toBe(BigInt(19_000)); // 20000 - 1000, the whole cumulative rise
  });
});

describe("pollPrivacyRouterTraffic", () => {
  it("reads STATUS once and prunes raw samples on the seven-day retention window", async () => {
    const fetchStatus = vi.fn(async () => status(1000, [{ hostname: "a.example", bytesIn: 1_000 }]));
    await pollPrivacyRouterTraffic(router(), new Date(T0), fetchStatus);

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.serviceTrafficSample.deleteMany).toHaveBeenCalledWith({
      where: { routerId: ROUTER_ID, sampledAt: { lt: new Date(T0 - 7 * 24 * 3_600_000) } },
    });
  });

  it("prunes day rollups at 400 days and never touches month rollups", async () => {
    const fetchStatus = vi.fn(async () => status(1000, []));
    await pollPrivacyRouterTraffic(router(), new Date(T0), fetchStatus);

    const deletes = mocks.serviceTrafficRollup.deleteMany.mock.calls.map(([args]) => args.where);
    expect(deletes).toEqual([
      { routerId: ROUTER_ID, period: "day", periodStart: { lt: new Date(T0 - 400 * 86_400_000) } },
    ]);
    // A year plus a month, so this-August-versus-last-August still works. The
    // month rows are the durable record and are deliberately never deleted.
    expect(deletes.some((where) => where.period === "month")).toBe(false);
  });
});

describe("runPrivacyRouterTrafficPollIfDue", () => {
  // The poll walks EVERY router row and filters on `enabled` itself, so the rows
  // it is handed carry the column.
  const routerRow = { ...router(), enabled: true };

  it("polls a due router and records the poll", async () => {
    mocks.privacyRouter.findMany.mockResolvedValueOnce([routerRow] as never);
    const fetchStatus = vi.fn(async () => status(1000, [{ hostname: "a.example", bytesIn: 1_000 }]));
    await runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus);

    expect(fetchStatus).toHaveBeenCalledTimes(1);
    expect(mocks.settings.get("privacy_router_traffic_poll_status")).toEqual({
      [ROUTER_ID]: { lastPollAt: new Date(T0).toISOString(), errors: [] },
    });
  });

  it("throttles on its own poll interval rather than the newest sample", async () => {
    mocks.settings.set("privacy_router_traffic_poll_status", {
      [ROUTER_ID]: { lastPollAt: new Date(T0).toISOString(), errors: [] },
    });
    mocks.privacyRouter.findMany.mockResolvedValueOnce([routerRow] as never);
    const fetchStatus = vi.fn(async () => status(1000, []));
    // A quiet router writes no samples; throttling on samples would re-poll it
    // on every single tick.
    await runPrivacyRouterTrafficPollIfDue(new Date(T0 + 60_000), fetchStatus);
    expect(fetchStatus).not.toHaveBeenCalled();

    mocks.privacyRouter.findMany.mockResolvedValueOnce([routerRow] as never);
    await runPrivacyRouterTrafficPollIfDue(new Date(T0 + 6 * MIN), fetchStatus);
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });

  it("skips a router whose SSH host key is not enrolled yet", async () => {
    mocks.privacyRouter.findMany.mockResolvedValueOnce([
      { ...router({ managedHost: { ...routerRow.managedHost, hostKeyFingerprint: null } }), enabled: true },
    ] as never);
    const fetchStatus = vi.fn(async () => status(1000, []));
    await runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus);
    expect(fetchStatus).not.toHaveBeenCalled();
  });

  it("leaves a disabled router unpolled without forgetting what it last reported", async () => {
    mocks.settings.set("privacy_router_traffic_poll_status", {
      [ROUTER_ID]: { lastPollAt: new Date(T0 - 60 * MIN).toISOString(), errors: ["boom"] },
    });
    mocks.privacyRouter.findMany.mockResolvedValueOnce([{ ...routerRow, enabled: false }] as never);
    const fetchStatus = vi.fn(async () => status(1000, []));

    await runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus);

    expect(fetchStatus).not.toHaveBeenCalled();
    // `enabled` gates polling, not history: the row still exists, so its entry
    // is not a leak and must survive.
    expect(mocks.settings.get("privacy_router_traffic_poll_status")).toEqual({
      [ROUTER_ID]: { lastPollAt: new Date(T0 - 60 * MIN).toISOString(), errors: ["boom"] },
    });
  });

  /**
   * The leak. `privacy_router_traffic_poll_status` is keyed by router id and
   * nothing ever removed a key, so a router deleted hours ago was still carrying
   * its last error around in `AppSetting`.
   */
  it("drops poll-status entries for routers that no longer exist", async () => {
    mocks.settings.set("privacy_router_traffic_poll_status", {
      [ROUTER_ID]: { lastPollAt: new Date(T0 - 60 * MIN).toISOString(), errors: [] },
      "router-deleted": { lastPollAt: new Date(T0 - 600 * MIN).toISOString(), errors: ["The privacy router did not answer STATUS"] },
    });
    mocks.privacyRouter.findMany.mockResolvedValueOnce([routerRow] as never);
    const fetchStatus = vi.fn(async () => status(1000, []));

    await runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus);

    expect(mocks.settings.get("privacy_router_traffic_poll_status")).toEqual({
      [ROUTER_ID]: { lastPollAt: new Date(T0).toISOString(), errors: [] },
    });
  });

  /**
   * Pruning cannot depend on a poll having happened: an instance whose only
   * remaining router is switched off never sets `changed`, and the entry would
   * outlive the router forever.
   */
  it("prunes even on a tick where nothing was polled", async () => {
    mocks.settings.set("privacy_router_traffic_poll_status", {
      "router-deleted": { lastPollAt: new Date(T0 - 600 * MIN).toISOString(), errors: [] },
    });
    mocks.privacyRouter.findMany.mockResolvedValueOnce([{ ...routerRow, enabled: false }] as never);
    const fetchStatus = vi.fn(async () => status(1000, []));

    await runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus);

    expect(fetchStatus).not.toHaveBeenCalled();
    expect(mocks.settings.get("privacy_router_traffic_poll_status")).toEqual({});
  });

  it("never throws when a router is unreachable, and records the failure", async () => {
    mocks.privacyRouter.findMany.mockResolvedValueOnce([routerRow] as never);
    const fetchStatus = vi.fn(async () => {
      throw new Error("The privacy router did not answer STATUS");
    });
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(runPrivacyRouterTrafficPollIfDue(new Date(T0), fetchStatus)).resolves.toBeUndefined();

    const statuses = mocks.settings.get("privacy_router_traffic_poll_status") as Record<string, { errors: string[] }>;
    expect(statuses[ROUTER_ID].errors).toEqual(["The privacy router did not answer STATUS"]);
    logged.mockRestore();
  });

  it("never throws when listing routers fails", async () => {
    mocks.privacyRouter.findMany.mockRejectedValueOnce(new Error("database is starting up"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(runPrivacyRouterTrafficPollIfDue(new Date(T0), vi.fn())).resolves.toBeUndefined();
    logged.mockRestore();
  });
});

describe("privacyRouterTrafficReport", () => {
  it("serves a short window from raw samples", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce({ id: ROUTER_ID } as never);
    mocks.serviceTrafficSample.findMany.mockResolvedValueOnce([
      { hostname: "a.example", action: "direct", sampledAt: new Date(T0 - 10 * MIN), windowSeconds: 300, bytesIn: BigInt(6_000), bytesOut: BigInt(300), flows: 2 },
    ] as never);

    const report = await privacyRouterTrafficReport("1h", new Date(T0));

    expect(report.source).toBe("sample");
    expect(report.bucketMs).toBe(2 * MIN); // chooseBucketMs(1h)
    expect(report.services).toHaveLength(1);
    expect(report.totals).toMatchObject({ bytesIn: 6_000, bytesOut: 300 });
    expect(mocks.serviceTrafficRollup.findMany).not.toHaveBeenCalled();
  });

  it("serves 30d from the day rollups, on the day grid", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce({ id: ROUTER_ID } as never);
    mocks.serviceTrafficRollup.findMany.mockResolvedValueOnce([
      { hostname: "a.example", action: "direct", periodStart: DAY_START, bytesIn: BigInt(9_000), bytesOut: BigInt(700), samples: 4, observedSeconds: 1_200 },
    ] as never);

    const report = await privacyRouterTrafficReport("30d", new Date(T0));

    expect(report.source).toBe("rollup");
    expect(report.bucketMs).toBe(86_400_000);
    expect(report.services[0].totalIn).toBe(9_000);
    expect(report.services[0].flows).toBeNull();
    expect(mocks.serviceTrafficSample.findMany).not.toHaveBeenCalled();
    // 29 whole days back plus today.
    expect(report.fromMs).toBe(Date.UTC(2026, 6, 19));
    expect(mocks.serviceTrafficRollup.findMany).toHaveBeenCalledTimes(1);
  });

  it("serves a calendar month from the day rows for shape and the month row for totals", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce({ id: ROUTER_ID } as never);
    mocks.serviceTrafficRollup.findMany
      .mockResolvedValueOnce([
        { hostname: "a.example", action: "direct", periodStart: DAY_START, bytesIn: BigInt(9_000), bytesOut: BigInt(700), samples: 4, observedSeconds: 1_200 },
      ] as never)
      .mockResolvedValueOnce([
        { hostname: "a.example", action: "direct", periodStart: MONTH_START, bytesIn: BigInt(400_000), bytesOut: BigInt(20_000), samples: 90, observedSeconds: 27_000 },
      ] as never);

    const report = await privacyRouterTrafficReport("month", new Date(T0));

    expect(report.fromMs).toBe(MONTH_START.getTime());
    expect(report.services[0].totalIn).toBe(400_000);
    expect(report.services[0].samples).toBe(90);
    // The day row still supplies the shape for the day it covers.
    const dayPoint = report.services[0].series.find((point) => point.t === DAY_START.getTime());
    expect(dayPoint?.inBps).toBe((9_000 * 8) / 1_200);
  });

  it("answers the direct-versus-VPN question without the client re-deriving it", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce({ id: ROUTER_ID } as never);
    mocks.serviceTrafficSample.findMany.mockResolvedValueOnce([
      { hostname: "netflix.com", action: "exit:us1", sampledAt: new Date(T0 - 10 * MIN), windowSeconds: 300, bytesIn: BigInt(90_000), bytesOut: BigInt(1_000), flows: 2 },
      { hostname: "netflix.com", action: "direct", sampledAt: new Date(T0 - 10 * MIN), windowSeconds: 300, bytesIn: BigInt(10_000), bytesOut: BigInt(500), flows: 1 },
      { hostname: "ads.example", action: "block", sampledAt: new Date(T0 - 10 * MIN), windowSeconds: 300, bytesIn: BigInt(0), bytesOut: BigInt(200), flows: 4 },
    ] as never);

    const report = await privacyRouterTrafficReport("1h", new Date(T0));

    expect(report.totals.egress).toEqual({
      vpn: { bytesIn: 90_000, bytesOut: 1_000 },
      direct: { bytesIn: 10_000, bytesOut: 500 },
      blocked: { bytesIn: 0, bytesOut: 200 },
    });
    expect(report.totals.byAction.map((one) => one.action)).toEqual(["exit:us1", "direct", "block"]);
    // The buckets are exhaustive, so a percentage of them is honest.
    const { egress, bytesIn } = report.totals;
    expect(egress.vpn.bytesIn + egress.direct.bytesIn + egress.blocked.bytesIn).toBe(bytesIn);
    // And a service still appears once, with its own breakdown.
    expect(report.services.map((service) => service.hostname)).toEqual(["netflix.com", "ads.example"]);
    expect(report.services[0].actions).toHaveLength(2);
  });

  it("returns an empty report rather than failing when no router exists", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce(null as never);
    const report = await privacyRouterTrafficReport("24h", new Date(T0));
    expect(report.routerId).toBeNull();
    expect(report.services).toEqual([]);
    expect(report.status.lastPollAt).toBeNull();
  });

  it("does not leak router credentials into the response", async () => {
    mocks.privacyRouter.findFirst.mockResolvedValueOnce({ id: ROUTER_ID } as never);
    const report = await privacyRouterTrafficReport("24h", new Date(T0));
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain("PRIVATE KEY");
    expect(serialized).not.toContain("encryptedCredentials");
  });
});
