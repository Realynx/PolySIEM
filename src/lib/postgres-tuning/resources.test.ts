import { describe, expect, it } from "vitest";
import { MANAGED_SETTING_NAMES, isValidSettingValue, pgMemoryToBytes } from "./catalog";
import {
  classifyDatabaseHost,
  classifyRotational,
  isRealBlockDevice,
  parseCgroupCpuMax,
  parseCgroupMemoryLimit,
  parseNodeHeapCap,
  resolveInstallType,
} from "./resources";
import { alterSystemSetSql, buildManualPlan, psqlCommand } from "./sql";

describe("resource parsing", () => {
  it("reads cgroup memory limits and ignores unlimited sentinels", () => {
    expect(parseCgroupMemoryLimit("max\n")).toBeNull();
    expect(parseCgroupMemoryLimit("2147483648\n")).toBe(2147483648);
    expect(parseCgroupMemoryLimit("9223372036854771712")).toBeNull();
    expect(parseCgroupMemoryLimit(null)).toBeNull();
  });

  it("reads cgroup CPU quotas", () => {
    expect(parseCgroupCpuMax("max 100000")).toBeNull();
    expect(parseCgroupCpuMax("200000 100000")).toBe(2);
    expect(parseCgroupCpuMax("150000 100000")).toBe(2);
    expect(parseCgroupCpuMax("garbage")).toBeNull();
  });

  it("classifies storage from rotational flags", () => {
    expect(classifyRotational(["0\n", "0"])).toBe("ssd");
    expect(classifyRotational(["1"])).toBe("hdd");
    expect(classifyRotational(["0", "1"])).toBe("unknown");
    expect(classifyRotational([null])).toBe("unknown");
    expect(isRealBlockDevice("sda")).toBe(true);
    expect(isRealBlockDevice("loop0")).toBe(false);
    expect(isRealBlockDevice("zram0")).toBe(false);
  });

  it("parses the Node heap cap", () => {
    expect(parseNodeHeapCap("--max-old-space-size=768")).toBe(768 * 1024 * 1024);
    expect(parseNodeHeapCap("--enable-source-maps")).toBeNull();
    expect(parseNodeHeapCap(undefined)).toBeNull();
  });

  it("classifies the database host without leaking credentials", () => {
    expect(classifyDatabaseHost("postgresql://polysiem:s3cret@localhost:5432/polysiem")).toEqual({ kind: "local", host: "localhost" });
    expect(classifyDatabaseHost("postgresql://u:p@127.0.0.1/db")).toEqual({ kind: "local", host: "127.0.0.1" });
    expect(classifyDatabaseHost("postgresql://u:p@[::1]:5432/db").kind).toBe("local");
    expect(classifyDatabaseHost("postgresql://u:p@db:5432/polysiem")).toEqual({ kind: "remote", host: "db" });
    expect(classifyDatabaseHost("postgresql://u:p@/db?host=/var/run/postgresql").kind).toBe("socket");
    expect(classifyDatabaseHost(undefined).kind).toBe("unknown");
    expect(JSON.stringify(classifyDatabaseHost("postgresql://u:s3cret@db/x"))).not.toContain("s3cret");
  });

  it("maps install types", () => {
    expect(resolveInstallType("native")).toBe("native");
    expect(resolveInstallType("docker-source")).toBe("docker");
    expect(resolveInstallType("kubernetes")).toBe("kubernetes");
    expect(resolveInstallType(undefined)).toBe("unknown");
  });
});

describe("setting validation and SQL", () => {
  it("accepts well-formed values within bounds", () => {
    expect(isValidSettingValue("shared_buffers", "256MB")).toBe(true);
    expect(isValidSettingValue("random_page_cost", "1.1")).toBe(true);
    expect(isValidSettingValue("jit", "off")).toBe(true);
    expect(isValidSettingValue("max_parallel_workers", "2")).toBe(true);
    expect(pgMemoryToBytes("32768", "8kB")).toBe(256 * 1024 * 1024);
  });

  it("rejects injection attempts, unknown names and out-of-range values", () => {
    expect(isValidSettingValue("shared_buffers", "256MB'; DROP TABLE x; --")).toBe(false);
    expect(isValidSettingValue("shared_buffers", "1TB")).toBe(false);
    expect(isValidSettingValue("shared_buffers", "1kB")).toBe(false);
    expect(isValidSettingValue("jit", "maybe")).toBe(false);
    expect(isValidSettingValue("random_page_cost", "1e3")).toBe(false);
    expect(isValidSettingValue("archive_command", "rm -rf /")).toBe(false);
    expect(() => alterSystemSetSql("shared_buffers", "1' OR '1")).toThrow();
    expect(() => alterSystemSetSql("listen_addresses", "*")).toThrow();
  });

  it("builds ALTER SYSTEM statements and install-specific manual commands", () => {
    const statement = alterSystemSetSql("shared_buffers", "256MB");
    expect(statement).toBe("ALTER SYSTEM SET shared_buffers = '256MB';");
    expect(psqlCommand("native", [statement])).toContain(`sudo -u postgres psql \\\n  -c "${statement}"`);
    const plan = buildManualPlan("docker", [statement], "no privilege", true);
    expect(plan.command).toContain("docker compose exec db psql -U polysiem");
    expect(plan.sql).toContain("SELECT pg_reload_conf();");
    expect(plan.restartCommand).toBe("docker compose restart db");
  });

  it("only manages a fixed set of tuning parameters", () => {
    expect(MANAGED_SETTING_NAMES).toContain("shared_buffers");
    expect(MANAGED_SETTING_NAMES).not.toContain("listen_addresses");
  });
});
