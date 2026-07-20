import { describe, expect, it } from "vitest";
import { emptySnapshot, type SecuritySnapshot, type SnapshotGuest, type SnapshotHost } from "../types";
import { checkDocumentation } from "./documentation";

const NOW = "2026-07-17T12:00:00.000Z";
const RECENT = "2026-07-17T09:00:00.000Z";
const DAYS_AGO_5 = "2026-07-12T12:00:00.000Z";

let seq = 0;
function guest(partial: Partial<SnapshotGuest>): SnapshotGuest {
  seq += 1;
  return {
    id: `g${seq}`,
    kind: "container",
    name: `guest-${seq}`,
    source: "PROXMOX",
    status: "ACTIVE",
    powerState: "RUNNING",
    lastSeenAt: RECENT,
    hasDescription: true,
    firewallPresent: true,
    firewallEnabled: true,
    sshKeyCount: 1,
    ...partial,
  };
}

function host(partial: Partial<SnapshotHost>): SnapshotHost {
  seq += 1;
  return {
    id: `h${seq}`,
    name: `host-${seq}`,
    kind: "hypervisor",
    source: "PROXMOX",
    status: "ACTIVE",
    lastSeenAt: RECENT,
    hasDescription: true,
    sshKeyCount: 1,
    ...partial,
  };
}

function snap(partial: Partial<SecuritySnapshot>): SecuritySnapshot {
  return { ...emptySnapshot(NOW), ...partial };
}

function byId(findings: ReturnType<typeof checkDocumentation>, id: string) {
  return findings.find((f) => f.id === id);
}

describe("checkDocumentation", () => {
  it("returns nothing for an empty snapshot", () => {
    expect(checkDocumentation(snap({}))).toEqual([]);
  });

  it("groups running guests without a description, ignoring stopped and documented ones", () => {
    const findings = checkDocumentation(
      snap({
        guests: [
          guest({ name: "mystery", hasDescription: false }),
          guest({ name: "documented" }),
          guest({ name: "stopped-mystery", hasDescription: false, powerState: "STOPPED" }),
          guest({ name: "removed", hasDescription: false, status: "REMOVED" }),
        ],
      }),
    );
    const f = byId(findings, "docs-undocumented-guests");
    expect(f?.severity).toBe("low");
    expect(f?.category).toBe("documentation");
    expect(f?.affected.map((a) => a.name)).toEqual(["mystery"]);
  });

  it("groups hosts without a description", () => {
    const findings = checkDocumentation(
      snap({
        hosts: [host({ name: "dixie", hasDescription: false }), host({ name: "described" })],
      }),
    );
    const f = byId(findings, "docs-undocumented-hosts");
    expect(f?.severity).toBe("low");
    expect(f?.affected.map((a) => a.name)).toEqual(["dixie"]);
  });

  it("flags synced entities unseen for days but still ACTIVE, across guests and hosts", () => {
    const findings = checkDocumentation(
      snap({
        guests: [
          guest({ name: "ghost-ct", lastSeenAt: DAYS_AGO_5 }),
          guest({ name: "fresh-ct" }),
          // manual entities have no sync heartbeat to be stale against
          guest({ name: "manual-ct", source: "MANUAL", lastSeenAt: null }),
        ],
        hosts: [
          host({ name: "ghost-host", lastSeenAt: DAYS_AGO_5 }),
          // already marked STALE by the sweep — the sweep owns that state
          host({ name: "marked-stale", lastSeenAt: DAYS_AGO_5, status: "STALE" }),
        ],
      }),
    );
    const f = byId(findings, "docs-stale-inventory");
    expect(f?.severity).toBe("medium");
    expect(f?.affected.map((a) => a.name)).toEqual(["ghost-ct", "ghost-host"]);
    expect(f?.weight).toBe(8); // 4 per entity * 2
  });

  it("count-scales undocumented guest/host weights with per-finding caps", () => {
    const guests = Array.from({ length: 6 }, (_, i) => guest({ name: `u${i}`, hasDescription: false }));
    const hosts = Array.from({ length: 4 }, (_, i) => host({ name: `h${i}`, hasDescription: false }));
    const findings = checkDocumentation(snap({ guests, hosts }));
    // guests: 2*6 = 12, capped at 9
    expect(byId(findings, "docs-undocumented-guests")?.weight).toBe(9);
    // hosts: 2*4 = 8, capped at 5
    expect(byId(findings, "docs-undocumented-hosts")?.weight).toBe(5);
  });

  it("flags undocumented STOPPED guests separately as info, not as running", () => {
    const findings = checkDocumentation(
      snap({
        guests: [
          guest({ name: "off-mystery", powerState: "STOPPED", hasDescription: false }),
          guest({ name: "off-documented", powerState: "STOPPED" }),
          guest({ name: "on-mystery", hasDescription: false }),
        ],
      }),
    );
    const stopped = byId(findings, "docs-undocumented-stopped-guests");
    expect(stopped?.severity).toBe("info");
    expect(stopped?.affected.map((a) => a.name)).toEqual(["off-mystery"]);
    // the running one stays in its own (louder) finding
    expect(byId(findings, "docs-undocumented-guests")?.affected.map((a) => a.name)).toEqual(["on-mystery"]);
  });

  it("raises a single coverage-thin finding when >50% of live inventory is undocumented", () => {
    const findings = checkDocumentation(
      snap({
        guests: [
          guest({ name: "a", hasDescription: false }),
          guest({ name: "b", hasDescription: false }),
          guest({ name: "c", hasDescription: false }),
          guest({ name: "d" }),
        ],
      }),
    );
    const f = byId(findings, "docs-coverage-thin");
    expect(f?.severity).toBe("low");
    expect(f?.title).toContain("75%");
    expect(f?.affected.map((a) => a.name).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not raise coverage-thin on a small or well-documented inventory", () => {
    // below the 4-entity sample floor
    const tiny = checkDocumentation(
      snap({ guests: [guest({ hasDescription: false }), guest({ hasDescription: false })] }),
    );
    expect(byId(tiny, "docs-coverage-thin")).toBeUndefined();

    // large but mostly documented (only 1 of 4 missing)
    const good = checkDocumentation(
      snap({
        guests: [guest({ hasDescription: false }), guest({}), guest({}), guest({})],
      }),
    );
    expect(byId(good, "docs-coverage-thin")).toBeUndefined();
  });
});
