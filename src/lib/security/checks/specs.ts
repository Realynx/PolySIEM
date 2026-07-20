/**
 * Small spec-parsing helpers shared by the firewall and exposure checks.
 * Pure string logic over the sourceSpec/destSpec/port shapes the OPNsense and
 * Proxmox syncs write.
 */

/** True when a source/dest spec means "anywhere": empty, "any" or "*". */
export function isAnySpec(spec: string | null | undefined): boolean {
  const s = (spec ?? "").trim().toLowerCase();
  return s === "" || s === "any" || s === "*";
}

/** True when a protocol spec matches all protocols. */
export function isAnyProtocol(protocol: string | null | undefined): boolean {
  const p = (protocol ?? "").trim().toLowerCase();
  return p === "" || p === "any";
}

/** True when an interface name looks like the WAN edge. */
export function isWanInterface(name: string | null | undefined): boolean {
  return /wan/i.test((name ?? "").trim());
}

/**
 * Does a port spec ("22", "80,443", "4950-4955", "tcp/22") include `port`?
 * Unparseable tokens (aliases) are ignored rather than matched.
 */
export function portSpecIncludes(spec: string | null | undefined, port: number): boolean {
  const raw = (spec ?? "").trim();
  if (!raw) return false;
  for (const token of raw.split(",")) {
    const t = token.trim();
    if (!t) continue;
    const range = /^(\d+)\s*[-:]\s*(\d+)$/.exec(t);
    if (range) {
      const lo = Number(range[1]);
      const hi = Number(range[2]);
      if (Number.isFinite(lo) && Number.isFinite(hi) && port >= Math.min(lo, hi) && port <= Math.max(lo, hi)) {
        return true;
      }
      continue;
    }
    const single = /^\d+$/.exec(t);
    if (single && Number(t) === port) return true;
  }
  return false;
}
