/**
 * Pure parsing helpers behind resource detection. Kept free of `node:` imports
 * so they are unit-testable and safe to share with client code.
 */
import type { StorageKind } from "./recommend";

const MB = 1024 * 1024;

/**
 * cgroup v2 `memory.max` / v1 `memory.limit_in_bytes`. "max" and the v1
 * "unlimited" sentinel (a page-aligned value near 2^63) mean no limit.
 */
export function parseCgroupMemoryLimit(text: string | null | undefined): number | null {
  const value = text?.trim();
  if (!value || value === "max" || !/^\d+$/.test(value)) return null;
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes >= 2 ** 60) return null;
  return bytes;
}

/** cgroup v2 `cpu.max` ("quota period" or "max period") → whole CPUs, or null. */
export function parseCgroupCpuMax(text: string | null | undefined): number | null {
  const match = /^(\d+|max)\s+(\d+)$/.exec(text?.trim() ?? "");
  if (!match || match[1] === "max") return null;
  const quota = Number(match[1]);
  const period = Number(match[2]);
  if (quota <= 0 || period <= 0) return null;
  return Math.max(1, Math.ceil(quota / period));
}

/** Physical-looking block devices only: no loop, RAM, zram, CD or device-mapper. */
export function isRealBlockDevice(name: string): boolean {
  return !/^(loop|ram|zram|sr|dm-|md|nbd|fd)/.test(name);
}

/** All non-rotational → SSD; all rotational → HDD; mixed or nothing → unknown. */
export function classifyRotational(flags: Array<string | null>): StorageKind {
  const values = flags.map((flag) => flag?.trim()).filter((flag): flag is string => flag === "0" || flag === "1");
  if (values.length === 0) return "unknown";
  if (values.every((flag) => flag === "0")) return "ssd";
  if (values.every((flag) => flag === "1")) return "hdd";
  return "unknown";
}

/** `--max-old-space-size=N` from NODE_OPTIONS, in bytes. */
export function parseNodeHeapCap(nodeOptions: string | null | undefined): number | null {
  const match = /--max-old-space-size[= ](\d+)/.exec(nodeOptions ?? "");
  if (!match) return null;
  const mb = Number(match[1]);
  return mb > 0 ? mb * MB : null;
}

export type DbHostKind = "local" | "socket" | "remote" | "unknown";

export interface DbHostInfo {
  kind: DbHostKind;
  /** Hostname only — never credentials, port or database name. */
  host: string | null;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Where DATABASE_URL points. Only the hostname leaves this function, so the
 * caller can show "db" or "localhost" without ever touching the password.
 */
export function classifyDatabaseHost(databaseUrl: string | null | undefined): DbHostInfo {
  if (!databaseUrl) return { kind: "unknown", host: null };
  // libpq-style socket URLs ("postgresql://u@/db?host=/run/postgresql") have no
  // authority, which WHATWG URL refuses, so look for the host parameter first.
  if (/[?&]host=(\/|%2F)/i.test(databaseUrl)) return { kind: "socket", host: "unix socket" };
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return { kind: "unknown", host: null };
  }
  const host = decodeURIComponent(parsed.hostname).toLowerCase();
  if (!host || host.startsWith("/")) return { kind: "socket", host: "unix socket" };
  if (LOCAL_HOSTS.has(host)) return { kind: "local", host };
  return { kind: "remote", host };
}

export type InstallType = "native" | "docker" | "kubernetes" | "unknown";

export function resolveInstallType(value: string | null | undefined): InstallType {
  switch (value) {
    case "native":
      return "native";
    case "docker":
    case "docker-source":
      return "docker";
    case "kubernetes":
      return "kubernetes";
    default:
      return "unknown";
  }
}
