/**
 * Network exposure checks: what the internet can actually reach. Port
 * forwards on sensitive ports, dynamic-DNS names revealing the WAN address,
 * tunnel ingress hostnames that bypass the CDN edge, and open WiFi. Pure;
 * absent data (integration not configured, DNS never resolved) yields no
 * findings rather than errors.
 */

import type { AffectedEntity, SecurityFinding, SecuritySnapshot, SnapshotPortForward } from "../types";
import { isAnySpec, isWanInterface, portSpecIncludes } from "./specs";

/** Ports whose direct WAN exposure is almost never intended. */
export const SENSITIVE_PORTS: { port: number; label: string }[] = [
  { port: 21, label: "FTP" },
  { port: 22, label: "SSH" },
  { port: 23, label: "Telnet" },
  { port: 53, label: "DNS" },
  { port: 161, label: "SNMP" },
  { port: 445, label: "SMB" },
  { port: 1433, label: "MSSQL" },
  { port: 3306, label: "MySQL" },
  { port: 3389, label: "RDP" },
  { port: 5432, label: "PostgreSQL" },
  { port: 5601, label: "Kibana" },
  { port: 5900, label: "VNC" },
  { port: 6379, label: "Redis" },
  { port: 9200, label: "Elasticsearch" },
  { port: 27017, label: "MongoDB" },
];

/** A forwarded range wider than this many contiguous ports is "wide open". */
const WIDE_RANGE_PORTS = 100;

/** More than this many enabled WAN forwards is a lot of surface to maintain. */
const WAN_FORWARD_VOLUME_FLOOR = 4;

/** Below this many internet-reachable tunnel names, the surface isn't worth noting. */
const TUNNEL_SURFACE_FLOOR = 3;

/** Does this forward take traffic on the WAN side? */
function isWanForward(f: SnapshotPortForward): boolean {
  if (isWanInterface(f.interfaceName)) return true;
  return /wanip/i.test((f.destSpec ?? "").trim());
}

function sensitiveMatches(f: SnapshotPortForward): { port: number; label: string }[] {
  return SENSITIVE_PORTS.filter(
    ({ port }) => portSpecIncludes(f.destPort, port) || portSpecIncludes(f.targetPort, port),
  );
}

function forwardName(f: SnapshotPortForward): string {
  const desc = (f.description ?? "").trim();
  const port = (f.destPort ?? "").trim() || (f.targetPort ?? "").trim() || "?";
  const proto = (f.protocol ?? "").trim();
  const label = `${proto ? `${proto}/` : ""}${port} → ${f.targetIp}`;
  return desc ? `${desc} (${label})` : label;
}

/** Widest contiguous range (in ports) named by a "1000-2000" / "1000:2000" spec. */
function widestPortRange(spec: string | null | undefined): number {
  const raw = (spec ?? "").trim();
  if (!raw) return 0;
  let widest = 0;
  for (const token of raw.split(",")) {
    const m = /^(\d+)\s*[-:]\s*(\d+)$/.exec(token.trim());
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    widest = Math.max(widest, Math.abs(hi - lo) + 1);
  }
  return widest;
}

function forwardRangeSpan(f: SnapshotPortForward): number {
  return Math.max(widestPortRange(f.destPort), widestPortRange(f.targetPort));
}

