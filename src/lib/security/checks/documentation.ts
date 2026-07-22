/**
 * Documentation checks — PolySIEM is a documentation dashboard, so coverage
 * gaps and inventory drift are findings too (low severity, but they are the
 * product's whole point). Pure derivation over the snapshot.
 */

import type { AffectedEntity, SecurityFinding, SecuritySnapshot } from "../types";

const STALE_MS = 3 * 86_400_000; // synced but unseen for 3+ days while still marked ACTIVE

function countForm(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

function staleInventory(snap: SecuritySnapshot, now: number): AffectedEntity[] {
  const staleGuests = snap.guests
    .filter((guest) => guest.source !== "MANUAL" && guest.status === "ACTIVE" && guest.lastSeenAt !== null && now - Date.parse(guest.lastSeenAt) > STALE_MS)
    .map((guest): AffectedEntity => ({ kind: guest.kind, id: guest.id, name: guest.name }));
  const staleHosts = snap.hosts
    .filter((host) => host.source !== "MANUAL" && host.status === "ACTIVE" && host.lastSeenAt !== null && now - Date.parse(host.lastSeenAt) > STALE_MS)
    .map((host): AffectedEntity => ({ kind: "device", id: host.id, name: host.name }));
  return [...staleGuests, ...staleHosts];
}

export function checkDocumentation(snap: SecuritySnapshot): SecurityFinding[] {
  const findings: SecurityFinding[] = [];
  const now = Date.parse(snap.now);

  const runningGuests = snap.guests.filter((g) => g.status === "ACTIVE" && g.powerState === "RUNNING");
  const undocumentedGuests = runningGuests.filter((g) => !g.hasDescription);
  if (undocumentedGuests.length > 0) {
    findings.push({
      id: "docs-undocumented-guests",
      severity: "low",
      category: "documentation",
      title: `${undocumentedGuests.length} running guest${countForm(undocumentedGuests.length, " has", "s have")} no description`,
      detail:
        "Workloads are running with no note about what they do, who depends on them, or how to rebuild them. Undocumented services are the ones that turn incidents into archaeology.",
      remediation:
        "Add a one-line description to each VM and container — what it runs, and anything a future you needs to know.",
      affected: undocumentedGuests.map(
        (g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name }),
      ),
      // 2 per undocumented guest, capped at 9 — many gaps hurt more than one.
      weight: Math.min(2 * undocumentedGuests.length, 9),
    });
  }

  const activeHosts = snap.hosts.filter((h) => h.status === "ACTIVE");
  const undocumentedHosts = activeHosts.filter((h) => !h.hasDescription);
  if (undocumentedHosts.length > 0) {
    findings.push({
      id: "docs-undocumented-hosts",
      severity: "low",
      category: "documentation",
      title: `${undocumentedHosts.length} host${countForm(undocumentedHosts.length, " has", "s have")} no description`,
      detail:
        "Physical hosts and network devices without descriptions leave hardware roles, locations and quirks undocumented.",
      remediation: "Describe each host: role, physical location, and anything special about its setup.",
      affected: undocumentedHosts.map(
        (h): AffectedEntity => ({ kind: "device", id: h.id, name: h.name }),
      ),
      // 2 per undocumented host, capped at 5.
      weight: Math.min(2 * undocumentedHosts.length, 5),
    });
  }

  // Stopped guests without a description — lower priority than running ones,
  // but still inventory the dashboard is meant to hold.
  const stoppedUndocumented = snap.guests.filter(
    (g) => g.status === "ACTIVE" && g.powerState !== "RUNNING" && !g.hasDescription,
  );
  if (stoppedUndocumented.length > 0) {
    findings.push({
      id: "docs-undocumented-stopped-guests",
      severity: "info",
      category: "documentation",
      title: `${stoppedUndocumented.length} stopped guest${countForm(stoppedUndocumented.length, " has", "s have")} no description`,
      detail:
        "Powered-off VMs and containers with no note are the easiest to forget entirely — was it a failed experiment, a template, or something you meant to bring back? A one-liner keeps it from becoming a mystery.",
      remediation:
        "Describe each stopped guest — or delete the ones that are genuinely retired so the inventory stays honest.",
      affected: stoppedUndocumented.map(
        (g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name }),
      ),
      // Info nudge, lower priority than the running-guest finding.
      weight: 2,
    });
  }

  const staleEntities = staleInventory(snap, now);
  if (staleEntities.length > 0) {
    findings.push({
      id: "docs-stale-inventory",
      severity: "medium",
      category: "documentation",
      title: `${staleEntities.length} synced entit${countForm(staleEntities.length, "y hasn't", "ies haven't")} been seen in days but still show ACTIVE`,
      detail:
        "The inventory claims these are live, but their integration hasn't reported them recently. Either the sync is broken or the documentation has drifted from reality — both undermine trust in this dashboard.",
      remediation:
        "Check the integration's sync status under Settings → Integrations, and retire entities that are really gone.",
      affected: staleEntities,
      // 4 per drifted entity, capped at 10 — scales with how far reality has slid.
      weight: Math.min(4 * staleEntities.length, 10),
    });
  }

  // Coverage-at-a-glance: if a large fraction of the live inventory has no
  // description, call it out once as a headline beyond the per-type findings.
  const coveragePool = [
    ...activeHosts.map((h): AffectedEntity => ({ kind: "device" as const, id: h.id, name: h.name })),
    ...runningGuests.map((g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name })),
  ];
  const undocumentedInPool = [
    ...undocumentedHosts.map((h): AffectedEntity => ({ kind: "device" as const, id: h.id, name: h.name })),
    ...undocumentedGuests.map((g): AffectedEntity => ({ kind: g.kind, id: g.id, name: g.name })),
  ];
  // Need a meaningful sample before a percentage means anything.
  if (coveragePool.length >= 4 && undocumentedInPool.length * 2 > coveragePool.length) {
    const pct = Math.round((100 * undocumentedInPool.length) / coveragePool.length);
    findings.push({
      id: "docs-coverage-thin",
      severity: "low",
      category: "documentation",
      title: `${pct}% of the live inventory has no description`,
      detail:
        "More than half of the running machines this dashboard tracks are undocumented. Past a point that isn't a few gaps, it's a documentation habit that hasn't formed yet — and an untrustworthy map is worse than none.",
      remediation:
        "Make describing a machine part of standing it up. Backfill the current gaps a few at a time from /inventory.",
      affected: undocumentedInPool,
      // Single low headline about overall coverage.
      weight: 3,
    });
  }

  return findings;
}
