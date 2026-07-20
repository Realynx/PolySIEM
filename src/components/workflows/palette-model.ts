import { CATEGORY_LABELS, CATEGORY_ORDER } from "@/components/workflows/categories";
import type { NodeCategory, NodeTypeMeta } from "@/lib/workflows/types";

export type NodePaletteCategory = NodeCategory | "all";

function normalizeSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

/** Search the catalog across the same human and technical terms shown in the palette. */
export function filterNodeCatalog(
  catalog: NodeTypeMeta[],
  query: string,
  category: NodePaletteCategory,
): NodeTypeMeta[] {
  const needle = normalizeSearch(query);

  return catalog.filter((meta) => {
    if (category !== "all" && meta.category !== category) return false;
    if (!needle) return true;

    const haystack = normalizeSearch(
      [
        meta.title,
        meta.description,
        meta.kind,
        meta.category,
        CATEGORY_LABELS[meta.category],
      ].join(" "),
    );
    return needle.split(" ").every((term) => haystack.includes(term));
  });
}

/** Keep catalog groups in the stable visual order shared with workflow nodes. */
export function groupNodeCatalog(catalog: NodeTypeMeta[]) {
  const entries = new Map<NodeCategory, NodeTypeMeta[]>();
  for (const meta of catalog) {
    const group = entries.get(meta.category);
    if (group) group.push(meta);
    else entries.set(meta.category, [meta]);
  }

  return CATEGORY_ORDER.filter((category) => entries.has(category)).map((category) => ({
    category,
    entries: entries.get(category)!,
  }));
}
