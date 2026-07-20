import type { IocCandidate } from "./normalize";

/**
 * Suricata rule generation from OTX feed IOCs.
 *
 * Pure and deterministic: the same IOC set always yields the same rules with
 * the same SIDs, so re-downloads don't churn alert identities on the sensor.
 */

/** SIDs live in the 1000000-1999999 "local use" range, upper half for PolySIEM. */
const SID_BASE = 1_500_000;
const SID_SPAN = 400_000;

/** IPs per rule line — keeps lines readable and reload-friendly. */
const IPS_PER_RULE = 64;

export interface SuricataRuleset {
  text: string;
  ipRuleCount: number;
  dnsRuleCount: number;
  ipCount: number;
  domainCount: number;
  pulseCount: number;
}

/** FNV-1a 32-bit — stable, dependency-free hash for SID derivation. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Deterministic SID per rule key; collisions probe upward within the span.
 * Keys are processed in caller order, which is itself deterministic.
 */
function allocateSids(keys: string[]): Map<string, number> {
  const used = new Set<number>();
  const sids = new Map<string, number>();
  for (const key of keys) {
    let sid = SID_BASE + (fnv1a(key) % SID_SPAN);
    while (used.has(sid)) {
      sid = SID_BASE + ((sid - SID_BASE + 1) % SID_SPAN);
    }
    used.add(sid);
    sids.set(key, sid);
  }
  return sids;
}

/** Strip characters that would break out of a Suricata msg/content string. */
export function sanitizeMsg(text: string): string {
  return text
    .replace(/[";\\|]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

interface PulseGroup {
  id: string;
  name: string;
  ips: string[];
}

/** Group IPs under the first (newest) pulse that referenced them. */
function groupByPulse(iocs: IocCandidate[]): PulseGroup[] {
  const groups = new Map<string, PulseGroup>();
  for (const ioc of iocs) {
    const owner = ioc.pulses[0];
    if (!owner) continue;
    let group = groups.get(owner.id);
    if (!group) {
      group = { id: owner.id, name: owner.name, ips: [] };
      groups.set(owner.id, group);
    }
    group.ips.push(ioc.indicator);
  }
  return [...groups.values()];
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build the downloadable ruleset. Per pulse: one inbound + one outbound
 * `alert ip` rule over its IP list (chunked). Per domain: one `alert dns`
 * rule matching the query suffix.
 */
export function generateSuricataRules(input: {
  ipIocs: IocCandidate[];
  domainIocs: IocCandidate[];
  sourceName: string;
  generatedAt: Date;
}): SuricataRuleset {
  const groups = groupByPulse(input.ipIocs).map((group) => ({
    ...group,
    msg: sanitizeMsg(group.name) || group.id,
    chunks: chunk(group.ips, IPS_PER_RULE),
  }));

  const domains = input.domainIocs
    .map((ioc) => ({
      domain: ioc.indicator,
      pulse: ioc.pulses[0],
      msg: sanitizeMsg(ioc.pulses[0]?.name ?? "") || (ioc.pulses[0]?.id ?? "unknown pulse"),
    }))
    .filter((d) => d.pulse);

  // One deterministic SID pool across every rule this file will emit.
  const keys: string[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.chunks.length; i++) {
      keys.push(`ip-in:${group.id}:${i}`, `ip-out:${group.id}:${i}`);
    }
  }
  for (const d of domains) keys.push(`dns:${d.domain}`);
  const sids = allocateSids(keys);

  const lines: string[] = [];
  let ipRuleCount = 0;
  let dnsRuleCount = 0;

  for (const group of groups) {
    lines.push(`# Pulse: ${group.msg} (${group.ips.length} IPs) — otx.alienvault.com/pulse/${group.id}`);
    for (let i = 0; i < group.chunks.length; i++) {
      const list = `[${group.chunks[i].join(",")}]`;
      const part = group.chunks.length > 1 ? ` (${i + 1}/${group.chunks.length})` : "";
      const common =
        `classtype:misc-attack; ` +
        `reference:url,otx.alienvault.com/pulse/${group.id}; ` +
        `metadata:provider PolySIEM_OTX, otx_pulse_id ${group.id}; rev:1;`;
      lines.push(
        `alert ip ${list} any -> $HOME_NET any ` +
          `(msg:"PolySIEM OTX inbound: ${group.msg}${part}"; ` +
          `sid:${sids.get(`ip-in:${group.id}:${i}`)}; ${common})`,
        `alert ip $HOME_NET any -> ${list} any ` +
          `(msg:"PolySIEM OTX outbound: ${group.msg}${part}"; ` +
          `sid:${sids.get(`ip-out:${group.id}:${i}`)}; ${common})`,
      );
      ipRuleCount += 2;
    }
    lines.push("");
  }

  if (domains.length > 0) {
    lines.push(`# DNS lookups of ${domains.length} feed domains`);
    for (const d of domains) {
      lines.push(
        `alert dns $HOME_NET any -> any any ` +
          `(msg:"PolySIEM OTX dns: ${d.domain} — ${d.msg}"; ` +
          `dns.query; content:"${d.domain}"; nocase; endswith; ` +
          `sid:${sids.get(`dns:${d.domain}`)}; classtype:misc-attack; ` +
          `reference:url,otx.alienvault.com/pulse/${d.pulse!.id}; ` +
          `metadata:provider PolySIEM_OTX, otx_pulse_id ${d.pulse!.id}; rev:1;)`,
      );
      dnsRuleCount++;
    }
    lines.push("");
  }

  const header = [
    `# PolySIEM threat-intel ruleset — AlienVault OTX feed "${sanitizeMsg(input.sourceName)}"`,
    `# Generated ${input.generatedAt.toISOString()}`,
    `# ${ipRuleCount} IP rules (${input.ipIocs.length} IPs across ${groups.length} pulses), ${dnsRuleCount} DNS rules`,
    `# Managed by PolySIEM — do not edit; re-download to refresh.`,
    "",
  ];
  const body = lines.length > 0 ? lines : ["# No indicators on the feed right now.", ""];

  return {
    text: [...header, ...body].join("\n"),
    ipRuleCount,
    dnsRuleCount,
    ipCount: input.ipIocs.length,
    domainCount: domains.length,
    pulseCount: groups.length,
  };
}
