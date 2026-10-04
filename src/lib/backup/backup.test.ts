import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decryptSecretWithAppSecret,
  encryptSecretWithAppSecret,
  sha256Hex,
} from "@/lib/crypto";
import { encodeArchive } from "./export";
import { decodeArchive, previewRestore } from "./import";
import { DEFERRED_FK_COLUMNS, FIELD_TYPES, currentSecretFingerprint, revive, tableName } from "./revive";
import { decodeEncryptedBackup, encodeEncryptedBackup, isEncryptedBackup } from "./archive-crypto";
import { rewrapArchiveSecrets } from "./portable-secrets";
import { BACKUP_FORMAT_VERSION, BACKUP_MODELS, type BackupArchive, type BackupModel } from "./types";

/**
 * Pure, DB-free coverage of the backup engine: the gzip+JSON round-trip, the
 * type reconstruction (BigInt/Date/Json), the secret-fingerprint comparison, and
 * decode-time rejection of bad/future archives.
 */

function makeArchive(overrides: Partial<BackupArchive["manifest"]> = {}): BackupArchive {
  return {
    manifest: {
      formatVersion: BACKUP_FORMAT_VERSION,
      appVersion: "0.1.0",
      createdAt: "2026-07-17T23:12:45.678Z",
      instanceName: "Test Lab",
      appSecretFingerprint: "deadbeefdeadbeef",
      counts: { device: 1, trafficCounterSample: 1 },
      models: ["device", "trafficCounterSample"],
      ...overrides,
    },
    data: {
      device: [
        {
          id: "dev1",
          name: "pve",
          // BigInt column, exported as a decimal string
          memoryBytes: "8589934592",
          metadata: { node: "pve", nested: { ok: true } },
          lastSeenAt: "2026-07-17T20:00:00.000Z",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-10T00:00:00.000Z",
        },
      ],
      trafficCounterSample: [
        {
          id: "t1",
          integrationId: "int1",
          kind: "interface",
          externalId: "wan",
          sampledAt: "2026-07-17T23:00:00.000Z",
          bytes: "18446744073709551615",
          bytesIn: "1000",
          bytesOut: null,
          delta: null,
          deltaSeconds: 30,
        },
      ],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Schema coverage                                                     */
/* ------------------------------------------------------------------ */

/**
 * A model missing from BACKUP_MODELS is SILENTLY skipped — no error, no warning,
 * it simply is not in the archive and is not wiped by an instance reset. That has
 * already shipped twice here (edgeNatRule and connectorEdgeLink were both added
 * to the schema without being registered). These tests read prisma/schema.prisma
 * directly so the next omission fails in CI instead of in someone's restore.
 */

interface SchemaModel {
  /** Prisma model name, e.g. "PrivacyRouter". */
  name: string;
  /** camelCase delegate name, which is also the BackupModel key. */
  key: string;
  bigint: string[];
  date: string[];
  json: string[];
}

/** Field lines are `  name  Type[?]  …`; relation and attribute lines are not. */
const FIELD_LINE = /^\s{2,}(\w+)\s+(\w+)(\[\])?(\?)?(\s|$)/;

function parseSchemaModels(source: string): SchemaModel[] {
  const models: SchemaModel[] = [];
  let current: SchemaModel | null = null;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "");
    const start = /^model\s+(\w+)\s*\{/.exec(line);
    if (start) {
      current = { name: start[1], key: start[1][0].toLowerCase() + start[1].slice(1), bigint: [], date: [], json: [] };
      continue;
    }
    if (!current) continue;
    if (/^\}/.test(line)) {
      models.push(current);
      current = null;
      continue;
    }
    const field = FIELD_LINE.exec(line);
    if (!field || field[3] === "[]") continue;
    const [, name, type] = field;
    if (type === "BigInt") current.bigint.push(name);
    else if (type === "DateTime") current.date.push(name);
    else if (type === "Json") current.json.push(name);
  }
  return models;
}

const SCHEMA_MODELS = parseSchemaModels(
  readFileSync(resolve(process.cwd(), "prisma/schema.prisma"), "utf8"),
);

/**
 * Models deliberately left out of backups. Both are pre-existing and are listed
 * here so the sweep below is meaningful rather than disabled — NOT as an
 * endorsement. `workflowRunLog` is per-run console output and `otxPulseRead` is
 * per-user read receipts for a cache that is itself rebuildable; if either is
 * meant to survive a restore, register it rather than extending this list.
 */
const UNBACKED_UP_MODELS = new Set(["workflowRunLog", "otxPulseRead"]);

const PRIVACY_ROUTER_MODELS = [
  "managedHost",
  "privacyRouter",
  "vpnExit",
  "privacyRoutingRule",
  "serviceTrafficSample",
  "serviceTrafficRollup",
] as const;

describe("BACKUP_MODELS covers the Prisma schema", () => {
  it("parsed the schema at all (guards the parser itself)", () => {
    expect(SCHEMA_MODELS.length).toBeGreaterThan(40);
    const device = SCHEMA_MODELS.find((m) => m.key === "device");
    expect(device?.bigint).toContain("memoryBytes");
    expect(device?.json).toContain("metadata");
  });

  it("registers every schema model", () => {
    const registered = new Set<string>(BACKUP_MODELS);
    const missing = SCHEMA_MODELS
      .map((m) => m.key)
      .filter((key) => !registered.has(key) && !UNBACKED_UP_MODELS.has(key));
    expect(missing).toEqual([]);
  });

  it("registers no model that the schema does not define", () => {
    const defined = new Set(SCHEMA_MODELS.map((m) => m.key));
    expect(BACKUP_MODELS.filter((model) => !defined.has(model))).toEqual([]);
  });

  it.each(PRIVACY_ROUTER_MODELS)("includes the privacy router model %s", (model) => {
    expect(BACKUP_MODELS).toContain(model);
  });

  it("orders the privacy router models so referenced rows are inserted first", () => {
    const at = (model: string) => BACKUP_MODELS.indexOf(model as BackupModel);
    expect(at("managedHost")).toBeLessThan(at("privacyRouter"));
    expect(at("privacyRouter")).toBeLessThan(at("vpnExit"));
    expect(at("vpnExit")).toBeLessThan(at("privacyRoutingRule"));
    expect(at("privacyRouter")).toBeLessThan(at("serviceTrafficSample"));
    expect(at("privacyRouter")).toBeLessThan(at("serviceTrafficRollup"));
    // PrivacyRouter.defaultExitId points forward at VpnExit, so it MUST be deferred
    // to restore's second UPDATE pass or the insert violates the FK.
    expect(DEFERRED_FK_COLUMNS.privacyRouter).toContain("defaultExitId");
  });

  it("lists every BigInt and DateTime column of every backed-up model", () => {
    const gaps: string[] = [];
    for (const model of SCHEMA_MODELS) {
      if (!(model.key in FIELD_TYPES)) continue;
      const declared = FIELD_TYPES[model.key as BackupModel];
      for (const column of model.bigint) {
        if (!declared.bigint?.includes(column)) gaps.push(`${model.key}.${column} (BigInt)`);
      }
      for (const column of model.date) {
        if (!declared.date?.includes(column)) gaps.push(`${model.key}.${column} (DateTime)`);
      }
    }
    // A missing entry means the value stays a string/ISO text on restore and
    // Prisma rejects the insert — the archive looks fine until you use it.
    expect(gaps).toEqual([]);
  });

  it("maps every model to its real table name for the truncate", () => {
    const tables = new Set(SCHEMA_MODELS.map((m) => m.name));
    expect(BACKUP_MODELS.filter((model) => !tables.has(tableName(model)))).toEqual([]);
  });
});

describe("encodeArchive / decodeArchive round-trip", () => {
  it("gzips and restores the exact manifest + data", () => {
    const archive = makeArchive();
    const bytes = encodeArchive(archive);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    // gzip magic number
    expect(bytes[0]).toBe(0x1f);
    expect(bytes[1]).toBe(0x8b);

    const decoded = decodeArchive(bytes);
    expect(decoded).toEqual(archive);
    // BigInt values remain strings through the JSON round-trip
    expect(decoded.data.device?.[0]?.memoryBytes).toBe("8589934592");
  });
});

describe("revive type reconstruction", () => {
  it("turns BigInt-string columns back into bigint", () => {
    const row = revive("device", { id: "d", memoryBytes: "8589934592" });
    expect(typeof row.memoryBytes).toBe("bigint");
    expect(row.memoryBytes).toBe(BigInt("8589934592"));
  });

  it("handles very large unsigned BigInt counters", () => {
    const row = revive("trafficCounterSample", { id: "t", bytes: "18446744073709551615" });
    expect(row.bytes).toBe(BigInt("18446744073709551615"));
  });

  it("turns ISO-string DateTime columns back into Date", () => {
    const row = revive("device", { id: "d", createdAt: "2026-07-01T00:00:00.000Z" });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect((row.createdAt as Date).toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("passes Json columns through as objects and leaves null/missing alone", () => {
    const row = revive("device", { id: "d", metadata: { a: 1, b: [2, 3] }, memoryBytes: null });
    expect(row.metadata).toEqual({ a: 1, b: [2, 3] });
    expect(row.memoryBytes).toBeNull();
    expect("createdAt" in row).toBe(false);
  });

  it("does not mutate the input row", () => {
    const input = { id: "d", memoryBytes: "1" };
    revive("device", input);
    expect(input.memoryBytes).toBe("1");
  });
});

describe("previewRestore fingerprint match", () => {
  const ORIGINAL = process.env.APP_SECRET;
  beforeEach(() => {
    process.env.APP_SECRET = "unit-test-app-secret-value-32-chars-long!";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.APP_SECRET;
    else process.env.APP_SECRET = ORIGINAL;
  });

  it("reports secretMatches=true when the fingerprint matches this instance", () => {
    const fp = currentSecretFingerprint();
    // sanity: fingerprint is the truncated sha256 of APP_SECRET
    expect(fp).toBe(sha256Hex(process.env.APP_SECRET ?? "").slice(0, 16));
    const summary = previewRestore(makeArchive({ appSecretFingerprint: fp }));
    expect(summary.secretMatches).toBe(true);
    expect(summary.totalRows).toBe(2);
    expect(summary.counts.device).toBe(1);
  });

  it("reports secretMatches=false for a foreign fingerprint", () => {
    const summary = previewRestore(makeArchive({ appSecretFingerprint: "0000000000000000" }));
    expect(summary.secretMatches).toBe(false);
  });
});

describe("decodeArchive validation", () => {
  it("rejects non-gzip / non-backup bytes", () => {
    expect(() => decodeArchive(Buffer.from("this is not a backup"))).toThrow(/not a valid PolySIEM backup/i);
  });

  it("rejects a future format version with an actionable message", () => {
    const future = encodeArchive(makeArchive({ formatVersion: BACKUP_FORMAT_VERSION + 1 }));
    expect(() => decodeArchive(future)).toThrow(/newer version of PolySIEM/i);
  });

  it("rejects an archive whose data references an unknown model", () => {
    const archive = makeArchive();
    (archive.data as Record<string, unknown>).notAModel = [];
    expect(() => decodeArchive(encodeArchive(archive))).toThrow(/unknown model/i);
  });

  it("rejects bytes with no manifest", () => {
    const bytes = encodeArchive({ data: {} } as unknown as BackupArchive);
    expect(() => decodeArchive(bytes)).toThrow(/missing a valid manifest/i);
  });
});

describe("password-protected portable backups", () => {
  const SOURCE_SECRET = "source-app-secret-value-that-is-long-enough";
  const DESTINATION_SECRET = "destination-app-secret-that-is-long-enough";

  it("encrypts the archive and source key material with the backup password", () => {
    const archive = makeArchive();
    const bytes = encodeEncryptedBackup(archive, "correct horse battery staple", SOURCE_SECRET);

    expect(isEncryptedBackup(bytes)).toBe(true);
    expect(bytes.toString("utf8")).not.toContain(SOURCE_SECRET);
    expect(bytes.toString("utf8")).not.toContain("Test Lab");

    const decoded = decodeEncryptedBackup(bytes, "correct horse battery staple");
    expect(decoded.archive).toEqual(archive);
    expect(decoded.sourceAppSecret).toBe(SOURCE_SECRET);
    expect(decoded.passwordProtected).toBe(true);
  });

  it("requires the password and rejects an incorrect password", () => {
    const bytes = encodeEncryptedBackup(makeArchive(), "correct horse battery staple", SOURCE_SECRET);
    expect(() => decodeEncryptedBackup(bytes)).toThrow(/enter its backup password/i);
    expect(() => decodeEncryptedBackup(bytes, "wrong password")).toThrow(/incorrect.*corrupt/i);
  });

  it("re-encrypts nested stored credentials for the destination APP_SECRET", () => {
    const encryptedCredential = encryptSecretWithAppSecret(
      JSON.stringify({ username: "backup-user", password: "integration-secret" }),
      SOURCE_SECRET,
    );
    const archive = makeArchive({ appSecretFingerprint: sha256Hex(SOURCE_SECRET).slice(0, 16) });
    archive.data.integrationConfig = [{ id: "int1", encryptedCredentials: encryptedCredential }];
    archive.data.appSetting = [{
      key: "ai_text_config",
      value: { openai: { apiKeyEncrypted: encryptSecretWithAppSecret("hosted-ai-key", SOURCE_SECRET) } },
    }];

    const rewrapped = rewrapArchiveSecrets(archive, SOURCE_SECRET, DESTINATION_SECRET);
    const integrationBlob = rewrapped.data.integrationConfig?.[0]?.encryptedCredentials as string;
    const setting = rewrapped.data.appSetting?.[0]?.value as {
      openai: { apiKeyEncrypted: string };
    };

    expect(integrationBlob).not.toBe(encryptedCredential);
    expect(JSON.parse(decryptSecretWithAppSecret(integrationBlob, DESTINATION_SECRET))).toEqual({
      username: "backup-user",
      password: "integration-secret",
    });
    expect(decryptSecretWithAppSecret(setting.openai.apiKeyEncrypted, DESTINATION_SECRET)).toBe("hosted-ai-key");
    expect(rewrapped.manifest.appSecretFingerprint).toBe(sha256Hex(DESTINATION_SECRET).slice(0, 16));
    expect(() => decryptSecretWithAppSecret(integrationBlob, SOURCE_SECRET)).toThrow();
  });
});
