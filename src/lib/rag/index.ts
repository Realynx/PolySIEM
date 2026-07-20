import "server-only";
import { prisma } from "@/lib/db";
import { embedTexts, type EmbedTarget } from "./embed";
import { chunkText, entityToBlob, type EntityFact } from "./chunk";
import { resolveEmbeddingConfig } from "./config";

export type RagSourceType = "doc" | "device" | "vm" | "container" | "network" | "service";

/** A source to index: its chunk texts (stored) plus display metadata. */
interface IndexUnit {
  sourceType: RagSourceType;
  sourceId: string;
  title: string;
  href: string | null;
  /** Chunk contents stored verbatim; embedded with the title prefixed. */
  chunks: string[];
}

export interface ReindexStats {
  model: string;
  mock: boolean;
  docs: number;
  entities: number;
  chunks: number;
  deleted: number;
}

const NOT_REMOVED = { status: { not: "REMOVED" as const } };

function gib(bytes?: number | bigint | null): string | null {
  if (bytes === null || bytes === undefined) return null;
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${(n / 1024 ** 3).toFixed(1)} GiB`;
}

// ---------------------------------------------------------------------------
// Unit builders
// ---------------------------------------------------------------------------

async function docUnit(docId: string): Promise<IndexUnit | null> {
  const doc = await prisma.docPage.findUnique({
    where: { id: docId },
    select: { id: true, title: true, slug: true, content: true },
  });
  if (!doc) return null;
  const chunks = chunkText(doc.content).map((c) => c.content);
  return {
    sourceType: "doc",
    sourceId: doc.id,
    title: doc.title,
    href: `/docs/${doc.slug}`,
    chunks: chunks.length > 0 ? chunks : [doc.title],
  };
}

async function docUnits(): Promise<IndexUnit[]> {
  const docs = await prisma.docPage.findMany({ select: { id: true, title: true, slug: true, content: true } });
  return docs.map((doc) => {
    const chunks = chunkText(doc.content).map((c) => c.content);
    return {
      sourceType: "doc" as const,
      sourceId: doc.id,
      title: doc.title,
      href: `/docs/${doc.slug}`,
      chunks: chunks.length > 0 ? chunks : [doc.title],
    };
  });
}

function unit(
  sourceType: RagSourceType,
  id: string,
  name: string,
  href: string,
  subtitle: string | null,
  facts: EntityFact[],
  description: string | null,
): IndexUnit {
  return {
    sourceType,
    sourceId: id,
    title: name,
    href,
    chunks: [entityToBlob({ kind: sourceType, name, subtitle, facts, description })],
  };
}

async function entityUnits(): Promise<IndexUnit[]> {
  const [devices, vms, containers, networks, services] = await Promise.all([
    prisma.device.findMany({
      where: NOT_REMOVED,
      select: {
        id: true, name: true, kind: true, manufacturer: true, model: true, location: true,
        cpuModel: true, cpuCores: true, memoryBytes: true, osName: true, osVersion: true, description: true,
      },
    }),
    prisma.virtualMachine.findMany({
      where: NOT_REMOVED,
      select: {
        id: true, name: true, powerState: true, cpuCores: true, memoryBytes: true, diskBytes: true,
        osName: true, description: true, host: { select: { name: true } },
      },
    }),
    prisma.container.findMany({
      where: NOT_REMOVED,
      select: {
        id: true, name: true, runtime: true, powerState: true, cpuCores: true, memoryBytes: true,
        diskBytes: true, osName: true, description: true, host: { select: { name: true } },
      },
    }),
    prisma.network.findMany({
      where: NOT_REMOVED,
      select: {
        id: true, name: true, vlanId: true, cidr: true, gateway: true, domain: true, purpose: true, description: true,
      },
    }),
    prisma.service.findMany({
      where: NOT_REMOVED,
      select: {
        id: true, name: true, url: true, port: true, protocol: true, description: true,
        device: { select: { name: true } }, vm: { select: { name: true } }, container: { select: { name: true } },
      },
    }),
  ]);

  const units: IndexUnit[] = [];

  for (const d of devices) {
    units.push(unit("device", d.id, d.name, `/inventory/hosts/${d.id}`, d.kind, [
      { label: "Manufacturer", value: d.manufacturer },
      { label: "Model", value: d.model },
      { label: "Location", value: d.location },
      { label: "CPU", value: d.cpuModel },
      { label: "CPU cores", value: d.cpuCores },
      { label: "Memory", value: gib(d.memoryBytes) },
      { label: "OS", value: [d.osName, d.osVersion].filter(Boolean).join(" ") },
    ], d.description));
  }

  for (const v of vms) {
    units.push(unit("vm", v.id, v.name, `/inventory/vms/${v.id}`, v.host?.name ?? null, [
      { label: "Host", value: v.host?.name },
      { label: "Power", value: v.powerState },
      { label: "CPU cores", value: v.cpuCores },
      { label: "Memory", value: gib(v.memoryBytes) },
      { label: "Disk", value: gib(v.diskBytes) },
      { label: "OS", value: v.osName },
    ], v.description));
  }

  for (const c of containers) {
    units.push(unit("container", c.id, c.name, `/inventory/containers/${c.id}`, c.runtime, [
      { label: "Host", value: c.host?.name },
      { label: "Power", value: c.powerState },
      { label: "CPU cores", value: c.cpuCores },
      { label: "Memory", value: gib(c.memoryBytes) },
      { label: "Disk", value: gib(c.diskBytes) },
      { label: "OS", value: c.osName },
    ], c.description));
  }

  for (const n of networks) {
    units.push(unit("network", n.id, n.name, `/network/${n.id}`, n.vlanId != null ? `VLAN ${n.vlanId}` : null, [
      { label: "CIDR", value: n.cidr },
      { label: "Gateway", value: n.gateway },
      { label: "Domain", value: n.domain },
      { label: "Purpose", value: n.purpose },
    ], n.description));
  }

  for (const s of services) {
    const host = s.device?.name ?? s.vm?.name ?? s.container?.name ?? null;
    units.push(unit("service", s.id, s.name, `/inventory/services/${s.id}`, s.protocol, [
      { label: "URL", value: s.url },
      { label: "Port", value: s.port },
      { label: "Runs on", value: host },
    ], s.description));
  }

  return units;
}

// ---------------------------------------------------------------------------
// Upsert / delete
// ---------------------------------------------------------------------------

/** Upsert every chunk of one source and drop leftover higher-index chunks. */
async function upsertUnit(target: EmbedTarget, model: string, u: IndexUnit): Promise<number> {
  if (u.chunks.length === 0) {
    await prisma.embeddingChunk.deleteMany({ where: { sourceType: u.sourceType, sourceId: u.sourceId } });
    return 0;
  }
  const inputs = u.chunks.map((c) => `${u.title}\n\n${c}`);
  const vectors = await embedTexts(target, inputs);
  for (let i = 0; i < u.chunks.length; i++) {
    await prisma.embeddingChunk.upsert({
      where: { sourceType_sourceId_chunkIndex: { sourceType: u.sourceType, sourceId: u.sourceId, chunkIndex: i } },
      create: {
        sourceType: u.sourceType,
        sourceId: u.sourceId,
        chunkIndex: i,
        title: u.title,
        content: u.chunks[i],
        embedding: vectors[i],
        model,
        href: u.href,
      },
      update: { title: u.title, content: u.chunks[i], embedding: vectors[i], model, href: u.href },
    });
  }
  await prisma.embeddingChunk.deleteMany({
    where: { sourceType: u.sourceType, sourceId: u.sourceId, chunkIndex: { gte: u.chunks.length } },
  });
  return u.chunks.length;
}

/** Remove all chunks for a source (e.g. a deleted doc or entity). */
export async function deleteSourceChunks(sourceType: RagSourceType, sourceId: string): Promise<void> {
  await prisma.embeddingChunk.deleteMany({ where: { sourceType, sourceId } });
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Re-index a single doc. Fire-and-forget from the docs service: it swallows all
 * errors and is a no-op when the embedding backend is disabled, so a save is
 * never blocked or failed by the index.
 */
export async function reindexDoc(docId: string): Promise<void> {
  try {
    const cfg = await resolveEmbeddingConfig();
    if (!cfg.enabled) return;
    const u = await docUnit(docId);
    if (!u) {
      await deleteSourceChunks("doc", docId);
      return;
    }
    await upsertUnit({ baseUrl: cfg.baseUrl, model: cfg.model }, cfg.model, u);
  } catch (err) {
    console.error("[rag] reindexDoc failed (non-fatal):", err instanceof Error ? err.message : err);
  }
}

/**
 * Rebuild the whole index: (re)embed every doc and inventory entity, then prune
 * chunks whose source no longer exists or whose model changed. Runs regardless
 * of the `enabled` flag (admin/CLI-triggered backfill), but still needs a
 * reachable backend (or a mock:// base URL).
 */
export async function reindexAll(): Promise<ReindexStats> {
  const cfg = await resolveEmbeddingConfig();
  const target: EmbedTarget = { baseUrl: cfg.baseUrl, model: cfg.model };

  const [docs, entities] = await Promise.all([docUnits(), entityUnits()]);
  const units = [...docs, ...entities];

  let chunks = 0;
  for (const u of units) {
    chunks += await upsertUnit(target, cfg.model, u);
  }

  // Prune: anything from a previous model, plus per-type sources that vanished.
  const del = await prisma.embeddingChunk.deleteMany({ where: { model: { not: cfg.model } } });
  let deleted = del.count;

  const byType = new Map<RagSourceType, string[]>();
  for (const u of units) {
    const list = byType.get(u.sourceType) ?? [];
    list.push(u.sourceId);
    byType.set(u.sourceType, list);
  }
  for (const sourceType of ["doc", "device", "vm", "container", "network", "service"] as RagSourceType[]) {
    const keep = byType.get(sourceType) ?? [];
    const gone = await prisma.embeddingChunk.deleteMany({
      where: { sourceType, sourceId: { notIn: keep.length > 0 ? keep : ["__none__"] } },
    });
    deleted += gone.count;
  }

  return {
    model: cfg.model,
    mock: cfg.isMock,
    docs: docs.length,
    entities: entities.length,
    chunks,
    deleted,
  };
}
