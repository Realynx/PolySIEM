/**
 * Render an entity detail object as compact markdown for MCP resources (pure).
 */

const SKIP_KEYS = new Set(["type", "href", "description", "linkedDocs", "content", "tags", "metadata", "graph", "integrationId", "externalId"]);

function scalar(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") return value.replace(/\r?\n/g, " ");
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function inline(value: unknown): string | null {
  const s = scalar(value);
  if (s !== null) return s;
  if (Array.isArray(value)) {
    const parts = value.map((v) => inline(v)).filter((v): v is string => Boolean(v));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const label = scalar(obj.name) ?? scalar(obj.title) ?? scalar(obj.ip) ?? scalar(obj.address);
    if (label) return obj.id ? `${label} (${String(obj.id)})` : label;
    const pairs = Object.entries(obj)
      .map(([k, v]) => [k, scalar(v)] as const)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => `${k}=${v}`);
    return pairs.length > 0 ? pairs.join(" ") : null;
  }
  return null;
}

export function renderEntityMarkdown(entity: Record<string, unknown>): string {
  const title = scalar(entity.name) ?? scalar(entity.title) ?? scalar(entity.id) ?? "Entity";
  const lines = [`# ${title}`, "", `_${String(entity.type ?? "entity")}${entity.href ? ` · ${String(entity.href)}` : ""}_`, ""];
  const fields = Object.entries(entity)
    .filter(([key]) => !SKIP_KEYS.has(key))
    .map(([key, value]) => [key, inline(value)] as const)
    .filter(([, value]) => value !== null);
  for (const [key, value] of fields) lines.push(`- **${key}**: ${value}`);
  if (Array.isArray(entity.tags) && entity.tags.length > 0) lines.push(`- **tags**: ${inline(entity.tags)}`);
  if (typeof entity.description === "string" && entity.description.trim()) {
    lines.push("", "## Description", "", entity.description.trim());
  }
  if (typeof entity.content === "string") lines.push("", entity.content);
  if (Array.isArray(entity.linkedDocs) && entity.linkedDocs.length > 0) {
    lines.push("", "## Linked documentation", "");
    for (const doc of entity.linkedDocs as Array<{ title: string; slug: string }>) {
      lines.push(`- ${doc.title} (polysiem://docs/${doc.slug})`);
    }
  }
  return lines.join("\n");
}
