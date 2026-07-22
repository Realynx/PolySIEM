/**
 * Best-effort InvestigationReport synthesis from already-gathered tool results.
 *
 * This is the core of the robustness contract: when the structured-output step
 * of an investigation fails (the model errors, times out, or returns nothing
 * usable), we must NEVER discard the research already done. This module turns
 * the raw tool-call outputs (identity, logs, threat-intel, rDNS, WHOIS,
 * reputation, related threats) plus the model's partial narrative into a
 * modest-but-real report — a provisional verdict with per-IP findings and at
 * least one resolution step.
 *
 * Pure and side-effect free (no server-only / Prisma imports) so the fallback
 * path is fully unit-testable and model-agnostic.
 */
import { isPrivateAddress, parseCidr } from "@/lib/topology/access";
import type {
  AgentToolCall,
  InvestigationReport,
  IpFindings,
  ResolutionStep,
  ThreatVerdict,
} from "@/lib/ai/agent/contract";

/** internal | external | unknown — mirrors IpFindings.scope. */
type IpScope = IpFindings["scope"];

/** One tool invocation's parsed result, correlated to its arguments. */
export interface RawToolResult {
  /** Registered tool name, e.g. "lookup_ip_identity". */
  name: string;
  /** Arguments the model passed (used to correlate a result to an IP). */
  args: Record<string, unknown>;
  /** Parsed JSON output when the tool returned JSON, else the raw string. */
  output: unknown;
}

export interface SynthesisInput {
  /** IPs under investigation (the report is organised per-IP). */
  ips: string[];
  /** All tool results gathered during the run. */
  results: RawToolResult[];
  /** Tool-call trail for report provenance (meta.toolCalls). */
  toolCalls: AgentToolCall[];
  /** The model's streamed narrative so far, if any. */
  partialText: string;
  /** Model identifier for provenance. */
  model: string;
  /** External services actually contacted this run. */
  externalSourcesUsed: string[];
  /** ISO timestamp for the report; defaults to now. */
  generatedAt?: string;
}

/* ------------------------------ small helpers ----------------------------- */

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The IP/term a tool call targeted, from its common argument shapes. */
function targetOf(args: Record<string, unknown>): string | null {
  return (
    asString(args.ip) ??
    asString(args.term) ??
    asString(args.indicator) ??
    null
  );
}

/** First result of a given tool whose target matches `ip`. */
function resultFor(results: RawToolResult[], name: string, ip: string): unknown {
  const match = results.find((r) => r.name === name && targetOf(r.args) === ip);
  return match?.output;
}

