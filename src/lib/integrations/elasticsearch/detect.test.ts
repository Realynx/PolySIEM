import { describe, expect, it } from "vitest";
import { backingIndexMap, collapseToTargets, indicesForField, type FieldCapsResponse } from "./detect";
import { resolvePatterns } from "./insights";

describe("indicesForField", () => {
  const res: FieldCapsResponse = {
    indices: ["a-1", "b-1", "c-1"],
    fields: {
      "suricata.eve.event_type": {
        keyword: { indices: ["a-1", "b-1"] },
        unmapped: { indices: ["c-1"] },
      },
      "cloudflared.error": {
        keyword: {}, // mapped everywhere (no unmapped entry, no per-type list)
      },
    },
  };

  it("returns the mapped-type indices and ignores the unmapped pseudo-type", () => {
    expect(indicesForField(res, "suricata.eve.event_type").sort()).toEqual(["a-1", "b-1"]);
  });

  it("falls back to the response-wide index list only when mapped everywhere", () => {
    expect(indicesForField(res, "cloudflared.error").sort()).toEqual(["a-1", "b-1", "c-1"]);
  });

  it("returns empty for unknown fields", () => {
    expect(indicesForField(res, "nope")).toEqual([]);
  });
});

describe("collapseToTargets", () => {
  it("maps backing indices to their data stream and wildcards rollover names", () => {
    const backing = backingIndexMap({
      data_streams: [{ name: "filebeat-proxmox-9.2.3", backing_indices: [".ds-filebeat-proxmox-9.2.3-2026.07.01-000004"] }],
    });
    const targets = collapseToTargets(
      [
        ".ds-filebeat-proxmox-9.2.3-2026.07.01-000004",
        "logstash-suricata-2026.07.17",
        "my-custom-index",
        "logstash-suricata-2026.07.16",
      ],
      backing,
    );
    expect(targets).toEqual(["filebeat-proxmox-9.2.3", "logstash-suricata-*", "my-custom-index"]);
  });
});

describe("resolvePatterns", () => {
  it("prefers detected sources and keeps defaults as fallback", () => {
    const pat = resolvePatterns(
      { suricata: "logstash-suricata-*", cloudflared: null, nextcloud: null, summary: {} },
      "cloudflared-*",
    );
    expect(pat.suricata).toBe("logstash-suricata-*");
    expect(pat.cloudflared).toBe("cloudflared-*");
    expect(pat.nextcloud).toContain("nextcloud");
    // Broad set covers both defaults and the detected suricata home.
    expect(pat.general).toContain("logstash-suricata-*");
    expect(pat.general).toContain("filebeat-*");
  });

  it("deduplicates the general pattern when detection matches the defaults", () => {
    const pat = resolvePatterns(
      { suricata: "filebeat-*", cloudflared: null, nextcloud: null, summary: {} },
      "cloudflared-*",
    );
    const parts = pat.general.split(",");
    expect(new Set(parts).size).toBe(parts.length);
  });
});