function countForm(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

export function checkExposure(snap: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];

  const wanForwards = snap.portForwards.filter((f) => f.enabled && f.status === "ACTIVE" && isWanForward(f));

  // Sensitive ports open to the whole internet — one finding per forward so a
  // single dismissal can't hide a second hole.
  for (const f of wanForwards) {
    const matches = sensitiveMatches(f);
    if (matches.length === 0 || !isAnySpec(f.sourceSpec)) continue;
    const labels = matches.map((m) => `${m.label} (${m.port})`).join(", ");
    findings.push({
      id: `exposure-sensitive-forward:${f.id}`,
      severity: "critical",
      category: "exposure",
      title: `${labels} forwarded from WAN to ${f.targetIp} with no source restriction`,
      detail:
        "This port forward exposes a management or database protocol to every address on the internet. Services like these are scanned and brute-forced within minutes of appearing.",
      remediation:
        "Remove the forward on the Firewall overview and reach the service over the VPN instead, or at minimum restrict the source to known peer addresses.",
      affected: [{ kind: "port-forward", id: f.id, name: forwardName(f) }],
    });
  }

  const sensitiveRestricted = wanForwards.filter(
    (f) => sensitiveMatches(f).length > 0 && !isAnySpec(f.sourceSpec),
  );
  if (sensitiveRestricted.length > 0) {
    findings.push({
      id: "exposure-sensitive-forward-restricted",
      severity: "medium",
      category: "exposure",
      title: `${sensitiveRestricted.length} sensitive port${countForm(sensitiveRestricted.length, " is", "s are")} forwarded from WAN (source-restricted)`,
      detail:
        "These forwards expose management/database ports but limit who may connect. The restriction is doing real work — keep it accurate, and prefer the VPN where possible.",
      remediation:
        "Review the allowed sources still match reality; move the service behind the VPN if the peer list has gone stale.",
      affected: sensitiveRestricted.map(
        (f): AffectedEntity => ({ kind: "port-forward", id: f.id, name: forwardName(f) }),
      ),
    });
  }

  const openForwards = wanForwards.filter(
    (f) => sensitiveMatches(f).length === 0 && isAnySpec(f.sourceSpec),
  );
  if (openForwards.length > 0) {
    findings.push({
      id: "exposure-open-forward",
      severity: "low",
      category: "exposure",
      title: `${openForwards.length} port forward${countForm(openForwards.length, " is", "s are")} open to any internet source`,
      detail:
        "Each internet-open forward is attack surface that must be patched and hardened forever. None of these hit the classic sensitive ports, but every exposed service deserves a periodic 'is this still needed?'.",
      remediation:
        "Confirm each service is still needed, up to date, and rate-limited; restrict sources or move behind a proxied tunnel where possible.",
      affected: openForwards.map(
        (f): AffectedEntity => ({ kind: "port-forward", id: f.id, name: forwardName(f) }),
      ),
    });
  }

  // Total WAN forwarding volume — every open door is a thing to patch forever.
  // Individually fine, collectively a maintenance and audit burden.
  if (wanForwards.length > WAN_FORWARD_VOLUME_FLOOR) {
    findings.push({
      id: "exposure-wan-forward-volume",
      severity: "medium",
      category: "exposure",
      title: `${wanForwards.length} port forwards are open on the WAN`,
      detail:
        "A large NAT table is a large attack surface: every forward is a service you have promised to keep patched, monitored and rate-limited indefinitely. Homelabs accrete these over years and rarely prune them.",
      remediation:
        "Walk the Firewall overview and retire forwards for services you no longer run; consolidate the survivors behind a single reverse proxy or a proxied tunnel.",
      // 1 pt per forward, capped at 8 so a busy NAT table can't sink exposure alone.
      weight: Math.min(8, wanForwards.length),
      affected: wanForwards.map(
        (f): AffectedEntity => ({ kind: "port-forward", id: f.id, name: forwardName(f) }),
      ),
    });
  }

  // Forwards that open a wide contiguous port range to the WAN — a single rule
  // that quietly exposes hundreds of ports instead of the one you meant.
  const wideRangeForwards = wanForwards.filter((f) => forwardRangeSpan(f) > WIDE_RANGE_PORTS);
  if (wideRangeForwards.length > 0) {
    findings.push({
      id: "exposure-wide-port-range",
      severity: "low",
      category: "exposure",
      title: `${wideRangeForwards.length} WAN forward${countForm(wideRangeForwards.length, "", "s")} expose${countForm(wideRangeForwards.length, "s", "")} a wide port range`,
      detail:
        "Each of these forwards a span of more than a hundred ports to an internal host. Broad ranges usually outlive the one game server or protocol they were opened for, and they hand attackers everything the host happens to be listening on.",
      remediation:
        "Narrow each forward to the exact ports the service needs on the Firewall overview; delete the range if the service that needed it is gone.",
      // 2 pts per wide forward, capped at 5.
      weight: Math.min(5, wideRangeForwards.length * 2),
      affected: wideRangeForwards.map(
        (f): AffectedEntity => ({ kind: "port-forward", id: f.id, name: forwardName(f) }),
      ),
    });
  }

  const wanDyndns = snap.dyndnsHosts.filter(
    (d) => d.enabled && d.status === "ACTIVE" && d.matchesWan === true,
  );
  if (wanDyndns.length > 0) {
    findings.push({
      id: "exposure-dyndns-unproxied",
      severity: "medium",
      category: "exposure",
      title: `${wanDyndns.length} dynamic-DNS hostname${countForm(wanDyndns.length, "", "s")} publish${countForm(wanDyndns.length, "es", "")} your WAN address`,
      detail:
        "These names resolve straight to your WAN IP with no CDN proxy in front, permanently linking a memorable hostname to your home connection and skipping any edge protection.",
      remediation:
        "Put the hostname behind a proxied Cloudflare record or a tunnel, or accept and document the direct exposure (e.g. it only fronts the VPN endpoint).",
      affected: wanDyndns.map((d): AffectedEntity => ({ kind: "dyndns", id: d.id, name: d.hostname })),
    });
  }

  // Enabled dyndns names the resolver has never scored against the WAN — we
  // genuinely don't know where they point, which is its own small worry.
  const unresolvedDyndns = snap.dyndnsHosts.filter(
    (d) => d.enabled && d.status === "ACTIVE" && d.matchesWan === null,
  );
  if (unresolvedDyndns.length > 0) {
    findings.push({
      id: "exposure-dyndns-unresolved",
      severity: "info",
      category: "exposure",
      title: `${unresolvedDyndns.length} dynamic-DNS hostname${countForm(unresolvedDyndns.length, " has", "s have")} never been resolved`,
      detail:
        "The DNS refresher hasn't managed to resolve these names, so PolySIEM can't tell whether they point at your WAN, a proxy, or nothing at all. Unknown exposure is worth a glance.",
      remediation:
        "Trigger a DNS refresh on the Firewall overview; if a name no longer resolves, retire the record so the exposure map stays honest.",
      // Informational: 1 pt per two unknown names, capped at 2.
      weight: Math.min(2, Math.ceil(unresolvedDyndns.length / 2)),
      affected: unresolvedDyndns.map((d): AffectedEntity => ({ kind: "dyndns", id: d.id, name: d.hostname })),
    });
  }

  const exposedTunnelHostnames = snap.tunnelHostnames.filter(
    (t) => t.classification === "unproxied-wan-exposed",
  );
  if (exposedTunnelHostnames.length > 0) {
    findings.push({
      id: "exposure-tunnel-hostname-unproxied",
      severity: "high",
      category: "exposure",
      title: `${exposedTunnelHostnames.length} tunnel ingress hostname${countForm(exposedTunnelHostnames.length, "", "s")} resolve${countForm(exposedTunnelHostnames.length, "s", "")} straight to your WAN`,
      detail:
        "These hostnames are documented as tunnel ingress but their public DNS bypasses the provider's edge and points at your WAN address — the tunnel's protection (DDoS shielding, IP hiding, access rules) is not actually in effect.",
      remediation:
        "Enable the proxy (orange cloud) on the DNS record, or fix the record to target the tunnel CNAME instead of the WAN IP.",
      affected: exposedTunnelHostnames.map(
        (t): AffectedEntity => ({
          kind: "tunnel-hostname",
          id: t.id,
          name: `${t.hostname} (${t.tunnelName})`,
        }),
      ),
    });
  }

  // Aggregate ingress surface: how many names are reachable from the internet
  // at all. Even properly proxied names are doors — worth knowing the count.
  const reachableTunnels = snap.tunnelHostnames.filter(
    (t) => t.classification === "proxied" || t.classification === "unproxied-wan-exposed",
  );
  if (reachableTunnels.length >= TUNNEL_SURFACE_FLOOR) {
    findings.push({
      id: "exposure-tunnel-ingress-volume",
      severity: "info",
      category: "exposure",
      title: `${reachableTunnels.length} tunnel ingress hostnames are reachable from the internet`,
      detail:
        "Each published hostname is a public entry point into the lab. Proxied ones sit behind the edge and are fine — this is just the running tally so the ingress surface doesn't grow unnoticed.",
      remediation:
        "Skim the list under Settings → Integrations (Cloudflare) and remove hostnames for apps you no longer expose; keep access policies in front of the survivors.",
      // Informational: 1 pt per three reachable names, capped at 2.
      weight: Math.min(2, Math.ceil(reachableTunnels.length / 3)),
      affected: reachableTunnels.map(
        (t): AffectedEntity => ({
          kind: "tunnel-hostname",
          id: t.id,
          name: `${t.hostname} (${t.tunnelName})`,
        }),
      ),
    });
  }

  const openWifi = snap.wirelessNetworks.filter(
    (w) => w.enabled && w.status === "ACTIVE" && (w.security ?? "").toLowerCase() === "open",
  );
  if (openWifi.length > 0) {
    findings.push({
      id: "exposure-open-wifi",
      severity: "high",
      category: "exposure",
      title: `${openWifi.length} WiFi network${countForm(openWifi.length, " is", "s are")} open (no encryption)`,
      detail:
        "Open SSIDs let anyone in radio range join the network and observe traffic on it.",
      remediation: "Enable WPA2/WPA3 on the SSID under /network/wifi, or isolate it to a guest VLAN with no lab access.",
      affected: openWifi.map((w): AffectedEntity => ({ kind: "wireless", id: w.id, name: w.name })),
    });
  }

  return findings;
}