/** Named-tuple list ([{value,count}]) → the leading values. */
function topValues(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    const v = asString(asObject(entry)?.value);
    if (v) out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

/** Classify an address without inventory context (pure fallback). */
function fallbackScope(ip: string): IpScope {
  if (!parseCidr(ip)) return "unknown";
  return isPrivateAddress(ip) ? "internal" : "external";
}

function scopeFromResult(identity: Record<string, unknown> | null, ip: string): IpScope {
  const scope = asString(identity?.scope);
  return scope === "internal" || scope === "external" || scope === "unknown" ? scope : fallbackScope(ip);
}

function asnFromResult(whois: Record<string, unknown> | null): string | null {
  if (!whois) return null;
  const joined = [asString(whois.org), asString(whois.asn), asString(whois.country)].filter(Boolean).join(" · ");
  return asString(whois.summary) ?? (joined || null);
}

function reputationFromResults(
  intel: Record<string, unknown> | null,
  reputationResult: Record<string, unknown> | null,
): string | null {
  const parts: string[] = [];
  if (intel?.isKnownIoc === true) {
    const pulses = Array.isArray(intel.pulses)
      ? intel.pulses.map(asString).filter((pulse): pulse is string => Boolean(pulse))
      : [];
    parts.push(pulses.length ? `known IOC (${pulses.slice(0, 3).join(", ")})` : "known IOC");
  }
  const summary = asString(asObject(reputationResult?.reputation)?.summary)
    ?? (reputationResult ? asString(reputationResult.note) : null);
  if (summary && !/no reputation provider/i.test(summary)) parts.push(summary);
  return parts.length ? parts.join("; ") : null;
}

function activityFromLogs(logs: Record<string, unknown> | null): string | null {
  if (!logs) return null;
  const total = asNumber(logs.totalMatches);
  if (total === 0) return "No matching log events in the investigation window.";
  const signatures = topValues(logs.signatures, 3);
  const ports = topValues(logs.topPorts, 3);
  const events = topValues(logs.topEventTypes, 2);
  const parts: string[] = [];
  if (total !== null) parts.push(`${total} log event${total === 1 ? "" : "s"}`);
  if (signatures.length) parts.push(`signatures: ${signatures.join("; ")}`);
  else if (events.length) parts.push(`event types: ${events.join(", ")}`);
  if (ports.length) parts.push(`ports: ${ports.join(", ")}`);
  return parts.length ? parts.join(" — ") : null;
}

/* ------------------------------ per-IP extract ---------------------------- */

function findingsForIp(ip: string, results: RawToolResult[]): IpFindings {
  const identity = asObject(resultFor(results, "lookup_ip_identity", ip));
  const rdns = asObject(resultFor(results, "reverse_dns", ip));
  const whois = asObject(resultFor(results, "whois_asn", ip));
  const intel = asObject(resultFor(results, "check_threat_intel", ip));
  const rep = asObject(resultFor(results, "ip_reputation", ip));
  const logs = asObject(resultFor(results, "query_logs", ip));

  const scope = scopeFromResult(identity, ip);

  return {
    ip,
    scope,
    identity: identity ? asString(identity.identity) : null,
    reverseDns: rdns ? asString(rdns.hostname) : null,
    asn: asnFromResult(whois),
    reputation: reputationFromResults(intel, rep),
    activity: activityFromLogs(logs),
  };
}

/* -------------------------------- verdict --------------------------------- */

/** Any hard threat signal in the gathered results raises the verdict off "inconclusive". */
function hasThreatSignal(results: RawToolResult[]): boolean {
  return results.some((r) => {
    if (r.name === "check_threat_intel") return asObject(r.output)?.isKnownIoc === true;
    if (r.name === "ip_reputation") return asObject(asObject(r.output)?.reputation)?.flagged === true;
    return false;
  });
}

/* -------------------------------- resolve --------------------------------- */

function buildResolution(verdict: ThreatVerdict): ResolutionStep[] {
  const steps: ResolutionStep[] = [
    {
      order: 1,
      action: "Review the per-IP findings above and confirm the verdict manually.",
      rationale:
        "This report was synthesized from partial research because the model did not return a full structured assessment — treat the verdict as provisional.",
      changesState: false,
    },
  ];
  if (verdict === "suspicious" || verdict === "malicious") {
    steps.push({
      order: steps.length + 1,
      action: "Consider blocking the flagged external address(es) at the firewall and watch for further activity.",
      rationale: "At least one address is a known indicator of compromise or has poor external reputation.",
      changesState: true,
      command: "Firewall > Aliases > add to a blocklist alias",
    });
  }
  steps.push({
    order: steps.length + 1,
    action: "Re-run the AI investigation to obtain a complete structured report.",
    rationale: "A fresh agent pass may finish the analysis that could not complete this time.",
    changesState: false,
  });
  return steps;
}

/* --------------------------------- main ----------------------------------- */

/**
 * Build a best-effort {@link InvestigationReport} from gathered tool results.
 * Verdict defaults to "inconclusive" with a deliberately lowered confidence;
 * a hard threat signal (known IOC / flagged reputation) promotes it to
 * "suspicious". Always yields at least one resolution step.
 */
export function synthesizeReport(input: SynthesisInput): InvestigationReport {
  const uniqueIps =
    input.ips.length > 0
      ? [...new Set(input.ips)]
      : [
          ...new Set(
            input.results
              .map((r) => targetOf(r.args))
              .filter((t): t is string => Boolean(t) && parseCidr(t as string) !== null),
          ),
        ];

  const ips = uniqueIps.map((ip) => findingsForIp(ip, input.results));

  const suspicious = hasThreatSignal(input.results);
  const verdict: ThreatVerdict = suspicious ? "suspicious" : "inconclusive";
  const confidence = suspicious ? 45 : 25;

  const provenance =
    `Automated synthesis from partial investigation data: gathered ${input.results.length} tool ` +
    `result${input.results.length === 1 ? "" : "s"} across ${uniqueIps.length} address${uniqueIps.length === 1 ? "" : "es"}, ` +
    `but the model did not return a final structured report, so this verdict is best-effort and should be re-run.`;
  const narrative = input.partialText.trim();
  const summary = narrative.length > 60 ? `${narrative}\n\n${provenance}` : provenance;

  return {
    summary,
    verdict,
    confidence,
    ips,
    resolution: buildResolution(verdict),
    meta: {
      model: input.model,
      toolCalls: input.toolCalls,
      generatedAt: input.generatedAt ?? new Date().toISOString(),
      externalSourcesUsed: input.externalSourcesUsed,
    },
  };
}
